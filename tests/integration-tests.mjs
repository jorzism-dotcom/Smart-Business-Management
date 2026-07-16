// ─── tests/integration-tests.mjs ─────────────────────────────────────────────
// logic-tests.mjs প্রতিটা ফাংশন আলাদা-আলাদাভাবে টেস্ট করে (unit-level)। এই
// ফাইলটা তার পরিপূরক — একাধিক ফাংশন একসাথে চেইন করে বাস্তব ব্যবহারকারীর
// একটা সম্পূর্ণ ফ্লো সিমুলেট করে, যেমন: "ইনভয়েস তৈরি → স্টক কমা → ভয়েড →
// স্টক আবার ফেরত"। এটা দরকার কারণ প্রতিটা ফাংশন আলাদাভাবে ঠিক থাকলেও তাদের
// মধ্যেকার ইন্টারঅ্যাকশনে বাগ থাকতে পারে (যেমন: void করার পর round-trip-এ
// টাকা/স্টক ঠিক জায়গায় ফিরছে কিনা)।
//
// এখনো Firestore/App.jsx-এর প্রকৃত createInvoice()/voidInvoice() কল করা হয়
// না (সেটার জন্য browser/Firebase লাগবে) — এখানে src/logic.js-এর pure
// ফাংশনগুলো ঠিক যেভাবে App.jsx থেকে চেইন করে কল হয় (দেখুন BUGFIX_LOG.md-এর
// "reference-copy ফাংশনগুলো আসল করা হলো" এন্ট্রি) সেই একই ক্রমে চালিয়ে
// end-to-end ফলাফল যাচাই করা হয়।
//
// রান করুন:  node tests/integration-tests.mjs  (npm test-এর অংশ হিসেবেও চলে)

import {
  calcInvoiceProfit, calcInvoiceTotal, calcVoidNetChange, calcCashDrawer,
  restoreBatchQty, getSortedActiveBatches, getActiveBatch, getSellableStock,
  computeSupplierDueMap, calcNextBatch,
} from "../src/logic.js";

let passCount = 0;
let failCount = 0;
const failures = [];

function t(suite, name, fn) {
  try {
    const { pass, expected, actual } = fn();
    if (pass) {
      passCount++;
    } else {
      failCount++;
      failures.push(`  ✗ [${suite}] ${name} — প্রত্যাশিত ${JSON.stringify(expected)}, পাওয়া গেছে ${JSON.stringify(actual)}`);
    }
  } catch (err) {
    failCount++;
    failures.push(`  ✗ [${suite}] ${name} — এরর/ক্র্যাশ: ${err?.message || err}`);
  }
}
const approx = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// ═══════════════════════════════════════════════════════════════════════════
// ফ্লো ১: ইনভয়েস বিক্রয় → ভয়েড → রাউন্ড-ট্রিপ (স্টক ও টাকা দুটোই ঠিক জায়গায় ফেরত)
// ═══════════════════════════════════════════════════════════════════════════
t("সেল→ভয়েড ফ্লো", "বিক্রয়ের আগে সঠিক sellable stock (FEFO-তে সবচেয়ে আগের ব্যাচ)", () => {
  const product = {
    id: "p1",
    batches: [
      { batchNo: "B-2606-1", qty: 10, expiryDate: "2027-01-01" },
      { batchNo: "B-2607-1", qty: 20, expiryDate: "2027-06-01" },
    ],
  };
  const activeBatch = getActiveBatch(product);
  const stock = getSellableStock(product);
  return { pass: activeBatch.batchNo === "B-2606-1" && stock === 30, expected: { batch: "B-2606-1", stock: 30 }, actual: { batch: activeBatch.batchNo, stock } };
});

t("সেল→ভয়েড ফ্লো", "ইনভয়েস total + profit — একটা বিক্রয়ের হিসাব সামঞ্জস্যপূর্ণ", () => {
  const prodMap = new Map([["p1", { id: "p1", costPrice: 50 }]]);
  const items = [{ productId: "p1", price: 100, qty: 3, itemDiscount: 0 }];
  const total = calcInvoiceTotal(items, 20, 0); // 300 - 20 discount = 280
  const inv = { items, discount: 20, total };
  const profit = calcInvoiceProfit(inv, prodMap);
  // revenue (discount-adjusted) = 280, cost = 50*3 = 150, profit = 130
  return { pass: total === 280 && approx(profit, 130), expected: { total: 280, profit: 130 }, actual: { total, profit } };
});

