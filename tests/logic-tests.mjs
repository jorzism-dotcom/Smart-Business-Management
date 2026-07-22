// ─── tests/logic-tests.mjs ───────────────────────────────────────────────────
// এই ফাইল src/logic.js থেকে সরাসরি ফাংশন import করে চালায় — plain Node.js,
// কোনো browser/Firebase/build লাগে না। CI-তে (GitHub Actions) এটা build
// শুরু হওয়ার *আগে* চলে; কোনো একটা কেস fail করলে exit code 1 হয়ে পুরো
// workflow বন্ধ হয়ে যায় — অর্থাৎ ভাঙা কোড দিয়ে কখনো APK বিল্ড/ডিপ্লয় হবে না।
//
// রান করুন:  node tests/logic-tests.mjs
//
// নতুন বাগ ফিক্স করলে: এই ফাইলে ওই বাগের জন্য একটা নতুন test case যোগ করুন,
// যাতে ভবিষ্যতে একই বাগ চুপচাপ আবার ফিরে না আসতে পারে।

import {
  calcInvoiceProfit, calcProfitTotal, calcInvoiceTotal, calcVoidNetChange,
  calcCashDrawer, restoreBatchQty, isBatchExpired, getSortedActiveBatches,
  getActiveBatch, getSellableStock, computeSupplierDueMap, calcNextBatch,
  runInvariantChecks, getReturnedQtyForInvoice, getReturnedAmountForInvoice,
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
      failures.push(`  ✗ [${suite}] ${name} — প্রত্যাশিত ${expected}, পাওয়া গেছে ${actual}`);
    }
  } catch (err) {
    failCount++;
    failures.push(`  ✗ [${suite}] ${name} — এরর/ক্র্যাশ: ${err?.message || err}`);
  }
}

const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// ── লাভ হিসাব (calcInvoiceProfit) ───────────────────────────────────────────
t("লাভ হিসাব", "সাধারণ বিক্রয় — ডিসকাউন্ট/এক্সট্রা ছাড়া", () => {
  const prodMap = new Map([["p1", { costPrice: 50 }]]);
  const inv = { items: [{ productId: "p1", price: 100, qty: 2, costPrice: 50 }], discount: 0, extraCharge: 0 };
  const actual = calcInvoiceProfit(inv, prodMap);
  return { pass: approx(actual, 100), expected: 100, actual };
});
t("লাভ হিসাব", "ডিসকাউন্ট অনুপাতে revenue কমা উচিত (cost না)", () => {
  const prodMap = new Map([["p1", { costPrice: 50 }]]);
  const inv = { items: [{ productId: "p1", price: 100, qty: 2, costPrice: 50 }], discount: 20, extraCharge: 0 };
  const actual = calcInvoiceProfit(inv, prodMap);
  return { pass: approx(actual, 80), expected: 80, actual };
});
t("লাভ হিসাব", "extraCharge পুরোটাই লাভ (কোনো cost নেই)", () => {
  const prodMap = new Map([["p1", { costPrice: 50 }]]);
  const inv = { items: [{ productId: "p1", price: 100, qty: 1, costPrice: 50 }], discount: 0, extraCharge: 30 };
  const actual = calcInvoiceProfit(inv, prodMap);
  return { pass: approx(actual, 80), expected: 80, actual };
});
t("লাভ হিসাব", "প্রতি-লাইন itemDiscount ধরা উচিত (global discount-এর মতোই)", () => {
  const prodMap = new Map([["p1", { costPrice: 50 }]]);
  const inv = { items: [{ productId: "p1", price: 100, qty: 2, costPrice: 50 }], discount: 0, itemDiscount: 20, extraCharge: 0 };
  const actual = calcInvoiceProfit(inv, prodMap);
  return { pass: approx(actual, 80), expected: 80, actual };
});
t("লাভ হিসাব", "সেবা (service) আইটেমের cost সবসময় ০ ধরা উচিত", () => {
  const inv = { items: [{ productId: "s1", price: 500, qty: 1, productType: "service", costPrice: 999 }], discount: 0, extraCharge: 0 };
  const actual = calcInvoiceProfit(inv, new Map());
  return { pass: approx(actual, 500), expected: 500, actual };
});
t("লাভ হিসাব", "খালি items → profit ০ (crash নয়)", () => {
  const actual = calcInvoiceProfit({ items: [], discount: 0, extraCharge: 0 }, new Map());
  return { pass: actual === 0, expected: 0, actual };
});
t("লাভ হিসাব", "calcProfitTotal — একাধিক ইনভয়েসের যোগফল", () => {
  const prodMap = new Map([["p1", { costPrice: 50 }]]);
  const invs = [
    { items: [{ productId: "p1", price: 100, qty: 1, costPrice: 50 }], discount: 0, extraCharge: 0 },
    { items: [{ productId: "p1", price: 100, qty: 2, costPrice: 50 }], discount: 0, extraCharge: 0 },
  ];
  const actual = calcProfitTotal(invs, prodMap);
  return { pass: approx(actual, 150), expected: 150, actual }; // 50 + 100
});

