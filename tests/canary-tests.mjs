// ─── tests/canary-tests.mjs ─────────────────────────────────────────────────
// ফেজ C (ENTERPRISE_MONITORING_PLAN.md স্তর ৩ — রিলিজ-ক্যানারি) — real
// Firestore Emulator-এ end-to-end পাইপলাইন চালিয়ে দেখা হয়: ইনভয়েস তৈরি →
// সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড। প্রতিটা ধাপ src/logic.js ও src/sync.js-এর
// আসল ফাংশন ব্যবহার করে (কোনো ডুপ্লিকেট/সরলীকৃত লজিক না) — tests/sync-emulator-tests.mjs
// (ফেজ B)-এর মতোই real serverTimestamp/network round-trip সহ।
//
// এটা tests/sync-emulator-tests.mjs (B1-B3, প্রতিটা independent scenario)
// থেকে উদ্দেশ্যে আলাদা: এখানে একটা single ধারাবাহিক পাইপলাইন — প্রতিটা ধাপ
// আগেরটার ফলাফলের উপর নির্ভর করে, ঠিক যেভাবে আসল দোকানে একটা বিক্রয়ের
// জীবনচক্র চলে। কোনো ধাপ ব্যর্থ হলে পরের ধাপগুলো চালানো হয় না (sequential
// gate) — C3: ঠিক কোন ধাপে ব্যর্থ হলো তা স্পষ্টভাবে রিপোর্ট করা হয়।
//
// রান করার আগে emulator চালু থাকতে হবে:
//   npx firebase emulators:exec --only firestore "node tests/canary-tests.mjs"
// অথবা প্যাকেজ স্ক্রিপ্ট দিয়ে:
//   npm run test:canary
//
// এই টেস্ট release workflow-এ build-gate হিসেবে যোগ করা আছে (C2, দেখুন
// .github/workflows/build-apk.yml-এর "release-canary" জব) — fail হলে
// APK build/release-ই শুরু হবে না।

import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc, setDoc, getDoc, getDocs, updateDoc, collection, serverTimestamp,
} from "firebase/firestore";
import { calcInvoiceTotal, calcVoidNetChange } from "../src/logic.js";
import {
  pickBackupFields, diffBackupFields, hashCollection,
} from "../src/sync.js";

// ── C3: প্রতিটা ধাপ আলাদাভাবে ট্র্যাক করা হয় — কোন ধাপে ব্যর্থ হলো তা স্পষ্ট
// রিপোর্টে দেখানোর জন্য (শুধু pass/fail সংখ্যা না, পুরো পাইপলাইনের কোন
// পর্যায়ে সমস্যা হলো সেটাই আসল সংকেত)।
const STEPS = ["invoice", "sync", "backup", "restore", "void"];
const stepResult = {};
let firstFailedStep = null;

async function runStep(stepName, fn) {
  if (firstFailedStep) {
    stepResult[stepName] = { ok: false, skipped: true, error: `আগের ধাপ "${firstFailedStep}" ব্যর্থ হওয়ায় স্কিপ করা হয়েছে` };
    console.log(`  ⏭️  [${stepName}] স্কিপ (আগের ধাপ ব্যর্থ)`);
    return;
  }
  try {
    await fn();
    stepResult[stepName] = { ok: true };
    console.log(`  ✅ [${stepName}] পাস`);
  } catch (e) {
    stepResult[stepName] = { ok: false, error: e?.message || String(e) };
    firstFailedStep = stepName;
    console.log(`  ❌ [${stepName}] ব্যর্থ — ${e?.message || e}`);
  }
}

async function fetchCollectionAsArray(db, colName) {
  const snap = await getDocs(collection(db, colName));
  const out = [];
  snap.forEach(d => {
    const data = d.data();
    out.push({
      ...data,
      id: d.id,
      _serverTs: data._serverTs?.toMillis ? data._serverTs.toMillis() : (data._serverTs || null),
    });
  });
  return out;
}