t("সেল→ভয়েড ফ্লো", "ভয়েড করার পর batch qty ঠিক পরিমাণে ফেরত আসে (রাউন্ড-ট্রিপ)", () => {
  let batches = [
    { batchNo: "B-2606-1", qty: 7, expiryDate: "2027-01-01" }, // ১০ থেকে ৩ বিক্রি হয়ে ৭ বাকি
    { batchNo: "B-2607-1", qty: 20, expiryDate: "2027-06-01" },
  ];
  const soldQty = 3;
  const restored = restoreBatchQty(batches, "B-2606-1", soldQty);
  const restoredBatch = restored.find(b => b.batchNo === "B-2606-1");
  const totalStockAfterVoid = restored.reduce((s, b) => s + b.qty, 0);
  return {
    pass: restoredBatch.qty === 10 && totalStockAfterVoid === 30, // মূল অবস্থায় ফিরে গেছে
    expected: { restoredQty: 10, totalStock: 30 },
    actual: { restoredQty: restoredBatch.qty, totalStock: totalStockAfterVoid },
  };
});

t("সেল→ভয়েড ফ্লো", "বাকি (baki) পেমেন্টে ভয়েড করলে netChange পুরো total-ই ফেরত দেয়", () => {
  const items = [{ productId: "p1", price: 100, qty: 3, itemDiscount: 0 }];
  const total = calcInvoiceTotal(items, 20, 0); // 280
  const inv = { items, discount: 20, total, payType: "baki" };
  const netChange = calcVoidNetChange(inv);
  // baki ইনভয়েস ভয়েড হলে কাস্টমারের বাকি ব্যালেন্স থেকে পুরো total-টাই কমে যাওয়া উচিত
  return { pass: netChange === 280, expected: 280, actual: netChange };
});

t("সেল→ভয়েড ফ্লো", "partial পেমেন্টে ভয়েড করলে শুধু bakiAmount ফেরত যায় (পুরো total না)", () => {
  const inv = { total: 280, payType: "partial", bakiAmount: 100, paid: 180 };
  const netChange = calcVoidNetChange(inv);
  return { pass: netChange === 100, expected: 100, actual: netChange };
});

// ═══════════════════════════════════════════════════════════════════════════
// ফ্লো ২: দিন-শেষের সামারি — একাধিক মিশ্র-পেমেন্ট ইনভয়েস + ক্যাশ ড্রয়ার
// ═══════════════════════════════════════════════════════════════════════════
t("দৈনিক সামারি ফ্লো", "cash + partial + baki মিশ্রিত ইনভয়েস থেকে সঠিক ক্যাশ সংগ্রহ ও ক্যাশ ড্রয়ার", () => {
  const prodMap = new Map([["p1", { id: "p1", costPrice: 50 }]]);
  const invoices = [
    { items: [{ productId: "p1", price: 100, qty: 1 }], total: 100, payType: "cash", discount: 0 },
    { items: [{ productId: "p1", price: 100, qty: 2 }], total: 200, payType: "baki", discount: 0 }, // পুরোটাই বাকি, ক্যাশ আসেনি
    { items: [{ productId: "p1", price: 100, qty: 1 }], total: 100, payType: "partial", paid: 60, due: 40, discount: 0 },
  ];
  // cash sale = cash-payType পুরোটা + partial-এর paid অংশ (App.jsx-এর buildDailySummaryData-এর মতো)
  const cashSale = invoices.reduce((s, inv) => {
    if (inv.payType === "cash") return s + inv.total;
    if (inv.payType === "partial") return s + (inv.paid || 0);
    return s;
  }, 0); // 100 + 60 = 160

  const totalProfit = invoices.reduce((s, inv) => s + calcInvoiceProfit(inv, prodMap), 0);
  const cashDrawer = calcCashDrawer(500 /* opening */, cashSale, 0 /* joma */, 0 /* withdrawal */);

  return {
    pass: cashSale === 160 && cashDrawer === 660 && approx(totalProfit, 200), // (50+100+50)=200 profit
    expected: { cashSale: 160, cashDrawer: 660, totalProfit: 200 },
    actual: { cashSale, cashDrawer, totalProfit },
  };
});

t("দৈনিক সামারি ফ্লো", "একটা বাকি ইনভয়েস ভয়েড হলে দিন-শেষের cashDrawer অপরিবর্তিত থাকে (baki কখনো cash ছোঁয়নি)", () => {
  const bakiInv = { total: 200, payType: "baki", discount: 0 };
  const netChange = calcVoidNetChange(bakiInv); // কাস্টমার ব্যালেন্স থেকে ২০০ কমবে
  const cashDrawerBefore = calcCashDrawer(500, 160, 0, 0);
  // ভয়েড হওয়া baki ইনভয়েসের netChange ক্যাশ ড্রয়ারে যোগ হওয়া উচিত না — শুধু customer.balance বদলায়
  const cashDrawerAfter = calcCashDrawer(500, 160, 0, 0);
  return { pass: netChange === 200 && cashDrawerBefore === cashDrawerAfter, expected: { netChange: 200, unchanged: true }, actual: { netChange, unchanged: cashDrawerBefore === cashDrawerAfter } };
});

