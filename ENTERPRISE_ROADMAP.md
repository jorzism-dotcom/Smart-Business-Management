# SBM/Turjo — এন্টারপ্রাইজ-লেভেল ১০০% কভারেজ রোডম্যাপ
### হিসাব · সিঙ্ক · ব্যাকআপ · ফায়ারবেস

সংকলিত: সব আলোচিত পয়েন্ট (৮ নম্বর অটো বাগ ডিটেকশন + সাধারণ এন্টারপ্রাইজ গ্যাপ +
চার-এরিয়ার ১০০% লিস্ট) একসাথে, একটাই অগ্রাধিকার-ক্রমে।

---

## এখন পর্যন্ত যা হয়ে গেছে (বেসলাইন)

- ✅ ESLint (0 error / ৩৮৬ warning), TypeScript check (`logic.js`+`schemas.js`+`sync.js`, 0 error)
- ✅ `src/logic.js` — ১৪টা হিসাব-ফাংশন, ৪৩টা টেস্ট
- ✅ `src/schemas.js` — zod ভ্যালিডেশন, ১৪টা টেস্ট
- ✅ `src/sync.js` — merge/conflict-resolution/hash/backup-diff, ২৪টা টেস্ট (এই সেশনে তৈরি)
- ✅ ইন্টিগ্রেশন টেস্ট — ১০টা (একাধিক ফাংশন চেইন করে বাস্তব ফ্লো)
- ✅ Fuzz testing (`logic-fuzz.mjs`) — informational, CI gate না
- ✅ CI (`npm test` চেইন) + husky pre-commit
- ✅ `BUGFIX_LOG.md` — Symptom/Root cause/Blast radius ফরম্যাটে চর্চা শুরু
- ❌ Firebase Authentication, Security Rules — **কোনোটাই নেই**
- ❌ Sentry/এরর-মনিটরিং — নেই
- ❌ Firestore Emulator/CI-তে কোনো Firebase টেস্ট — নেই (৮৩টা টাচপয়েন্ট, ০% কভার)

---

## ফেজ ০ — ফাউন্ডেশন (সবার আগে, বাকি সব কিছুর পূর্বশর্ত)

এগুলো ছাড়া ফেজ ২/৩/৪-এর ইন্টিগ্রেশন-লেভেল আইটেমগুলো করাই সম্ভব না।

> **স্ট্যাটাস আপডেট — বিস্তারিত `PHASE0_NOTES.md`-তে।** (৩) নম্বর আইটেমে ধরা
> পড়েছে যে Security Rules আসলে আগে থেকেই ছিল, শুধু `admin.html`-এর ভেতর
> embedded ছিল — repo-তে standalone ফাইল ছিল না বলে এই লিস্টে "নেই" মনে
> হয়েছিল।

1. ✅ **Firestore Emulator Suite সেটআপ** — `firebase.json`, `.firebaserc`, `npm run emulators` / `npm run test:rules`, CI workflow-এ `firestore-rules` জব
2. ⛔ **Firebase Authentication যোগ করা** — এখনো করা হয়নি (ইচ্ছাকৃতভাবে, দেখুন `PHASE0_NOTES.md` § ৩); role এখনো client-side state, যেকোনো ইউজার নিজেকে admin বানাতে পারে — এটা এখন টেস্টে canary হিসেবে ট্র্যাক করা হচ্ছে
3. ✅ **Firestore Security Rules** (`firestore.rules`) — আগে থেকেই ছিল (admin.html-এ embedded), এখন standalone ফাইল + `scripts/check-rules-sync.mjs` দিয়ে drift-protected
4. ✅ **`@firebase/rules-unit-testing`** দিয়ে rules-এর বিরুদ্ধে টেস্ট — ৩২টা কেস (`tests/rules-tests.mjs`); staff-bypass "বন্ধ" প্রমাণ করার বদলে বর্তমান open-write গ্যাপের canary টেস্ট (Auth ছাড়া bypass বন্ধ করা সম্ভব না)
5. ⛔ Server-side validation (role/discount সীমা) — Auth+custom claims-নির্ভর, তাই আইটেম ২-এর সাথে বাঁধা, এখনো বাকি

