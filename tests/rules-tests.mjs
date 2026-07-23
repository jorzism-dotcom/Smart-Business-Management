// tests/rules-tests.mjs
//
// firestore.rules-এর বিরুদ্ধে টেস্ট — আসল Firestore Emulator চালিয়ে (কোনো
// প্রোডাকশন প্রজেক্ট ছোঁয়া হয় না, `demo-sbm-test` সম্পূর্ণ অফলাইন প্রজেক্ট)।
//
// রান করার আগে emulator চালু থাকতে হবে:
//   npx firebase emulators:exec --only firestore "node tests/rules-tests.mjs"
// অথবা প্যাকেজ স্ক্রিপ্ট দিয়ে:
//   npm run test:rules
//
// ⚠️ গুরুত্বপূর্ণ প্রেক্ষাপট (firestore.rules-এর কমেন্টেও লেখা আছে):
// এই অ্যাপ Firebase Auth ব্যবহার করে না, তাই এই টেস্ট স্যুট "কে read/write
// করতে পারবে" সেটা যাচাই করে না (এই architecture-এ সেটা সম্ভবই না) — শুধু
// "কী write করা যাবে" (shape/schema validation) যাচাই করে। যেখানে rules
// ইচ্ছাকৃতভাবে খোলা (`if true`) সেখানে টেস্ট সেটাকেই canary হিসেবে ধরে রাখে,
// যাতে ভবিষ্যতে কেউ অজান্তে rules কড়া করে ফেললে regression ধরা পড়ে, আবার
// কেউ ইচ্ছাকৃতভাবে কড়া করলে (যেমন Auth যোগ হওয়ার পর) এই টেস্টগুলো failing
// দেখিয়ে মনে করিয়ে দেবে যে canary case-গুলো আপডেট করতে হবে।

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc, setDoc, updateDoc, getDoc, getDocs, collection,
} from "firebase/firestore";

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}

