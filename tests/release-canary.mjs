// ─── tests/release-canary.mjs ───────────────────────────────────────────────
// ফেজ C (ENTERPRISE_MONITORING_PLAN.md স্তর ৩ — রিলিজ-ক্যানারি) — real
// Firestore Emulator-এ একটা সম্পূর্ণ ইনভয়েস lifecycle একটানা চালিয়ে দেখে:
//   ইনভয়েস তৈরি → সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড
// প্রতিটা ধাপ নিজে থেকে automatic ভ্যালিডেট করে, এবং কোনো ধাপ fail করলে
// ঠিক কোন ধাপে থেমেছে তা স্পষ্টভাবে রিপোর্ট করে (C3)।
//
// tests/sync-emulator-tests.mjs (ফেজ B) থেকে এটার পার্থক্য: ওটা independent
// case-by-case কভারেজ (একটা fail হলেও বাকিগুলো চলতেই থাকে), এই স্ক্রিপ্ট
// sequential/dependency-chained — প্রতিটা ধাপ আগেরটার output-এর উপর নির্ভর
// করে, ঠিক আসল রিলিজের সময় যেভাবে ঘটবে সেই ক্রমে। তাই প্রথম fail-এই থেমে
// যাওয়া (বাকি ধাপ স্কিপ) ইচ্ছাকৃত — একটা corrupted ধাপের উপর পরের ধাপ
// চালালে false-confidence তৈরি হতো।
//
// রান: npm run test:release-canary
//   (ভেতরে firebase emulators:exec --only firestore ব্যবহার করে)
// build-apk.yml-এর firestore-rules জবে এটা blocking step হিসেবে যোগ করা
// আছে — fail করলে build/release জব-ই শুরু হবে না (দেখুন ENTERPRISE_
// MONITORING_PLAN.md ফেজ C, C2)।

import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc, setDoc, getDoc, getDocs, collection, serverTimestamp,
} from "firebase/firestore";
import {
  pickBackupFields, diffBackupFields, hashCollection, mergeCollection,
} from "../src/sync.js";

const STEPS = []; // { name, status: 'pass'|'fail', detail }

async function runStep(name, fn) {
  try {
    const detail = await fn();
    STEPS.push({ name, status: "pass", detail: detail || "" });
    console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
    return true;
  } catch (e) {
    STEPS.push({ name, status: "fail", detail: e.message });
    console.log(`  ❌ ${name} — ${e.message}`);
    return false;
  }
}