---

## ফেজ ১ — হিসাব (Accounting/Calculations)

**এক্সট্র্যাক্ট করে `logic.js`-এ আনতে হবে:**
- `calcProfitByProduct`, `calcProfitByProductWithInvoices` (App.jsx লাইন ৮৪২৭/৮৪৬২)
- `useKpiStats` হুকের কোর গণনা (লাইন ৯১০৮) — dashboard KPI/RFM
- `buildDailySummaryData` (লাইন ২৫৮৩০)
- `ProfitStatementCard`, `ReturnModule`-এর ভেতরের হিসাব-লজিক (রেন্ডার থেকে আলাদা)
- `computeStockDeductionFIFO` (লাইন ৩০৩)
- `diffRecordFields` (লাইন ৪৪৮৯) — audit trail-এর কোর লজিক
- `isAutoScheduleActive` (লাইন ৬০৯৪) — স্টাফ পারমিশন উইন্ডো (এক্সেস-কন্ট্রোল লজিক)
- `compareVersions`, `applyTemplate`, `normalizeSupplierKey`, `normalizeBDMobile`
- `_dateKeyOf`/`_monthKeyOf`/`_isoWeekKeyOf`/`_bdLocalDate` (GMT+6 তারিখ হেল্পার — আগে ৩৯ জায়গায় বাগ ছিল, এখনো টেস্ট নেই)

**পরিষ্কার করতে হবে:**
- App.jsx-এর ভেতরের পুরনো `runLogicTests()` (লাইন ৮৩০১, ইন-অ্যাপ ম্যানুয়াল সেলফ-টেস্ট) — এখন CI-এর `tests/logic-tests.mjs`-এর সাথে ডুপ্লিকেট/ড্রিফট-ঝুঁকি; হয় মুছে ফেলা, নয়তো একই সোর্স ভাগ করা

**নতুন টেস্ট:**
- edge case: শূন্য বিক্রয়, নেগেটিভ ডিসকাউন্ট, রাউন্ডিং, ভয়েড ইনভয়েসের প্রভাব বাদ যাচ্ছে কিনা
- ক্রস-চেক: Dashboard KPI যোগফল = ProfitStatementCard যোগফল
- Fuzz test-এ নতুন ফাংশনগুলো যোগ

---

## ফেজ ২ — সিঙ্ক (Sync)

**এক্সট্র্যাক্ট করে `sync.js`-এ আনতে হবে:**
- `SyncOutbox` (লাইন ৫৫৯১, offline write queue)-এর ডিসিশন-লজিক
- `useFSSCollection`-এর merge/resync ডিসিশন অংশ (I/O বাদ দিয়ে)

**নতুন pure-লজিক টেস্ট:**
- ৩+ ডিভাইস কনফ্লিক্ট (এখন ২টা পর্যন্ত টেস্ট করা আছে)
- নেটওয়ার্ক-ড্রপ মাঝপথে merge — partial-write সিমুলেশন
- Outbox queue reorder/retry লজিক

**ইন্টিগ্রেশন (Emulator-নির্ভর, ফেজ ০-এর পর):**
- আসল `onSnapshot`/`FSS.setRecord` কল করে real-time multi-device sync ভ্যালিডেশন

---

## ফেজ ৩ — ব্যাকআপ (Backup)

**এক্সট্র্যাক্ট:**
- `RestoreSelfTest`-এর "কবে/কী চেক করবে" লজিক pure ফাংশনে
- `RetentionDB.pruneRetention()` (GFS রিটেনশন সিদ্ধান্ত)
- `WormArchive.archiveIfNewMonth()`-এর ডিসিশন-লজিক
- E2E Encryption wrapper → নতুন `src/crypto.js` (key derivation, encrypt/decrypt)