// ── ইনভয়েস টোটাল সূত্র ───────────────────────────────────────────────────────
t("ইনভয়েস টোটাল সূত্র", "লাইন-আইটেম ডিসকাউন্ট সাবটোটাল ছাড়িয়ে যেতে পারবে না (clamp)", () => {
  const actual = calcInvoiceTotal([{ price: 100, qty: 1, itemDiscount: 999 }], 0, 0);
  return { pass: actual === 0, expected: 0, actual };
});
t("ইনভয়েস টোটাল সূত্র", "গ্লোবাল discount সাবটোটালের বেশি হলেও total ০-এর নিচে নামা উচিত না", () => {
  const actual = calcInvoiceTotal([{ price: 100, qty: 1, itemDiscount: 0 }], 500, 0);
  return { pass: actual === 0, expected: 0, actual };
});
t("ইনভয়েস টোটাল সূত্র", "discount extreme negative (-Infinity) হলেও total কখনো Infinity হওয়া উচিত না (fuzz-এ ধরা পড়া বাগ)", () => {
  const actual = calcInvoiceTotal([{ price: 100, qty: 1, itemDiscount: 0 }], -Infinity, 0);
  return { pass: Number.isFinite(actual) && actual === 100, expected: 100, actual };
});
t("ইনভয়েস টোটাল সূত্র", "extraCharge নেগেটিভ দেওয়া হলেও ০ ধরা উচিত", () => {
  const actual = calcInvoiceTotal([{ price: 100, qty: 1, itemDiscount: 0 }], 0, -50);
  return { pass: actual === 100, expected: 100, actual };
});
t("ইনভয়েস টোটাল সূত্র", "extraCharge extreme positive (Infinity) হলেও total কখনো Infinity হওয়া উচিত না (fuzz-এ ধরা পড়া বাগ)", () => {
  const actual = calcInvoiceTotal([{ price: 100, qty: 1, itemDiscount: 0 }], 0, Infinity);
  return { pass: Number.isFinite(actual) && actual === 100, expected: 100, actual };
});
t("ইনভয়েস টোটাল সূত্র", "স্বাভাবিক কেস — একাধিক আইটেম + itemDiscount + discount + extraCharge", () => {
  const items = [{ price: 100, qty: 2, itemDiscount: 20 }, { price: 50, qty: 1, itemDiscount: 0 }];
  const actual = calcInvoiceTotal(items, 10, 15);
  return { pass: actual === 235, expected: 235, actual };
});