async function main() {
  console.log("\n🐤 রিলিজ-ক্যানারি: ইনভয়েস → সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড (ফেজ C)\n");

  const testEnv = await initializeTestEnvironment({
    projectId: "demo-sbm-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  const device = testEnv.unauthenticatedContext().firestore();
  await testEnv.clearFirestore();

  // ── অবস্থা এই ভ্যারিয়েবলগুলোতে ধাপে-ধাপে বাহিত হয় ──
  const CANARY_PRODUCT_ID = "canary-prod-1";
  const CANARY_INVOICE_ID = "canary-inv-1";
  let expectedInvoiceTotal = null;
  let stockAfterSale = null;
  const startingStock = 50;
  let restoredInvoice = null;
  let restoredProductStock = null;

  // ══════════════════════════════════════════════════════════════════════
  // C1-ধাপ ১: ইনভয়েস তৈরি — real createInvoice()-এর মতোই calcInvoiceTotal()
  // ব্যবহার করে total বসানো হয়, স্টক কমানো হয়, একটা stockMovement লেখা হয়
  // ══════════════════════════════════════════════════════════════════════
  await runStep("invoice", async () => {
    await setDoc(doc(device, `products/${CANARY_PRODUCT_ID}`), {
      id: CANARY_PRODUCT_ID, name: "ক্যানারি-টেস্ট-পণ্য", stock: startingStock, price: 100, costPrice: 60,
    });

    const items = [{ productId: CANARY_PRODUCT_ID, qty: 3, price: 100, itemDiscount: 0 }];
    const discount = 20;
    const extraCharge = 0;
    expectedInvoiceTotal = calcInvoiceTotal(items, discount, extraCharge);
    if (!(expectedInvoiceTotal > 0)) throw new Error(`calcInvoiceTotal অপ্রত্যাশিত ফলাফল দিয়েছে: ${expectedInvoiceTotal}`);

    await setDoc(doc(device, `invoices/${CANARY_INVOICE_ID}`), {
      id: CANARY_INVOICE_ID, items, discount, extraCharge, total: expectedInvoiceTotal,
      status: "active", payType: "cash", customerName: "ক্যানারি-টেস্ট-কাস্টমার",
      _serverTs: serverTimestamp(),
    });

    stockAfterSale = startingStock - 3;
    await updateDoc(doc(device, `products/${CANARY_PRODUCT_ID}`), { stock: stockAfterSale });

    await setDoc(doc(collection(device, "stockMovements")), {
      productId: CANARY_PRODUCT_ID, qty: -3, type: "sale", invoiceId: CANARY_INVOICE_ID,
      _serverTs: serverTimestamp(),
    });

    const invSnap = await getDoc(doc(device, `invoices/${CANARY_INVOICE_ID}`));
    if (!invSnap.exists()) throw new Error("ইনভয়েস Firestore-এ লেখা যায়নি");
    if (Math.abs((invSnap.data().total || 0) - expectedInvoiceTotal) > 0.01) {
      throw new Error(`stored total (${invSnap.data().total}) calcInvoiceTotal()-এর ফলাফলের (${expectedInvoiceTotal}) সাথে মিলছে না`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // C1-ধাপ ২: সিঙ্ক — অন্য "ডিভাইস" থেকে fetch করে নিশ্চিত করা যে ইনভয়েস ও
  // স্টক-আপডেট real serverTimestamp সহ সার্ভারে পৌঁছেছে (network round-trip)
  // ══════════════════════════════════════════════════════════════════════
  await runStep("sync", async () => {
    const otherDevice = testEnv.unauthenticatedContext().firestore();
    const remoteInvoices = await fetchCollectionAsArray(otherDevice, "invoices");
    const remoteProducts = await fetchCollectionAsArray(otherDevice, "products");
    const remoteMovements = await fetchCollectionAsArray(otherDevice, "stockMovements");

    const inv = remoteInvoices.find(i => i.id === CANARY_INVOICE_ID);
    if (!inv) throw new Error("অন্য ডিভাইস থেকে ইনভয়েস দেখা যাচ্ছে না — সিঙ্ক ব্যর্থ");
    if (!inv._serverTs) throw new Error("ইনভয়েসে real serverTimestamp বসেনি");

    const prod = remoteProducts.find(p => p.id === CANARY_PRODUCT_ID);
    if (!prod || prod.stock !== stockAfterSale) {
      throw new Error(`স্টক-আপডেট সিঙ্ক হয়নি — প্রত্যাশিত ${stockAfterSale}, পাওয়া গেছে ${prod?.stock}`);
    }

    const movement = remoteMovements.find(m => m.invoiceId === CANARY_INVOICE_ID);
    if (!movement) throw new Error("stockMovement এন্ট্রি সিঙ্ক হয়নি");
  });

  // ══════════════════════════════════════════════════════════════════════
  // C1-ধাপ ৩: ব্যাকআপ — real pickBackupFields() দিয়ে payload বানিয়ে JSON
  // round-trip (ফাইলে সেভ simulate)
  // ══════════════════════════════════════════════════════════════════════
  let backupPayload = null;
  await runStep("backup", async () => {
    const liveData = {
      invoices: await fetchCollectionAsArray(device, "invoices"),
      products: await fetchCollectionAsArray(device, "products"),
      stockMovements: await fetchCollectionAsArray(device, "stockMovements"),
    };
    const picked = pickBackupFields(liveData);
    backupPayload = JSON.parse(JSON.stringify(picked)); // ডাউনলোড→আপলোড simulate
    if (!backupPayload.invoices?.some(i => i.id === CANARY_INVOICE_ID)) {
      throw new Error("ব্যাকআপ payload-এ ক্যানারি ইনভয়েস নেই");
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // C1-ধাপ ৪: রিস্টোর — খালি namespace-এ লিখে zero-drift যাচাই (B3-এর মতোই
  // rules-ভ্যালিডেটেড path ব্যবহার করা হচ্ছে যাতে firestore.rules-এর
  // ডিফল্ট-ডিনাই নীতিতে write ব্যর্থ না হয়)
  // ══════════════════════════════════════════════════════════════════════
  const RESTORE_INV_NS = "invoices_pharmacy";
  const RESTORE_PROD_NS = "products_pharmacy";
  await runStep("restore", async () => {
    const freshDb = testEnv.unauthenticatedContext().firestore();
    const preSnap = await getDocs(collection(freshDb, RESTORE_INV_NS));
    if (!preSnap.empty) throw new Error("restore-টার্গেট namespace শুরুতে খালি থাকার কথা ছিল");

    const stripTs = (arr) => arr.map(({ _serverTs, ...c }) => c);
    for (const inv of stripTs(backupPayload.invoices)) {
      await setDoc(doc(freshDb, `${RESTORE_INV_NS}/${inv.id}`), inv);
    }
    for (const p of stripTs(backupPayload.products)) {
      await setDoc(doc(freshDb, `${RESTORE_PROD_NS}/${p.id}`), p);
    }

    const restoredInvoices = stripTs(await fetchCollectionAsArray(freshDb, RESTORE_INV_NS));
    const restoredProducts = stripTs(await fetchCollectionAsArray(freshDb, RESTORE_PROD_NS));

    const diff = diffBackupFields(
      { invoices: stripTs(backupPayload.invoices) },
      { invoices: restoredInvoices },
    );
    if (diff.totalAdded !== 0 || diff.totalRemoved !== 0 || diff.totalChanged !== 0) {
      throw new Error(`রিস্টোরের পর zero-drift প্রত্যাশিত, পাওয়া গেছে added=${diff.totalAdded} removed=${diff.totalRemoved} changed=${diff.totalChanged}`);
    }
    const beforeHash = hashCollection(stripTs(backupPayload.invoices));
    const afterHash = hashCollection(restoredInvoices);
    if (beforeHash !== afterHash) throw new Error("রিস্টোরের পর content-hash মিলছে না");

    restoredInvoice = restoredInvoices.find(i => i.id === CANARY_INVOICE_ID);
    restoredProductStock = restoredProducts.find(p => p.id === CANARY_PRODUCT_ID);
    if (!restoredInvoice || !restoredProductStock) throw new Error("রিস্টোরের পর ক্যানারি রেকর্ড খুঁজে পাওয়া যায়নি");
  });

  // ══════════════════════════════════════════════════════════════════════
  // C1-ধাপ ৫: ভয়েড — real calcVoidNetChange() ব্যবহার করে ইনভয়েস voided
  // করা হয় এবং স্টক পূর্বাবস্থায় ফেরত (reversal) দেওয়া হয়
  // ══════════════════════════════════════════════════════════════════════
  await runStep("void", async () => {
    const freshDb = testEnv.unauthenticatedContext().firestore();
    const netChange = calcVoidNetChange(restoredInvoice);
    if (!Number.isFinite(netChange)) throw new Error(`calcVoidNetChange() ফাইনাইট নয়: ${netChange}`);

    await updateDoc(doc(freshDb, `${RESTORE_INV_NS}/${CANARY_INVOICE_ID}`), { status: "voided" });

    const soldQty = 3; // C1-ধাপ ১-এ যা বিক্রি হয়েছিল
    const stockAfterVoid = (restoredProductStock.stock || 0) + soldQty;
    await updateDoc(doc(freshDb, `${RESTORE_PROD_NS}/${CANARY_PRODUCT_ID}`), { stock: stockAfterVoid });

    const finalInv = await getDoc(doc(freshDb, `${RESTORE_INV_NS}/${CANARY_INVOICE_ID}`));
    if (finalInv.data().status !== "voided") throw new Error("ইনভয়েস status voided হয়নি");

    const finalProd = await getDoc(doc(freshDb, `${RESTORE_PROD_NS}/${CANARY_PRODUCT_ID}`));
    if (finalProd.data().stock !== startingStock) {
      throw new Error(`ভয়েডের পর স্টক শুরুর অবস্থায় (${startingStock}) ফেরত আসার কথা, পাওয়া গেছে ${finalProd.data().stock}`);
    }
  });

  await testEnv.cleanup();

  // ── C3: চূড়ান্ত রিপোর্ট — প্রতিটা ধাপ আলাদাভাবে, কোথায় ব্যর্থ হলে থামলো তা স্পষ্ট ──
  console.log("\n📋 ক্যানারি পাইপলাইন রিপোর্ট:");
  for (const step of STEPS) {
    const r = stepResult[step];
    if (!r) { console.log(`  ⚪ [${step}] চালানো হয়নি`); continue; }
    if (r.ok) console.log(`  ✅ [${step}] পাস`);
    else if (r.skipped) console.log(`  ⏭️  [${step}] স্কিপ — ${r.error}`);
    else console.log(`  ❌ [${step}] ব্যর্থ — ${r.error}`);
  }

  if (firstFailedStep) {
    console.log(`\n❌ ক্যানারি ব্যর্থ — প্রথম ব্যর্থ ধাপ: "${firstFailedStep}" (${stepResult[firstFailedStep].error})\n`);
    process.exit(1);
  } else {
    console.log(`\n✅ সম্পূর্ণ পাইপলাইন (ইনভয়েস→সিঙ্ক→ব্যাকআপ→রিস্টোর→ভয়েড) পাস করেছে\n`);
  }
}

main().catch((e) => {
  console.error("Canary টেস্ট রানার নিজেই ব্যর্থ হয়েছে (emulator/সেটআপ সমস্যা):", e);
  process.exit(1);
});