**নতুন টেস্ট:**
- **real backup→restore round-trip** — মক ডেটাসেট backup করে restore করে বাইট-বাই-বাইট তুলনা (এখনো কখনো হয়নি)
- Retention policy ট্রানজিশন (১৪ দিন দৈনিক → সাপ্তাহিক → মাসিক) সঠিক তারিখে হচ্ছে কিনা
- Corrupted/partial backup ফাইলে গ্রেসফুল fail (crash না করে)
- Encryption round-trip + ভুল পাসওয়ার্ডে সঠিক error

**ইন্টিগ্রেশন:**
- `fake-indexeddb` প্যাকেজ দিয়ে `SnapshotDB`/`ArchiveDB`/`RetentionDB` CI-তে (ব্রাউজার ছাড়াই) চালানো

---

## ফেজ ৪ — ফায়ারবেস (Firebase) — সবচেয়ে বড় গ্যাপ (০% কভার, ৮৩ টাচপয়েন্ট)

ফেজ ০-এর সাথেই বেশিরভাগ ওভারল্যাপ করে, অতিরিক্ত যা লাগবে:

- `FSS` অবজেক্টের প্রতিটা মেথড (`setRecord`, `deleteRecord` ইত্যাদি) emulator-এর বিপরীতে টেস্ট
- Phone Auth REST ফ্লো (লাইন ৬৩৯৮) — emulator Auth REST endpoint দিয়ে টেস্ট
- Legacy RTDB device-presence লেয়ার (লাইন ৬১৬০) — টেস্ট বা ডেপ্রিকেট করার সিদ্ধান্ত
- CI workflow (`build-apk.yml`)-এ emulator জব যোগ (build ধাপের আগে)

---

## ফেজ ৫ — গেট, মনিটরিং, UI (স্ট্যাটিক টেস্টের বাইরে যা লাগে)

- `c8`/`istanbul` দিয়ে actual coverage % মাপা + CI-তে minimum threshold গেট
- Stryker mutation testing আসলে চালিয়ে baseline নেওয়া (কনফিগ আছে, রান হয়নি)
- Fuzz test-কে CI gate বানানো (এখন informational-only, `continue-on-error: true`)
- **Sentry ইন্টিগ্রেশন** — প্রোডাকশন রানটাইম এরর কভার করে, স্ট্যাটিক টেস্টে যা কখনো ধরা পড়বে না
- App.jsx থেকে বড় UI কম্পোনেন্ট আলাদা ফাইলে ভাঙা + React Testing Library দিয়ে smoke test
- App.jsx-এর ৩৮৬টা ESLint warning (মূলত unused vars) ধীরে ধীরে পরিষ্কার

---

## সারসংক্ষেপ — কেন এই ক্রম

| ফেজ | কেন এখানে |
|---|---|
| ০ (Firebase ফাউন্ডেশন) | ছাড়া ২/৩/৪-এর ইন্টিগ্রেশন টেস্ট অসম্ভব; সবচেয়ে বড় সিকিউরিটি গ্যাপও এখানেই |
| ১ (হিসাব) | সবচেয়ে কম নির্ভরতা, সবচেয়ে বেশি ROI — সরাসরি টাকার হিসাব |
| ২ (সিঙ্ক) | ফেজ ০-এর pure অংশ আগে, emulator অংশ পরে |
| ৩ (ব্যাকআপ) | একইভাবে — pure অংশ স্বাধীন, IndexedDB mock অংশ একটু ভারী |
| ৪ (Firebase বাকি অংশ) | ফাউন্ডেশনের ওপর বিল্ড করে সম্পূর্ণ করা |
| ৫ (গেট/মনিটরিং/UI) | সবার শেষে — এগুলো নতুন বাগ ধরে না, বরং existing coverage-কে *enforce* করে এবং যা static টেস্ট কখনো ধরবে না (UI, প্রোডাকশন রানটাইম) তা কভার করে |

**পরবর্তী একক পদক্ষেপ হিসেবে সবচেয়ে বেশি মূল্য দেবে:** ফেজ ০-এর Firestore Emulator সেটআপ + Security Rules লেখা — কারণ এটা একসাথে সবচেয়ে বড় সিকিউরিটি গ্যাপ বন্ধ করে এবং বাকি সব ফেজের ইন্টিগ্রেশন-টেস্টের রাস্তা খুলে দেয়।