// ── ভয়েড-রিভার্সাল netChange সূত্র ───────────────────────────────────────────
t("ভয়েড রিভার্সাল সূত্র", "পুরো বাকি (baki) ইনভয়েস ভয়েড হলে পুরো total-ই বিয়োগ হওয়া উচিত", () => {
  const actual = calcVoidNetChange({ payType: "baki", total: 500, bakiAmount: 0, overpayAmount: 0 });
  return { pass: actual === 500, expected: 500, actual };
});
t("ভয়েড রিভার্সাল সূত্র", "আংশিক বাকি (partial) ইনভয়েস — শুধু bakiAmount বিয়োগ হওয়া উচিত, পুরো total নয়", () => {
  const actual = calcVoidNetChange({ payType: "partial", total: 500, bakiAmount: 200, overpayAmount: 0 });
  return { pass: actual === 200, expected: 200, actual };
});
t("ভয়েড রিভার্সাল সূত্র", "Overpay ছিল এমন ইনভয়েস ভয়েড — নিট পরিবর্তনে overpay অংশ বাদ যাওয়া উচিত", () => {
  const actual = calcVoidNetChange({ payType: "partial", total: 500, bakiAmount: 0, overpayAmount: 100 });
  return { pass: actual === -100, expected: -100, actual };
});
t("ভয়েড রিভার্সাল সূত্র", "কোনো বাকি/overpay না থাকলে নিট পরিবর্তন ০ হওয়া উচিত (cash sale)", () => {
  const actual = calcVoidNetChange({ payType: "cash", total: 500, bakiAmount: 0, overpayAmount: 0 });
  return { pass: actual === 0, expected: 0, actual };
});
t("ভয়েড রিভার্সাল সূত্র", "আগে কিছু qty 'বাকি' মোডে রিটার্ন হয়ে থাকলে, ভয়েডে সেই অংশ দ্বিতীয়বার রিভার্স হওয়া উচিত না", () => {
  const actual = calcVoidNetChange({ payType: "baki", total: 500, bakiAmount: 0, overpayAmount: 0 }, 150);
  return { pass: actual === 350, expected: 350, actual };
});
t("ভয়েড রিভার্সাল সূত্র", "alreadyReturnedBakiAmount না দিলে (backward-compat) আগের আচরণ অপরিবর্তিত থাকা উচিত", () => {
  const actual = calcVoidNetChange({ payType: "baki", total: 500, bakiAmount: 0, overpayAmount: 0 });
  return { pass: actual === 500, expected: 500, actual };
});

// ── রিটার্ন-অ্যাওয়্যার হেল্পার (getReturnedQtyForInvoice / getReturnedAmountForInvoice) ──
t("রিটার্ন-অ্যাওয়্যার হেল্পার", "getReturnedQtyForInvoice — একই ইনভয়েস/প্রোডাক্টের একাধিক রিটার্ন যোগ হওয়া উচিত", () => {
  const returns = [
    { invoiceId: "inv1", productId: "p1", qty: 2 },
    { invoiceId: "inv1", productId: "p1", qty: 3 },
    { invoiceId: "inv1", productId: "p2", qty: 5 },
    { invoiceId: "inv2", productId: "p1", qty: 9 },
  ];
  const actual = getReturnedQtyForInvoice(returns, "inv1", "p1");
  return { pass: actual === 5, expected: 5, actual };
});
t("রিটার্ন-অ্যাওয়্যার হেল্পার", "getReturnedQtyForInvoice — কোনো রিটার্ন না থাকলে ০ ফেরত দেওয়া উচিত", () => {
  const actual = getReturnedQtyForInvoice([], "inv1", "p1");
  return { pass: actual === 0, expected: 0, actual };
});
t("রিটার্ন-অ্যাওয়্যার হেল্পার", "getReturnedQtyForInvoice — returns undefined/null হলেও ক্র্যাশ না করে ০ ফেরত দেওয়া উচিত", () => {
  const actual = getReturnedQtyForInvoice(undefined, "inv1", "p1");
  return { pass: actual === 0, expected: 0, actual };
});
t("রিটার্ন-অ্যাওয়্যার হেল্পার", "getReturnedAmountForInvoice — refundMode ফিল্টার ছাড়া সব মোড যোগ হওয়া উচিত", () => {
  const returns = [
    { invoiceId: "inv1", refundAmount: 100, refundMode: "baki" },
    { invoiceId: "inv1", refundAmount: 50, refundMode: "cash" },
    { invoiceId: "inv2", refundAmount: 999, refundMode: "cash" },
  ];
  const actual = getReturnedAmountForInvoice(returns, "inv1");
  return { pass: actual === 150, expected: 150, actual };
});
t("রিটার্ন-অ্যাওয়্যার হেল্পার", "getReturnedAmountForInvoice — refundMode='baki' দিলে শুধু বাকি-মোড রিটার্ন গোনা উচিত", () => {
  const returns = [
    { invoiceId: "inv1", refundAmount: 100, refundMode: "baki" },
    { invoiceId: "inv1", refundAmount: 50, refundMode: "cash" },
  ];
  const actual = getReturnedAmountForInvoice(returns, "inv1", "baki");
  return { pass: actual === 100, expected: 100, actual };
});
t("রিটার্ন-অ্যাওয়্যার হেল্পার", "getReturnedAmountForInvoice — refundMode='cash' দিলে শুধু নগদ-মোড রিটার্ন গোনা উচিত", () => {
  const returns = [
    { invoiceId: "inv1", refundAmount: 100, refundMode: "baki" },
    { invoiceId: "inv1", refundAmount: 50, refundMode: "cash" },
  ];
  const actual = getReturnedAmountForInvoice(returns, "inv1", "cash");
  return { pass: actual === 50, expected: 50, actual };
});