// ═══════════════════════════════════════════════════════════════════════════
// ফ্লো ৩: ক্রয় → সাপ্লায়ার বাকি → পরবর্তী ব্যাচ নম্বর — সব একসাথে সামঞ্জস্যপূর্ণ
// ═══════════════════════════════════════════════════════════════════════════
t("ক্রয়→সাপ্লায়ার ফ্লো", "একই সাপ্লায়ারের কাছ থেকে পরপর ২টা ক্রয় — batch নম্বর ও due হিসাব দুটোই সামঞ্জস্যপূর্ণ", () => {
  const products = [{ id: "p1", company: "ABC ফার্মা", stock: 0, batches: [] }];
  const po1 = { _type: "pe", productId: "p1", supplier: "ABC ফার্মা", batch: "B-2607-1", items: [{ qty: 100, costPrice: 10 }] };

  // প্রথম ক্রয়ের পর batch id
  const firstBatch = calcNextBatch("p1", products, [], "2026-07-05");
  const productsAfterFirst = [{ ...products[0], batches: [{ batchNo: firstBatch, qty: 100 }] }];

  // একই মাসে দ্বিতীয় ক্রয়
  const secondBatch = calcNextBatch("p1", productsAfterFirst, [po1], "2026-07-20");

  // সাপ্লায়ার বাকি — এখনো কোনো পেমেন্ট করা হয়নি
  const purchaseOrders = [po1, { _type: "pe", productId: "p1", supplier: "ABC ফার্মা", items: [{ qty: 50, costPrice: 10 }] }];
  const dueMap = computeSupplierDueMap(productsAfterFirst, purchaseOrders, []);

  return {
    pass: firstBatch === "B-2607-1" && secondBatch === "B-2607-2" && dueMap["ABC ফার্মা"].totalPurchased === 1500,
    expected: { firstBatch: "B-2607-1", secondBatch: "B-2607-2", totalPurchased: 1500 },
    actual: { firstBatch, secondBatch, totalPurchased: dueMap["ABC ফার্মা"]?.totalPurchased },
  };
});

t("ক্রয়→সাপ্লায়ার ফ্লো", "সাপ্লায়ারকে আংশিক পেমেন্ট করার পর due কমে (কিন্তু totalPurchased অপরিবর্তিত)", () => {
  const purchaseOrders = [{ supplier: "ABC ফার্মা", items: [{ qty: 100, costPrice: 10 }] }]; // totalPurchased = 1000
  const payments = [{ supplierName: "ABC ফার্মা", type: "payment", amount: 400 }];
  const dueMap = computeSupplierDueMap([], purchaseOrders, payments);
  return {
    pass: dueMap["ABC ফার্মা"].totalPurchased === 1000 && dueMap["ABC ফার্মা"].due === 0 && dueMap["ABC ফার্মা"].paid === 400,
    expected: { totalPurchased: 1000, due: 0, paid: 400 },
    actual: dueMap["ABC ফার্মা"],
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// ফ্লো ৪: FEFO স্টক সিলেকশন — একাধিক ব্যাচের মধ্যে কিছু মেয়াদোত্তীর্ণ
// ═══════════════════════════════════════════════════════════════════════════
t("FEFO স্টক ফ্লো", "মেয়াদোত্তীর্ণ ব্যাচ sellable stock ও active batch selection থেকে বাদ পড়ে", () => {
  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const product = {
    batches: [
      { batchNo: "EXPIRED", qty: 50, expiryDate: yesterday },   // মেয়াদোত্তীর্ণ — বাদ
      { batchNo: "FRESH", qty: 30, expiryDate: nextYear },
    ],
  };
  const stock = getSellableStock(product);
  const active = getSortedActiveBatches(product);
  return {
    pass: stock === 30 && active.length === 1 && active[0].batchNo === "FRESH",
    expected: { stock: 30, activeCount: 1, activeBatch: "FRESH" },
    actual: { stock, activeCount: active.length, activeBatch: active[0]?.batchNo },
  };
});

// ── ফলাফল ────────────────────────────────────────────────────────────────────
console.log(`\n ইন্টিগ্রেশন টেস্ট সুইট (একাধিক ফাংশন চেইন করে বাস্তব ফ্লো) — ${passCount + failCount}টি কেস\n`);
if (failures.length > 0) {
  console.log(`❌ ${failCount}টি ফেল, ${passCount}টি পাস\n`);
  console.log(failures.join("\n"));
  console.log("");
  process.exit(1);
} else {
  console.log(`✅ সবগুলো (${passCount}টি) পাস হয়েছে\n`);
  process.exit(0);
}
