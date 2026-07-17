// ─── tests/sync-tests.mjs ──────────────────────────────────────────────────
// src/sync.js (সিঙ্ক/ব্যাকআপের pure লজিক) থেকে সরাসরি import করে চালায় —
// tests/logic-tests.mjs-এর মতোই plain Node.js, কোনো browser/Firebase/build
// লাগে না। CI-তে build শুরু হওয়ার *আগে* চলে।
//
// এই স্যুট বিশেষভাবে যা কভার করে (আগে কোনোটাই automated ছিল না):
//   ১. মাল্টি-ডিভাইস কনফ্লিক্ট-রেজোলিউশন (mergeCollection) — দুই ডিভাইস
//      অফলাইনে একই রেকর্ড বদলালে, বা একটা ডিভাইস মুছে ফেললে কী হবে।
//   ২. ব্যাকআপ round-trip (pickBackupFields → applyBackupFields প্যাটার্ন)।
//   ৩. content-hash/delta-sync স্কিপ-লজিক।
//   ৪. diffBackupFields (রিস্টোর প্রিভিউ/dry-run)।
//
// নতুন সিঙ্ক/ব্যাকআপ বাগ ফিক্স করলে: এই ফাইলে একটা নতুন কেস যোগ করুন।

import {
  BACKUP_FIELDS, pickBackupFields, computeRestoreGuardMs, diffBackupFields,
  hashCollection, buildContentHashes, diffChangedFields, effectiveTs,
  mergeCollection, mergeAllCollections,
} from "../src/sync.js";

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
  } catch (e) {
    failCount++;
    failures.push(`  ✗ [${suite}] ${name} — থ্রো হয়েছে: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ১. mergeCollection() — মাল্টি-ডিভাইস কনফ্লিক্ট-রেজোলিউশন নীতি
// ══════════════════════════════════════════════════════════════════════════

t("mergeCollection", "remote খালি হলে local অপরিবর্তিত, changed=false", () => {
  const local = [{ id: "1", name: "A" }];
  const { merged, changed } = mergeCollection(local, [], new Set());
  return { pass: merged === local && changed === false, expected: false, actual: changed };
});

t("mergeCollection", "দুই ডিভাইস একই রেকর্ড অফলাইনে বদলালে — বেশি effectiveTs জেতে (remote নতুন)", () => {
  const local  = [{ id: "1", name: "লোকাল-এডিট", _updatedAt: 1000 }];
  const remote = [{ id: "1", name: "রিমোট-এডিট", _updatedAt: 2000 }];
  const { merged, changed } = mergeCollection(local, remote, new Set());
  const rec = merged.find(r => r.id === "1");
  return { pass: changed === true && rec.name === "রিমোট-এডিট", expected: "রিমোট-এডিট", actual: rec.name };
});

t("mergeCollection", "দুই ডিভাইস একই রেকর্ড অফলাইনে বদলালে — বেশি effectiveTs জেতে (local নতুন)", () => {
  const local  = [{ id: "1", name: "লোকাল-এডিট", _updatedAt: 5000 }];
  const remote = [{ id: "1", name: "রিমোট-এডিট", _updatedAt: 2000 }];
  const { merged, changed } = mergeCollection(local, remote, new Set());
  const rec = merged.find(r => r.id === "1");
  return { pass: rec.name === "লোকাল-এডিট", expected: "লোকাল-এডিট", actual: rec.name };
});

t("mergeCollection", "_serverTs থাকলে _updatedAt-এর চেয়ে প্রাধান্য পায় (device clock skew সহ্য করে)", () => {
  // local device clock এগিয়ে (_updatedAt বড়) কিন্তু server আসলে remote-কে পরে পেয়েছে
  const local  = [{ id: "1", name: "লোকাল", _updatedAt: 99999, _serverTs: 1000 }];
  const remote = [{ id: "1", name: "রিমোট", _updatedAt: 500,   _serverTs: 2000 }];
  const { merged } = mergeCollection(local, remote, new Set());
  const rec = merged.find(r => r.id === "1");
  return { pass: rec.name === "রিমোট", expected: "রিমোট", actual: rec.name };
});

t("mergeCollection", "শুধু remote-এ নতুন রেকর্ড থাকলে যোগ হয়", () => {
  const local  = [{ id: "1", name: "A" }];
  const remote = [{ id: "1", name: "A" }, { id: "2", name: "B" }];
  const { merged, changed } = mergeCollection(local, remote, new Set());
  return { pass: changed === true && merged.length === 2, expected: 2, actual: merged.length };
});

t("mergeCollection", "শুধু local-এ থাকা রেকর্ড merge-এ মোছা হয় না", () => {
  const local  = [{ id: "1", name: "A" }, { id: "9", name: "শুধু-লোকাল" }];
  const remote = [{ id: "1", name: "A" }];
  const { merged } = mergeCollection(local, remote, new Set());
  return { pass: merged.some(r => r.id === "9"), expected: true, actual: merged.some(r => r.id === "9") };
});

t("mergeCollection", "tombstone (রিসাইকেল বিনে মোছা) রেকর্ড remote থেকে resurrect হয় না", () => {
  const local  = []; // ইউজার ডিভাইস-১ থেকে মুছে ফেলেছে
  const remote = [{ id: "1", name: "পুরনো-ব্যাকআপে-আছে", _updatedAt: 9999999 }]; // পুরনো Drive ব্যাকআপ
  const tombstones = new Set(["1"]); // deletedCustomers/deletedProducts-এ আছে
  const { merged, changed } = mergeCollection(local, remote, tombstones);
  return { pass: merged.length === 0 && changed === false, expected: 0, actual: merged.length };
});

t("mergeCollection", "tombstone-এ না থাকলে মোছা-ছাড়া পুরনো remote রেকর্ড স্বাভাবিকভাবে ফিরে আসে (resync)", () => {
  const local  = [];
  const remote = [{ id: "1", name: "অন্য-ডিভাইস-থেকে", _updatedAt: 100 }];
  const { merged, changed } = mergeCollection(local, remote, new Set());
  return { pass: changed === true && merged.length === 1, expected: 1, actual: merged.length };
});

t("mergeCollection", "id null/undefined রেকর্ড বাদ পড়ে, ক্র্যাশ করে না", () => {
  const local  = [{ id: "1", name: "A" }];
  const remote = [{ id: null, name: "ভাঙা" }, { name: "id-ই-নেই" }, { id: "1", name: "A" }];
  const { merged } = mergeCollection(local, remote, new Set());
  return { pass: merged.length === 1, expected: 1, actual: merged.length };
});

t("mergeCollection", "একই effectiveTs হলে existing (local) থেকে যায়, unnecessary flip হয় না", () => {
  const local  = [{ id: "1", name: "লোকাল", _updatedAt: 1000 }];
  const remote = [{ id: "1", name: "রিমোট", _updatedAt: 1000 }]; // টাই — strictly greater না
  const { merged } = mergeCollection(local, remote, new Set());
  const rec = merged.find(r => r.id === "1");
  return { pass: rec.name === "লোকাল", expected: "লোকাল", actual: rec.name };
});

t("mergeAllCollections", "একাধিক collection স্বাধীনভাবে merge হয় — একটার change আরেকটাকে প্রভাবিত করে না", () => {
  const localState  = { customers: [{ id: "1", n: "A", _updatedAt: 1 }], products: [{ id: "p1", n: "X", _updatedAt: 1 }] };
  const remoteState = { customers: [{ id: "1", n: "B", _updatedAt: 2 }], products: [{ id: "p1", n: "X", _updatedAt: 1 }] };
  const result = mergeAllCollections(localState, remoteState, {});
  const custChanged = result.customers.changed;
  const prodChanged = result.products.changed;
  return { pass: custChanged === true && prodChanged === false, expected: [true, false], actual: [custChanged, prodChanged] };
});

// ══════════════════════════════════════════════════════════════════════════
// ২. ব্যাকআপ round-trip (pickBackupFields → restore প্যাটার্ন)
// ══════════════════════════════════════════════════════════════════════════

t("Backup round-trip", "pickBackupFields শুধু BACKUP_FIELDS-এর কী-ই রাখে, বাকি সব বাদ দেয়", () => {
  const data = { customers: [{ id: "1" }], _internalJunk: "সেভ-হওয়া-উচিত-না", randomKey: 123 };
  const picked = pickBackupFields(data);
  return { pass: !("_internalJunk" in picked) && !("randomKey" in picked) && Array.isArray(picked.customers),
    expected: false, actual: "_internalJunk" in picked };
});

t("Backup round-trip", "খালি/undefined data দিয়ে ক্র্যাশ করে না", () => {
  const picked1 = pickBackupFields(null);
  const picked2 = pickBackupFields(undefined);
  return { pass: Object.keys(picked1).length === 0 && Object.keys(picked2).length === 0, expected: 0, actual: Object.keys(picked1).length };
});

t("Backup round-trip", "সব BACKUP_FIELDS পাঠালে, ফেরত সবগুলোই থাকে (কোনো collection হারায় না)", () => {
  const data = {};
  BACKUP_FIELDS.forEach(f => { data[f] = [{ id: "x" }]; });
  const picked = pickBackupFields(data);
  const missing = BACKUP_FIELDS.filter(f => !(f in picked));
  return { pass: missing.length === 0, expected: [], actual: missing };
});

t("Backup round-trip", "applyBackupFields প্যাটার্ন — শুধু d[f] সত্য (truthy) থাকলেই setter কল হওয়া উচিত (এখানে সিমুলেট)", () => {
  const d = { customers: [{ id: "1" }], products: [] }; // products খালি array — truthy!, ফলে সেটার কল হয়
  const calledSetters = [];
  const setters = {
    setCustomers: () => calledSetters.push("customers"),
    setProducts: () => calledSetters.push("products"),
  };
  BACKUP_FIELDS.forEach(f => {
    if (d[f]) {
      const setterName = "set" + f[0].toUpperCase() + f.slice(1);
      setters[setterName]?.(d[f]);
    }
  });
  return { pass: calledSetters.includes("customers") && calledSetters.includes("products"),
    expected: true, actual: calledSetters.includes("products") };
});

t("Backup round-trip", "computeRestoreGuardMs — রেকর্ড বেশি হলে গার্ড-টাইম বাড়ে, সর্বোচ্চ ৩০ সেকেন্ডে ক্যাপ হয়", () => {
  const small = computeRestoreGuardMs({ customers: [{ id: 1 }] });
  const huge  = computeRestoreGuardMs({ customers: Array.from({ length: 100000 }, (_, i) => ({ id: i })) });
  return { pass: small === 5010 && huge === 30000, expected: [5010, 30000], actual: [small, huge] };
});

// ══════════════════════════════════════════════════════════════════════════
// ৩. content-hash / delta-sync স্কিপ-লজিক
// ══════════════════════════════════════════════════════════════════════════

t("hashCollection", "একই রেকর্ডসেট, শুধু array-অর্ডার আলাদা হলেও একই হ্যাশ (XOR commutative)", () => {
  const a = [{ id: "1", n: "X" }, { id: "2", n: "Y" }];
  const b = [{ id: "2", n: "Y" }, { id: "1", n: "X" }];
  const h1 = hashCollection(a), h2 = hashCollection(b);
  return { pass: h1 === h2, expected: h1, actual: h2 };
});

t("hashCollection", "কোনো রেকর্ডের কনটেন্ট বদলালে হ্যাশ বদলে যায়", () => {
  const a = [{ id: "1", n: "X" }];
  const b = [{ id: "1", n: "X-বদলানো" }];
  const h1 = hashCollection(a), h2 = hashCollection(b);
  return { pass: h1 !== h2, expected: "different", actual: h1 === h2 ? "same" : "different" };
});

t("hashCollection", "key-insertion-order বদলালেও (merge-এর ফলে নতুন object) একই হ্যাশ", () => {
  const a = [{ id: "1", n: "X", p: 5 }];
  const b = [{ p: 5, id: "1", n: "X" }]; // একই কনটেন্ট, আলাদা key-order
  const h1 = hashCollection(a), h2 = hashCollection(b);
  return { pass: h1 === h2, expected: h1, actual: h2 };
});

t("diffChangedFields", "prevHashes না থাকলে (প্রথমবার) সব ফিল্ড changed ধরা হয় — safe default", () => {
  const { changed, fields } = diffChangedFields({ customers: "abc" }, null);
  return { pass: changed === true && fields.length === BACKUP_FIELDS.length, expected: BACKUP_FIELDS.length, actual: fields.length };
});

t("diffChangedFields", "কিছুই না বদলালে changed=false, delta-sync পুরো write স্কিপ করতে পারবে", () => {
  const hashes = buildContentHashes({ customers: [{ id: "1" }] });
  const { changed } = diffChangedFields(hashes, hashes);
  return { pass: changed === false, expected: false, actual: changed };
});

t("diffChangedFields", "শুধু একটা field বদলালে, শুধু সেটাই changed-এ আসে (বাকি সব আনটাচড থাকে)", () => {
  const prev = buildContentHashes({ customers: [{ id: "1", n: "A" }], products: [{ id: "p1", n: "X" }] });
  const next = buildContentHashes({ customers: [{ id: "1", n: "B" }], products: [{ id: "p1", n: "X" }] });
  const { changed, fields } = diffChangedFields(next, prev);
  return { pass: changed === true && fields.includes("customers") && !fields.includes("products"),
    expected: true, actual: fields.includes("products") };
});

// ══════════════════════════════════════════════════════════════════════════
// ৪. diffBackupFields (রিস্টোর প্রিভিউ / dry-run)
// ══════════════════════════════════════════════════════════════════════════

t("diffBackupFields", "নতুন/মোছা/বদলানো রেকর্ড সঠিকভাবে গোনে", () => {
  const current  = { customers: [{ id: "1", n: "A" }, { id: "2", n: "B" }] };
  const incoming = { customers: [{ id: "1", n: "A-বদলানো" }, { id: "3", n: "C" }] };
  const { totalAdded, totalRemoved, totalChanged } = diffBackupFields(current, incoming);
  return { pass: totalAdded === 1 && totalRemoved === 1 && totalChanged === 1,
    expected: [1, 1, 1], actual: [totalAdded, totalRemoved, totalChanged] };
});

t("diffBackupFields", "incomingData না থাকলে খালি ফলাফল, ক্র্যাশ করে না", () => {
  const result = diffBackupFields({ customers: [{ id: "1" }] }, null);
  return { pass: result.rows.length === 0, expected: 0, actual: result.rows.length };
});

// ── ফলাফল ────────────────────────────────────────────────────────────────────
console.log(`\n সিঙ্ক/ব্যাকআপ টেস্ট সুইট — ${passCount + failCount}টি কেস\n`);
if (failures.length > 0) {
  console.log(`❌ ${failCount}টি ফেল, ${passCount}টি পাস\n`);
  console.log(failures.join("\n"));
  console.log("");
  process.exit(1);
} else {
  console.log(`✅ সবগুলো (${passCount}টি) পাস হয়েছে\n`);
  process.exit(0);
}