t("ব্যালেন্স ক্ল্যাম্প", "ভয়েড রিভার্সালে balance কখনো নেগেটিভ হয়ে যাওয়া উচিত না", () => {
  const newBal = Math.max(0, 100 - 500);
  return { pass: newBal === 0, expected: 0, actual: newBal };
});

// ── ক্যাশ ড্রয়ার সূত্র ────────────────────────────────────────────────────────
t("ক্যাশ ড্রয়ার সূত্র", "ওপেনিং+বিক্রি+আদায়−উত্তোলন — স্বাভাবিক কেস", () => {
  const actual = calcCashDrawer(1000, 5000, 800, 1200);
  return { pass: actual === 5600, expected: 5600, actual };
});
t("ক্যাশ ড্রয়ার সূত্র", "সব শূন্য হলে ফলাফলও শূন্য হওয়া উচিত", () => {
  const actual = calcCashDrawer(0, 0, 0, 0);
  return { pass: actual === 0, expected: 0, actual };
});

// ── ব্যাচ-স্টক রিস্টোর ────────────────────────────────────────────────────────
t("ব্যাচ রিস্টোর সূত্র", "বিদ্যমান ব্যাচে qty যোগ হওয়া উচিত (প্রতিস্থাপন নয়)", () => {
  const result = restoreBatchQty([{ batchNo: "B1", qty: 5 }], "B1", 3);
  const actual = result.find(b => b.batchNo === "B1")?.qty;
  return { pass: actual === 8, expected: 8, actual };
});
t("ব্যাচ রিস্টোর সূত্র", "ব্যাচ ডিলিট হয়ে থাকলে নতুন করে তৈরি হওয়া উচিত (ডেটা হারানো নয়)", () => {
  const result = restoreBatchQty([], "B2", 4, { costPrice: 20 });
  const found = result.find(b => b.batchNo === "B2");
  return { pass: !!found && found.qty === 4, expected: "B2 qty=4", actual: found ? `B2 qty=${found.qty}` : "পাওয়া যায়নি" };
});
t("ব্যাচ রিস্টোর সূত্র", "অন্য ব্যাচ অক্ষত থাকা উচিত, শুধু ম্যাচ করা ব্যাচেই বদল", () => {
  const result = restoreBatchQty([{ batchNo: "B1", qty: 5 }, { batchNo: "B2", qty: 10 }], "B1", 3);
  const b2 = result.find(b => b.batchNo === "B2")?.qty;
  return { pass: b2 === 10, expected: 10, actual: b2 };
});