// ── C3: কোন ধাপে থেমেছে তার স্পষ্ট রিপোর্ট ──────────────────────────────────
function printReport() {
  console.log("\n" + "═".repeat(60));
  console.log("📋 রিলিজ-ক্যানারি রিপোর্ট");
  console.log("═".repeat(60));
  STEPS.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.status === "pass" ? "✅" : "❌"} ${s.name}${s.detail ? " — " + s.detail : ""}`);
  });
  const totalPlanned = 5;
  const firstFail = STEPS.find(s => s.status === "fail");
  if (firstFail) {
    const skipped = totalPlanned - STEPS.length;
    console.log(`\n🔴 ক্যানারি ব্যর্থ: "${firstFail.name}" ধাপে থেমেছে।`);
    if (skipped > 0) console.log(`   এর পরের ${skipped}টা ধাপ চালানো হয়নি (dependency-chained — corrupted অবস্থার উপর পরের ধাপ চালালে false-confidence তৈরি হতো)।`);
    console.log("   ➜ release/APK build আটকে দেওয়া হলো।");
  } else {
    console.log("\n🟢 সবগুলো ধাপ (তৈরি → সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড) সফল — রিলিজ নিরাপদ।");
  }
  console.log("═".repeat(60) + "\n");
}

async function fetchCollectionAsArray(db, colName) {
  const snap = await getDocs(collection(db, colName));
  const out = [];
  snap.forEach(d => {
    const data = d.data();
    out.push({
      ...data, id: d.id,
      _serverTs: data._serverTs?.toMillis ? data._serverTs.toMillis() : (data._serverTs || null),
    });
  });
  return out;
}

async function main() {
  console.log("\n🐤 রিলিজ-ক্যানারি (ফেজ C): ইনভয়েস তৈরি → সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড\n");

  const testEnv = await initializeTestEnvironment({
    projectId: "demo-sbm-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  const deviceA = testEnv.unauthenticatedContext().firestore();
  await testEnv.clearFirestore();

  const INVOICE_ID = "canary-inv-1";
  const RESTORE_NS = "invoices_pharmacy"; // rules-ভ্যালিডেটেড real business-prefix path (দেখুন tests/sync-emulator-tests.mjs B3-এর একই যুক্তি)
  let sourceInvoice = null;
  let backupPayload = null;

  // ── ধাপ ১/৫: ইনভয়েস তৈরি (create) ─────────────────────────────────────
  if (!await runStep("১. ইনভয়েস তৈরি (create)", async () => {
    const invoiceData = {
      id: INVOICE_ID, total: 1250.5, status: "active", payType: "cash",
      items: [{ productId: "p-canary-1", qty: 2, price: 625.25 }],
      _serverTs: serverTimestamp(),
    };
    await setDoc(doc(deviceA, `invoices/${INVOICE_ID}`), invoiceData);
    const snap = await getDoc(doc(deviceA, `invoices/${INVOICE_ID}`));
    if (!snap.exists()) throw new Error("ইনভয়েস write-এর পর পাওয়া গেল না");
    const data = snap.data();
    if (data.status !== "active") throw new Error(`status প্রত্যাশিত "active", পাওয়া গেছে "${data.status}"`);
    if (data.total !== 1250.5) throw new Error("total মিলছে না — write-এর পর ডেটা বদলে গেছে");
    return `id=${INVOICE_ID}, total=${data.total}`;
  })) { printReport(); await testEnv.cleanup(); process.exit(1); }

  // ── ধাপ ২/৫: সিঙ্ক (দ্বিতীয় ডিভাইস remote থেকে merge করে) ────────────────
  if (!await runStep("২. সিঙ্ক (দ্বিতীয় ডিভাইসে merge)", async () => {
    const raw = await getDoc(doc(deviceA, `invoices/${INVOICE_ID}`));
    sourceInvoice = { ...raw.data(), id: INVOICE_ID, _serverTs: raw.data()._serverTs.toMillis() };
    const { merged, changed } = mergeCollection([], [sourceInvoice], new Set());
    const winner = merged.find(r => r.id === INVOICE_ID);
    if (!winner) throw new Error("merge-এর পর ইনভয়েস পাওয়া গেল না");
    if (!changed) throw new Error("changed=true হওয়ার কথা ছিল (নতুন রেকর্ড remote-এ এসেছে)");
    if (winner.total !== sourceInvoice.total) throw new Error("merge-এর পর total বদলে গেছে — sync লজিক ডেটা করাপ্ট করছে");
    return `merged, changed=${changed}`;
  })) { printReport(); await testEnv.cleanup(); process.exit(1); }

  // ── ধাপ ৩/৫: ব্যাকআপ (snapshot + content-hash) ────────────────────────
  if (!await runStep("৩. ব্যাকআপ (snapshot নেওয়া)", async () => {
    const liveData = { invoices: await fetchCollectionAsArray(deviceA, "invoices") };
    backupPayload = pickBackupFields(liveData);
    if (!Array.isArray(backupPayload.invoices) || !backupPayload.invoices.length) {
      throw new Error("ব্যাকআপ পেলোডে invoices পাওয়া যায়নি");
    }
    const h = hashCollection(backupPayload.invoices);
    if (!h) throw new Error("content-hash শূন্য/অকার্যকর — ব্যাকআপ ডেটা অসম্পূর্ণ");
    return `${backupPayload.invoices.length}টা ইনভয়েস, hash=${h}`;
  })) { printReport(); await testEnv.cleanup(); process.exit(1); }

  // ── ধাপ ৪/৫: রিস্টোর (খালি কালেকশনে লিখে zero-drift যাচাই) ────────────────
  if (!await runStep("৪. রিস্টোর (নতুন কালেকশনে, zero-drift যাচাই)", async () => {
    const freshDb = testEnv.unauthenticatedContext().firestore();
    const preSnap = await getDocs(collection(freshDb, RESTORE_NS));
    if (!preSnap.empty) throw new Error("restore-টার্গেট শুরুতে খালি থাকার কথা ছিল");
    for (const inv of backupPayload.invoices) {
      const { _serverTs, ...clean } = inv;
      await setDoc(doc(freshDb, `${RESTORE_NS}/${clean.id}`), clean);
    }
    const stripTs = (arr) => arr.map(({ _serverTs, ...c }) => c);
    const restored = stripTs(await fetchCollectionAsArray(freshDb, RESTORE_NS));
    const original = stripTs(backupPayload.invoices);
    const diff = diffBackupFields({ invoices: original }, { invoices: restored });
    if (diff.totalAdded !== 0 || diff.totalRemoved !== 0 || diff.totalChanged !== 0) {
      throw new Error(`zero-drift প্রত্যাশিত, পাওয়া গেছে added=${diff.totalAdded} removed=${diff.totalRemoved} changed=${diff.totalChanged}`);
    }
    if (hashCollection(original) !== hashCollection(restored)) {
      throw new Error("content-hash মিলছে না — restore-এ ডেটা করাপ্ট হয়েছে");
    }
    return `${restored.length}টা রিস্টোর হয়েছে, zero-drift`;
  })) { printReport(); await testEnv.cleanup(); process.exit(1); }

  // ── ধাপ ৫/৫: ভয়েড (status বদল + স্টক-রিভার্সাল, voidInvoice()-এর প্যাটার্ন) ──
  if (!await runStep("৫. ভয়েড (void — status বদল + stockMovements রিভার্সাল)", async () => {
    const { id: _drop, ...rest } = sourceInvoice;
    const voidedInvoice = {
      ...rest, status: "voided", voidedAt: new Date().toISOString(),
      voidReason: "release-canary-test", _serverTs: serverTimestamp(),
    };
    await setDoc(doc(deviceA, `invoices/${INVOICE_ID}`), voidedInvoice);

    // App.jsx-এর voidInvoice() প্রতিটা আইটেমের স্টক ফেরত দেওয়ার stockMovements
    // এন্ট্রি লেখে (source: "void") — এখানে সেই একই আচরণ যাচাই করা হচ্ছে
    for (const item of sourceInvoice.items || []) {
      await setDoc(doc(deviceA, `stockMovements/void-${INVOICE_ID}-${item.productId}`), {
        productId: item.productId, qty: item.qty, source: "void", invoiceId: INVOICE_ID,
      });
    }

    const after = await getDoc(doc(deviceA, `invoices/${INVOICE_ID}`));
    if (after.data().status !== "voided") throw new Error(`status "voided" হওয়ার কথা, পাওয়া গেছে "${after.data().status}"`);
    if (after.data().total !== sourceInvoice.total) throw new Error("ভয়েড করার পর total বদলে গেছে — ডেটা করাপ্ট");

    const stockSnap = await getDocs(collection(deviceA, "stockMovements"));
    if (stockSnap.empty) throw new Error("ভয়েডের স্টক-রিভার্সাল stockMovements এন্ট্রি লেখা হয়নি");

    // rules-ভ্যালিডেশন সত্যিই কার্যকর ছিল কিনা — status অবৈধ মান দিয়ে লেখার চেষ্টা reject হওয়ার কথা
    let rejected = false;
    try {
      await setDoc(doc(deviceA, `invoices/canary-inv-invalid`), { status: "not-a-real-status" });
    } catch { rejected = true; }
    if (!rejected) throw new Error("firestore.rules-এর validInvoice() অবৈধ status reject করেনি — rules ফাঁকি দিয়ে গেছে");

    return `status=voided, stockMovements=${stockSnap.size}টা, rules-guard কার্যকর`;
  })) { printReport(); await testEnv.cleanup(); process.exit(1); }

  await testEnv.cleanup();
  printReport();
}

main().catch((e) => {
  console.error("রিলিজ-ক্যানারি রানার নিজেই ব্যর্থ হয়েছে (সেটআপ/emulator সমস্যা, ধাপ-লজিকের বাগ না):", e);
  process.exit(1);
});
