// ─── tests/schema-tests.mjs ───────────────────────────────────────────────
// src/schemas.js-এর validateRecord() ঠিকভাবে কাজ করছে কিনা যাচাই করে —
// বৈধ রেকর্ড pass করা উচিত, আর NaN/undefined-এ করাপ্ট রেকর্ড ধরা পড়া উচিত।
// এই ফাইল `npm test`-এর অংশ (logic-tests.mjs-এর পরপরই চলে), তাই schemas.js-এ
// কোনো ভুল থাকলে সেটাও সাথে সাথে CI-তে ধরা পড়বে।

import { validateRecord } from "../src/schemas.js";

let passCount = 0, failCount = 0;
const failures = [];

function t(name, fn) {
  try {
    const { pass, detail } = fn();
    if (pass) passCount++;
    else { failCount++; failures.push(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
  } catch (err) {
    failCount++;
    failures.push(`  ✗ ${name} — এরর/ক্র্যাশ: ${err?.message || err}`);
  }
}

console.log("\n🧩 স্কিমা ভ্যালিডেশন টেস্ট সুইট\n");

// ── invoices ──────────────────────────────────────────────────────────────
t("বৈধ invoice pass করা উচিত", () => {
  const r = validateRecord("invoices", {
    id: "inv1", total: 500, discount: 0, extraCharge: 0,
    items: [{ productId: "p1", price: 100, qty: 2, costPrice: 50 }],
  });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

t("total NaN হলে invoice ধরা পড়া উচিত", () => {
  const r = validateRecord("invoices", { id: "inv2", total: NaN });
  return { pass: r.valid === false, detail: JSON.stringify(r) };
});

t("total undefined হলে invoice ধরা পড়া উচিত", () => {
  const r = validateRecord("invoices", { id: "inv3" });
  return { pass: r.valid === false, detail: JSON.stringify(r) };
});

t("id খালি স্ট্রিং হলে invoice ধরা পড়া উচিত", () => {
  const r = validateRecord("invoices", { id: "", total: 100 });
  return { pass: r.valid === false, detail: JSON.stringify(r) };
});

t("অতিরিক্ত/অচেনা ফিল্ড থাকলেও (passthrough) invoice ধরা উচিত না", () => {
  const r = validateRecord("invoices", {
    id: "inv4", total: 250, someRandomNewField: "future feature data",
  });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

t("item-এর মধ্যে price Infinity হলে ধরা পড়া উচিত", () => {
  const r = validateRecord("invoices", {
    id: "inv5", total: 100, items: [{ productId: "p1", price: Infinity, qty: 1 }],
  });
  return { pass: r.valid === false, detail: JSON.stringify(r) };
});

// ── products ──────────────────────────────────────────────────────────────
t("বৈধ product pass করা উচিত", () => {
  const r = validateRecord("products", { id: "p1", stock: 10, costPrice: 20, price: 30 });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

t("product stock NaN হলে ধরা পড়া উচিত", () => {
  const r = validateRecord("products", { id: "p1", stock: NaN });
  return { pass: r.valid === false, detail: JSON.stringify(r) };
});

t("numeric (সংখ্যা) id-ও গ্রহণযোগ্য হওয়া উচিত (legacy record)", () => {
  const r = validateRecord("products", { id: 12345, stock: 5 });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

// ── অজানা collection ─────────────────────────────────────────────────────
t("যে collection-এর জন্য schema নেই (settings/users/txns), সেখানে সবসময় valid:true", () => {
  const r = validateRecord("settings", { anything: "goes", broken: NaN, missing: undefined });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

// ── crash-safety ─────────────────────────────────────────────────────────
t("validateRecord কখনো throw করে না — null/undefined data দিলেও", () => {
  const r1 = validateRecord("invoices", null);
  const r2 = validateRecord("invoices", undefined);
  return { pass: r1.valid === false && r2.valid === false };
});

// ── cashLogs / supplierPayments / customers ─────────────────────────────
t("cashLog amount NaN হলে ধরা পড়া উচিত", () => {
  const r = validateRecord("cashLogs", { id: "c1", amount: NaN });
  return { pass: r.valid === false, detail: JSON.stringify(r) };
});

t("customer balance undefined হলেও ঠিক আছে (optional)", () => {
  const r = validateRecord("customers", { id: "cust1" });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

t("supplierPayment বৈধ হলে pass করা উচিত", () => {
  const r = validateRecord("supplierPayments", { id: "sp1", amount: 500, supplierName: "Square", type: "due" });
  return { pass: r.valid === true, detail: JSON.stringify(r) };
});

// ── ফলাফল ──────────────────────────────────────────────────────────────────
console.log(`✅ ${passCount}টা কেস পাস`);
if (failCount > 0) {
  console.log(`❌ ${failCount}টা কেস ব্যর্থ:\n`);
  failures.forEach(f => console.log(f));
  process.exitCode = 1;
} else {
  console.log("সবগুলো (schema) কেস পাস হয়েছে\n");
}