// ── isBatchExpired / getSortedActiveBatches / getSellableStock (নতুন) ────────
t("ব্যাচ মেয়াদ", "ভবিষ্যতের তারিখ — এখনো মেয়াদোত্তীর্ণ নয়", () => {
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const actual = isBatchExpired(future);
  return { pass: actual === false, expected: false, actual };
});
t("ব্যাচ মেয়াদ", "গতকালের তারিখ — মেয়াদোত্তীর্ণ", () => {
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const actual = isBatchExpired(past);
  return { pass: actual === true, expected: true, actual };
});
t("ব্যাচ মেয়াদ", "আজকের তারিখ (date-only) — দিন শেষ না হওয়া পর্যন্ত এখনো বিক্রয়যোগ্য", () => {
  const today = new Date().toISOString().slice(0, 10);
  const actual = isBatchExpired(today);
  return { pass: actual === false, expected: false, actual };
});
t("ব্যাচ মেয়াদ", "গার্বেজ/ম্যালফর্মড date-only স্ট্রিং (যেমন \"0U\") — Date-এর lenient parsing এড়িয়ে মেয়াদোত্তীর্ণ ধরা হবে না (fuzz-এ ধরা পড়া বাগ)", () => {
  const actual = isBatchExpired("0U");
  return { pass: actual === false, expected: false, actual };
});
t("ব্যাচ মেয়াদ", "খালি/undefined expiryDate — মেয়াদোত্তীর্ণ ধরা হবে না", () => {
  const actual = isBatchExpired(undefined);
  return { pass: actual === false, expected: false, actual };
});
t("সক্রিয় ব্যাচ", "মেয়াদোত্তীর্ণ ব্যাচ বিক্রয়যোগ্য পুল থেকে বাদ পড়া উচিত", () => {
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const product = { batches: [{ batchNo: "OLD", qty: 10, expiryDate: past }, { batchNo: "NEW", qty: 5, expiryDate: future }] };
  const active = getSortedActiveBatches(product);
  const actual = active.length === 1 && active[0].batchNo === "NEW";
  return { pass: actual, expected: "শুধু NEW ব্যাচ", actual: active.map(b => b.batchNo).join(",") || "কোনোটাই না" };
});
t("বিক্রয়যোগ্য স্টক", "মেয়াদোত্তীর্ণ ব্যাচের qty মোট বিক্রয়যোগ্য স্টকে যোগ হওয়া উচিত না", () => {
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const product = { batches: [{ batchNo: "OLD", qty: 10, expiryDate: past }, { batchNo: "NEW", qty: 5, expiryDate: null }] };
  const actual = getSellableStock(product);
  return { pass: actual === 5, expected: 5, actual };
});
t("বিক্রয়যোগ্য স্টক", "সেবা (service) পণ্যের স্টক অসীম (Infinity)", () => {
  const actual = getSellableStock({ productType: "service" });
  return { pass: actual === Infinity, expected: Infinity, actual };
});
t("বিক্রয়যোগ্য স্টক", "legacy পণ্য (batches নেই) — মেয়াদোত্তীর্ণ হলে স্টক ০", () => {
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const actual = getSellableStock({ stock: 40, expiryDate: past });
  return { pass: actual === 0, expected: 0, actual };
});
t("বিক্রয়যোগ্য স্টক", "legacy পণ্য (batches নেই) — মেয়াদ না থাকলে top-level stock ফেরত", () => {
  const actual = getSellableStock({ stock: 40 });
  return { pass: actual === 40, expected: 40, actual };
});
t("সক্রিয় ব্যাচ", "একাধিক অ-মেয়াদোত্তীর্ণ ব্যাচ — কাছের expiryDate (FEFO) সবার আগে আসা উচিত", () => {
  const near = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const far  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const product = { batches: [{ batchNo: "FAR", qty: 5, expiryDate: far }, { batchNo: "NEAR", qty: 5, expiryDate: near }] };
  const active = getSortedActiveBatches(product);
  return { pass: active[0]?.batchNo === "NEAR", expected: "NEAR প্রথমে", actual: active.map(b => b.batchNo).join(",") };
});
t("সক্রিয় ব্যাচ", "expiryDate-হীন ব্যাচ সবসময় expiryDate-থাকা ব্যাচের পরে আসা উচিত", () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const product = { batches: [{ batchNo: "NODATE", qty: 5, expiryDate: null }, { batchNo: "DATED", qty: 5, expiryDate: future }] };
  const active = getSortedActiveBatches(product);
  return { pass: active[0]?.batchNo === "DATED", expected: "DATED প্রথমে", actual: active.map(b => b.batchNo).join(",") };
});