async function main() {
  console.log("\n🔥 Firestore Rules টেস্ট সুইট (emulator-নির্ভর)\n");

  const testEnv = await initializeTestEnvironment({
    projectId: "demo-sbm-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // এই অ্যাপে কোনো Firebase Auth নেই — তাই সব টেস্ট unauthenticated context
  // থেকেই চালানো হচ্ছে, যেটা বাস্তব production behavior-এর সাথে মেলে।
  const unauth = testEnv.unauthenticatedContext();
  const db = unauth.firestore();

  await testEnv.clearFirestore();

  // ── customers ──────────────────────────────────────────────────────────
  await check("customers: বৈধ balance দিয়ে create সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "customers/c1"), { name: "রহিম", balance: 500 }));
  });
  await check("customers: ঋণাত্মক balance দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "customers/c2"), { name: "করিম", balance: -100 }));
  });
  await check("customers: balance স্ট্রিং হলে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "customers/c3"), { name: "জামাল", balance: "500" }));
  });
  await check("customers: name সংখ্যা হলে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "customers/c4"), { name: 12345 }));
  });
  await check("customers: ঋণাত্মক loyaltyPoints দিয়ে update ব্যর্থ হয়", async () => {
    await setDoc(doc(db, "customers/c5"), { name: "সালাম", balance: 0 });
    await assertFails(updateDoc(doc(db, "customers/c5"), { loyaltyPoints: -5 }));
  });
  await check("customers: read সবসময় খোলা", async () => {
    await assertSucceeds(getDoc(doc(db, "customers/c1")));
  });
  await check("customers: delete সবসময় খোলা (canary — Auth যোগ হলে বদলাবে)", async () => {
    await assertSucceeds(setDoc(doc(db, "customers/cdel"), { name: "টেস্ট" }));
    await import("firebase/firestore").then(({ deleteDoc }) => deleteDoc(doc(db, "customers/cdel")));
  });

  // ── products ───────────────────────────────────────────────────────────
  await check("products: বৈধ stock/price দিয়ে create সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "products/p1"), { stock: 10, price: 100, costPrice: 60 }));
  });
  await check("products: ঋণাত্মক stock দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "products/p2"), { stock: -1, price: 100 }));
  });
  await check("products: ঋণাত্মক costPrice দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "products/p3"), { stock: 5, costPrice: -10 }));
  });

  // ── invoices ───────────────────────────────────────────────────────────
  await check("invoices: বৈধ status/payType দিয়ে create সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "invoices/i1"), { total: 250, status: "active", payType: "cash" }));
  });
  await check("invoices: অজানা status দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "invoices/i2"), { total: 250, status: "deleted" }));
  });
  await check("invoices: অজানা payType দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "invoices/i3"), { total: 250, payType: "bkash" }));
  });
  await check("invoices: ঋণাত্মক total দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "invoices/i4"), { total: -50 }));
  });

  // ── txns ───────────────────────────────────────────────────────────────
  await check("txns: বৈধ type দিয়ে create সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "txns/t1"), { amount: 100, type: "baki" }));
  });
  await check("txns: অজানা type দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "txns/t2"), { amount: 100, type: "refund" }));
  });
  await check("txns: ঋণাত্মক amount দিয়ে create ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "txns/t3"), { amount: -10, type: "joma" }));
  });

  // ── purchaseOrders / stockMovements / cashLogs / paymentInvoices ────────
  await check("purchaseOrders: ঋণাত্মক totalCost ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "purchaseOrders/po1"), { totalCost: -1 }));
  });
  await check("stockMovements: qty সংখ্যা না হলে ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "stockMovements/sm1"), { qty: "ten" }));
  });
  await check("cashLogs: ঋণাত্মক amount ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "cashLogs/cl1"), { amount: -20 }));
  });
  await check("paymentInvoices: ঋণাত্মক amount ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "paymentInvoices/pi1"), { amount: -20 }));
  });

  // ── users — role escalation gap (KNOWN, DOCUMENTED, NOT FIXED IN PHASE 0) ─
  await check("users: role শুধু admin/staff-এর মধ্যেই limited", async () => {
    await assertFails(setDoc(doc(db, "users/u1"), { role: "superadmin" }));
  });
  await check(
    "users: [canary] role:admin unauthenticated অবস্থাতেও সেট করা যায় — " +
    "এটা ঠিক করতে Firebase Auth + custom claims লাগবে (Phase 0-এর বাইরে, দেখুন PHASE0_NOTES.md)",
    async () => {
      await assertSucceeds(setDoc(doc(db, "users/u2"), { role: "admin", username: "faketest" }));
    }
  );

  // ── meta/businessConfig ───────────────────────────────────────────────
  await check("meta/businessConfig: বৈধ businessType সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "meta/businessConfig"), { businessType: "pharmacy", businessTypeLocked: true }));
  });
  await check("meta/businessConfig: অজানা businessType ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "meta/businessConfig"), { businessType: "grocery" }));
  });
  await check("meta/businessConfig: businessTypeLocked bool না হলে ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "meta/businessConfig"), { businessTypeLocked: "yes" }));
  });
  await check("meta: অন্য meta ডকুমেন্ট (businessConfig ছাড়া) সবসময় খোলা", async () => {
    await assertSucceeds(setDoc(doc(db, "meta/resetMarker"), { anything: 123 }));
  });

  // ── meta/businessConfig — ধাপ ২: enabledBusinessTypes/activeBusinessType ──
  await check("meta/businessConfig: businessType=semen সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "meta/businessConfig"), { businessType: "semen" }));
  });
  await check("meta/businessConfig: বৈধ enabledBusinessTypes array সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "meta/businessConfig"), { enabledBusinessTypes: ["pharmacy", "semen"] }));
  });
  await check("meta/businessConfig: enabledBusinessTypes খালি array হলে ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "meta/businessConfig"), { enabledBusinessTypes: [] }));
  });
  await check("meta/businessConfig: enabledBusinessTypes-এ অজানা টাইপ থাকলে ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "meta/businessConfig"), { enabledBusinessTypes: ["pharmacy", "grocery"] }));
  });
  await check("meta/businessConfig: activeBusinessType enabledBusinessTypes-এর সদস্য হলে সফল হয়", async () => {
    await assertSucceeds(setDoc(doc(db, "meta/businessConfig"), { enabledBusinessTypes: ["pharmacy", "semen"], activeBusinessType: "semen" }));
  });
  await check("meta/businessConfig: activeBusinessType enabledBusinessTypes-এর সদস্য না হলে ব্যর্থ হয়", async () => {
    await assertFails(setDoc(doc(db, "meta/businessConfig"), { enabledBusinessTypes: ["pharmacy"], activeBusinessType: "semen" }));
  });

  // ── open collections (এখনো schema rule লেখা হয়নি — roadmap ফেজ ১+) ──────
  for (const col of ["suppliers", "smsLog", "expenses", "returns", "auditLogs", "settings",
    "deletedCustomers", "deletedProducts", "quotations", "supplierPayments", "stats"]) {
    await check(`${col}: সম্পূর্ণ খোলা (schema rule এখনো নেই — future work)`, async () => {
      await assertSucceeds(setDoc(doc(db, `${col}/x1`), { anything: "goes" }));
    });
  }

  // ── ফেজ ১ parity check ────────────────────────────────────────────────
  // rules এখনো request.auth চেক করে না, তাই authenticated context থেকেও
  // ঠিক একই আচরণ হওয়া উচিত — এই কেসটা future-এ ফেজ ৩ (auth enforce) শুরু
  // হলে flip হয়ে "auth ছাড়া ব্যর্থ, auth থাকলে সফল" হবে।
  const authed = testEnv.authenticatedContext("device-uid-1").firestore();
  await check("[ফেজ ১] authenticated context থেকেও একই rules প্রযোজ্য (parity)", async () => {
    await assertSucceeds(setDoc(doc(authed, "customers/c-auth1"), { name: "অথেন্টিকেটেড", balance: 10 }));
    await assertFails(setDoc(doc(authed, "customers/c-auth2"), { name: "ভুল", balance: -10 }));
  });

  await testEnv.cleanup();

  console.log(`\n${failed === 0 ? "✅" : "❌"} মোট ${passed + failed}টা কেসের মধ্যে ${passed}টা পাস, ${failed}টা ফেইল\n`);
  if (failed > 0) {
    console.log("ব্যর্থ কেসসমূহ:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("রুলস টেস্ট রানার ব্যর্থ:", e);
  process.exit(1);
});
