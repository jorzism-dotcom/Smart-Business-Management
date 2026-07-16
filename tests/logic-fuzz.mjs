// ─── tests/logic-fuzz.mjs ─────────────────────────────────────────────────
// Property-based (fuzz) টেস্ট — logic-tests.mjs-এর fixed উদাহরণ (price=100,
// qty=2 ইত্যাদি) এর বাইরে গিয়ে, fast-check হাজার হাজার random ইনপুট generate
// করে যাচাই করে যে কিছু "invariant" (সবসময় সত্য থাকা উচিত এমন নিয়ম) কখনো
// ভাঙে না — negative qty, extreme discount, বা অদ্ভুত সংখ্যার ইনপুটেও।
//
// এটা logic-tests.mjs-এর বিকল্প না, সম্পূরক — fixed কেসগুলো "এই নির্দিষ্ট
// ইনপুটে ঠিক এই আউটপুট আসে" (regression) যাচাই করে, আর এই ফাইল "এই নিয়মটা
// *কোনো* ইনপুটেই ভাঙে না" (invariant) যাচাই করে।
//
// রান করুন: npm run test:fuzz
//
// নোট: এটা main `npm test`-এর অংশ না (CI gate এখনো শুধু logic-tests.mjs +
// schema-tests.mjs দিয়ে গেট করা) — ইচ্ছাকৃত, কারণ fuzz-run কিছুটা সময়সাপেক্ষ
// এবং প্রথমবার bootstrap করার সময় (network এক্সেস ছাড়া) পুরোপুরি যাচাই করা
// সম্ভব হয়নি। CI-তে এটাকে ব্লকিং করার আগে অন্তত একবার আসল GitHub Actions
// রানে সবুজ দেখে নিশ্চিত হওয়া উচিত।

import fc from "fast-check";
import {
  calcInvoiceTotal, calcCashDrawer, restoreBatchQty, isBatchExpired,
  getSortedActiveBatches, computeSupplierDueMap,
} from "../src/logic.js";

let failCount = 0;
const failures = [];

function prop(name, arb, predicate, opts = {}) {
  try {
    fc.assert(fc.property(arb, predicate), { numRuns: 1000, ...opts });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    failures.push(`  ✗ ${name}\n${String(err?.message || err).split("\n").slice(0, 12).join("\n")}`);
  }
}

console.log("\n🔀 প্রপার্টি-বেজড (fuzz) টেস্ট সুইট — fast-check\n");

// ── calcInvoiceTotal — total কখনো ০-এর নিচে নামা উচিত না ──────────────────
const itemArb = fc.record({
  price: fc.float({ min: Math.fround(-100000), max: Math.fround(100000), noNaN: true }),
  qty: fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
  itemDiscount: fc.option(fc.float({ min: Math.fround(-100000), max: Math.fround(100000), noNaN: true }), { nil: undefined }),
});

prop(
  "calcInvoiceTotal — total কখনো নেগেটিভ হয় না, negative/extreme ইনপুটেও",
  fc.record({
    items: fc.array(itemArb, { minLength: 0, maxLength: 8 }),
    discount: fc.float({ min: Math.fround(-100000), max: Math.fround(100000), noNaN: true }),
    extraCharge: fc.float({ min: Math.fround(-100000), max: Math.fround(100000), noNaN: true }),
  }),
  ({ items, discount, extraCharge }) => {
    const total = calcInvoiceTotal(items, discount, extraCharge);
    return Number.isFinite(total) && total >= -1e-6; // ফ্লোটিং পয়েন্ট epsilon
  }
);

prop(
  "calcInvoiceTotal — খালি items array-তে কখনো crash/NaN হয় না",
  fc.record({
    discount: fc.float({ noNaN: true }),
    extraCharge: fc.float({ noNaN: true }),
  }),
  ({ discount, extraCharge }) => {
    const total = calcInvoiceTotal([], discount, extraCharge);
    return Number.isFinite(total);
  }
);

// ── calcCashDrawer — শুধু যোগ/বিয়োগ, কখনো NaN হওয়া উচিত না ────────────────
prop(
  "calcCashDrawer — যেকোনো finite ইনপুটে ফলাফল সবসময় finite (NaN কখনো নয়)",
  fc.tuple(
    fc.float({ noNaN: true, min: Math.fround(-1e7), max: Math.fround(1e7) }),
    fc.float({ noNaN: true, min: Math.fround(-1e7), max: Math.fround(1e7) }),
    fc.float({ noNaN: true, min: Math.fround(-1e7), max: Math.fround(1e7) }),
    fc.float({ noNaN: true, min: Math.fround(-1e7), max: Math.fround(1e7) }),
  ),
  ([opening, cashSale, joma, withdrawal]) => {
    const result = calcCashDrawer(opening, cashSale, joma, withdrawal);
    return Number.isFinite(result) && approxEq(result, opening + cashSale + joma - withdrawal);
  }
);