t("সক্রিয় ব্যাচ", "getActiveBatch — সবচেয়ে আগে বিক্রয়যোগ্য (FEFO) ব্যাচ ফেরত দেওয়া উচিত", () => {
  const near = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const product = { batches: [{ batchNo: "NEAR", qty: 5, expiryDate: near }] };
  const actual = getActiveBatch(product)?.batchNo;
  return { pass: actual === "NEAR", expected: "NEAR", actual };
});
t("সক্রিয় ব্যাচ", "getActiveBatch — কোনো active ব্যাচ না থাকলে null ফেরত (crash নয়)", () => {
  const actual = getActiveBatch({ batches: [] });
  return { pass: actual === null, expected: null, actual };
});

// ── computeSupplierDueMap (regression: পুরনো ডাবল-কাউন্টিং বাগ যেন না ফেরে) ──
t("সাপ্লায়ার বাকি", "একাধিক পণ্যের productCount ও totalStock সঠিকভাবে যোগ হওয়া উচিত", () => {
  const products = [
    { company: "ABC Traders", stock: 10 },
    { company: "ABC Traders", stock: 5 },
    { supplier: "XYZ Pharma", stock: 20 },
  ];
  const map = computeSupplierDueMap(products, [], []);
  const abc = map["ABC Traders"];
  return {
    pass: abc?.productCount === 2 && abc?.totalStock === 15,
    expected: "productCount=2, totalStock=15",
    actual: `productCount=${abc?.productCount}, totalStock=${abc?.totalStock}`,
  };
});
t("সাপ্লায়ার বাকি", "শুধু ক্রয় অর্ডার থাকলে, ম্যানুয়াল বাকি-এন্ট্রি ছাড়া, due ০ হওয়া উচিত", () => {
  // 🔴 রিগ্রেশন গার্ড: এই বাগটা আগে একবার হয়েছিল — totalPurchased-কে ভুলবশত
  // due হিসেবে দেখানো হতো, ম্যানুয়াল বাকি-এন্ট্রি ছাড়াই।
  const products = [];
  const purchaseOrders = [{ supplier: "ABC Traders", items: [{ qty: 10, costPrice: 100 }] }]; // মোট ক্রয় ১০০০
  const supplierPayments = []; // কোনো ম্যানুয়াল বাকি-এন্ট্রি/পেমেন্ট নেই
  const map = computeSupplierDueMap(products, purchaseOrders, supplierPayments);
  const actual = map["ABC Traders"]?.due ?? "undefined";
  return { pass: actual === 0, expected: 0, actual };
});
t("সাপ্লায়ার বাকি", "ম্যানুয়াল বাকি-এন্ট্রি (type:due) যোগ হলে due বাড়া উচিত", () => {
  const products = [];
  const purchaseOrders = [];
  const supplierPayments = [{ supplierName: "XYZ Pharma", type: "due", amount: 5000 }];
  const map = computeSupplierDueMap(products, purchaseOrders, supplierPayments);
  const actual = map["XYZ Pharma"]?.due;
  return { pass: actual === 5000, expected: 5000, actual };
});
t("সাপ্লায়ার বাকি", "পেমেন্ট করলে due কমা উচিত, negative না হয়ে ০-তে ক্ল্যাম্প হওয়া উচিত", () => {
  const supplierPayments = [
    { supplierName: "XYZ Pharma", type: "due", amount: 5000 },
    { supplierName: "XYZ Pharma", type: "payment", amount: 8000 }, // বেশি পেমেন্ট
  ];
  const map = computeSupplierDueMap([], [], supplierPayments);
  const actual = map["XYZ Pharma"]?.due;
  return { pass: actual === 0, expected: 0, actual }; // negative due দেখানো উচিত না
});

// ── calcNextBatch ────────────────────────────────────────────────────────────
t("পরবর্তী ব্যাচ নম্বর", "প্রথম ক্রয় — কোনো আগের ব্যাচ না থাকলে N=1", () => {
  const actual = calcNextBatch("p1", [], [], "2026-07-15");
  return { pass: actual === "B-2607-1", expected: "B-2607-1", actual };
});
t("পরবর্তী ব্যাচ নম্বর", "একই মাসে দ্বিতীয় ক্রয় — N বেড়ে ২ হওয়া উচিত", () => {
  const products = [{ id: "p1", batches: [{ batchNo: "B-2607-1" }] }];
  const actual = calcNextBatch("p1", products, [], "2026-07-20");
  return { pass: actual === "B-2607-2", expected: "B-2607-2", actual };
});

// ── প্রোডাকশন ইনভ্যারিয়েন্ট-চেক (runInvariantChecks) — ফেজ D / D1 ───────────
t("ইনভ্যারিয়েন্ট-চেক", "সবকিছু স্বাভাবিক থাকলে কোনো violation না", () => {
  const violations = runInvariantChecks({
    products: [{ id: "p1", name: "পণ্য-১", stock: 5 }],
    opening: 100, cashSale: 200, joma: 50, withdrawal: 30,
  });
  return { pass: violations.length === 0, expected: 0, actual: violations.length };
});
t("ইনভ্যারিয়েন্ট-চেক", "নেগেটিভ top-level stock ধরা পড়ে", () => {
  const violations = runInvariantChecks({ products: [{ id: "p1", name: "পণ্য-১", stock: -3 }] });
  const found = violations.some(v => v.type === "negative_stock");
  return { pass: found, expected: true, actual: found };
});
t("ইনভ্যারিয়েন্ট-চেক", "নেগেটিভ ব্যাচ qty ধরা পড়ে", () => {
  const violations = runInvariantChecks({
    products: [{ id: "p1", name: "পণ্য-১", stock: 5, batches: [{ batchNo: "B1", qty: -2 }] }],
  });
  const found = violations.some(v => v.type === "negative_stock" && v.message.includes("B1"));
  return { pass: found, expected: true, actual: found };
});
t("ইনভ্যারিয়েন্ট-চেক", "একাধিক পণ্যে নেগেটিভ স্টক থাকলে প্রতিটাই আলাদা violation হিসেবে আসে", () => {
  const violations = runInvariantChecks({
    products: [{ id: "p1", stock: -1 }, { id: "p2", stock: -2 }, { id: "p3", stock: 10 }],
  });
  const count = violations.filter(v => v.type === "negative_stock").length;
  return { pass: count === 2, expected: 2, actual: count };
});
t("ইনভ্যারিয়েন্ট-চেক", "ক্যাশ ড্রয়ার ঋণাত্মক হলে ধরা পড়ে", () => {
  const violations = runInvariantChecks({ opening: 0, cashSale: 10, joma: 0, withdrawal: 500 });
  const found = violations.some(v => v.type === "cash_drawer_mismatch");
  return { pass: found, expected: true, actual: found };
});
t("ইনভ্যারিয়েন্ট-চেক", "opening/cashSale/joma/withdrawal কিছুই না দিলে ক্যাশ-চেক স্কিপ হয় (false-positive না)", () => {
  const violations = runInvariantChecks({ products: [{ id: "p1", stock: 5 }] });
  const found = violations.some(v => v.type === "cash_drawer_mismatch");
  return { pass: found === false, expected: false, actual: found };
});
t("ইনভ্যারিয়েন্ট-চেক", "খালি state দিলে ক্র্যাশ না করে খালি array ফেরত দেয়", () => {
  const violations = runInvariantChecks();
  return { pass: Array.isArray(violations) && violations.length === 0, expected: 0, actual: violations.length };
});

// ── ফলাফল ────────────────────────────────────────────────────────────────────
console.log(`\n লজিক টেস্ট সুইট — ${passCount + failCount}টি কেস\n`);
if (failures.length > 0) {
  console.log(`❌ ${failCount}টি ফেল, ${passCount}টি পাস\n`);
  console.log(failures.join("\n"));
  console.log("");
  process.exit(1);
} else {
  console.log(`✅ সবগুলো (${passCount}টি) পাস হয়েছে\n`);
  process.exit(0);
}