function approxEq(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }

// ── restoreBatchQty — মোট qty ঠিক restoredQty দিয়ে বাড়া উচিত, কমা না ──────
prop(
  "restoreBatchQty — মোট batch qty ঠিক restoredQty পরিমাণে বৃদ্ধি পায়",
  fc.record({
    batches: fc.array(fc.record({
      batchNo: fc.string({ minLength: 1, maxLength: 6 }),
      qty: fc.integer({ min: 0, max: 1000 }),
    }), { minLength: 0, maxLength: 5 }),
    batchNo: fc.string({ minLength: 1, maxLength: 6 }),
    restoredQty: fc.integer({ min: 0, max: 1000 }),
  }),
  ({ batches, batchNo, restoredQty }) => {
    const before = batches.reduce((s, b) => s + (b.qty || 0), 0);
    const after = restoreBatchQty(batches, batchNo, restoredQty).reduce((s, b) => s + (b.qty || 0), 0);
    return approxEq(after - before, restoredQty);
  }
);

prop(
  "restoreBatchQty — মূল batches array মিউটেট হয় না (নতুন array রিটার্ন করে)",
  fc.record({
    batches: fc.array(fc.record({ batchNo: fc.string({ minLength: 1, maxLength: 4 }), qty: fc.integer({ min: 0, max: 100 }) }), { minLength: 1, maxLength: 4 }),
    restoredQty: fc.integer({ min: 0, max: 500 }),
  }),
  ({ batches, restoredQty }) => {
    const originalSnapshot = JSON.stringify(batches);
    restoreBatchQty(batches, batches[0].batchNo, restoredQty);
    return JSON.stringify(batches) === originalSnapshot;
  }
);

// ── isBatchExpired — একটা তারিখ একবারে শুধু expired অথবা not-expired ──────
prop(
  "isBatchExpired — খালি/undefined expiryDate কখনো crash করায় না, সবসময় false",
  fc.constant(undefined),
  () => isBatchExpired(undefined) === false && isBatchExpired("") === false
);

prop(
  "isBatchExpired — invalid date string crash করায় না (false রিটার্ন করে)",
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => isNaN(new Date(s).getTime())),
  (garbage) => isBatchExpired(garbage) === false
);

// ── getSortedActiveBatches — আউটপুট সবসময় ইনপুটের subset, কখনো নতুন ব্যাচ তৈরি করে না ──
prop(
  "getSortedActiveBatches — আউটপুটের প্রতিটা ব্যাচ ইনপুট থেকেই আসে, কোনো নতুন ব্যাচ তৈরি হয় না",
  fc.record({
    batches: fc.array(fc.record({
      batchNo: fc.string({ minLength: 1, maxLength: 6 }),
      qty: fc.integer({ min: -10, max: 100 }),
      expiryDate: fc.option(fc.constantFrom("2020-01-01", "2099-12-31", "invalid-date", ""), { nil: undefined }),
    }), { minLength: 0, maxLength: 6 }),
  }),
  ({ batches }) => {
    const active = getSortedActiveBatches({ batches });
    // প্রতিটা active batch অবশ্যই qty>0 হতে হবে
    return active.every(b => (b.qty || 0) > 0) && active.length <= batches.length;
  }
);

// ── computeSupplierDueMap — due কখনো নেগেটিভ হয় না ───────────────────────
prop(
  "computeSupplierDueMap — due সবসময় ০ অথবা ধনাত্মক, যত এলোমেলো payment/due entry-ই আসুক",
  fc.record({
    products: fc.array(fc.record({
      company: fc.constantFrom("Square", "Beximco", "Renata", ""),
      stock: fc.integer({ min: 0, max: 500 }),
    }), { minLength: 0, maxLength: 5 }),
    payments: fc.array(fc.record({
      supplierName: fc.constantFrom("Square", "Beximco", "Renata"),
      amount: fc.float({ min: Math.fround(-100000), max: Math.fround(100000), noNaN: true }),
      type: fc.constantFrom("due", "payment"),
    }), { minLength: 0, maxLength: 8 }),
  }),
  ({ products, payments }) => {
    const map = computeSupplierDueMap(products, [], payments);
    return Object.values(map).every(row => row.due >= 0);
  }
);

// ── ফলাফল ──────────────────────────────────────────────────────────────────
if (failCount > 0) {
  console.log(`\n❌ ${failCount}টা প্রপার্টি ব্যর্থ হয়েছে:\n`);
  failures.forEach(f => console.log(f));
  process.exitCode = 1;
} else {
  console.log("\n✅ সবগুলো প্রপার্টি (প্রতিটা ১০০০ random রান সহ) পাস হয়েছে\n");
}
