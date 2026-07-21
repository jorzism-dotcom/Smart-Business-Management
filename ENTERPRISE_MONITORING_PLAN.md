# এন্টারপ্রাইজ মনিটরিং/রিলায়েবিলিটি ইমপ্লিমেন্টেশন প্ল্যান

এই ফাইল ~৫০০ দোকানের Firebase-ভিত্তিক Turjo/SBM সিস্টেমের ৪-স্তর রিলায়েবিলিটি
গ্যাপ বন্ধ করার জন্য ধাপে-ধাপে (প্রতি ধাপ এক-সেশন-সাইজ) প্ল্যান ট্র্যাক করে।

প্রতিটা ধাপের পাশে `[ ]`/`[x]` চেকবক্স থাকবে — সেশন শুরুতে এই ফাইল দেখেই
বোঝা যাবে কোথা থেকে শুরু করতে হবে। কোনো ধাপ সম্পূর্ণ হলে সেই সেশনেই এখানে
টিক দিয়ে `CLAUDE.md`-এর সেশন-হিস্টোরিতেও এন্ট্রি যোগ করতে হবে।

---

## বর্তমান অবস্থা (যাচাইকৃত — ২২ জুলাই ২০২৬, আসল repo পড়ে নিশ্চিত করা)

| স্তর | বিবরণ | অবস্থা |
|---|---|---|
| ১ — কমিটের আগে (fuzz/mutation) | ✅ `npm run test:fuzz` এখন CI-তে blocking (২২ জুলাই ২০২৬ থেকে, `continue-on-error` সরানো হয়েছে)। `npm run test:mutation` বেসলাইন ৭২.৫৩%, `thresholds.break: 65` বসানো হয়েছে, CI-তে informational step হিসেবে যোগ (এখনো build-gate না, ইচ্ছাকৃত) | **সম্পূর্ণ (ফেজ A)** |
| ২ — মার্জ/বিল্ডের আগে | `firestore-rules` জব (`test:rules-sync` + `test:rules` emulator) `build` জবের `needs:` হিসেবে বাধ্যতামূলক গেট — কিন্তু multi-device conflict, network-drop mid-sync, backup→restore round-trip — এই ৩টার কোনো real-emulator ইন্টিগ্রেশন টেস্ট নেই | আংশিক |
| ৩ — রিলিজের আগে ক্যানারি | `.github/workflows/build-apk.yml`-এ end-to-end canary (invoice তৈরি→sync→backup→restore→void) নামে কোনো জব/স্ক্রিপ্ট নেই | সম্পূর্ণ অনুপস্থিত |
| ৪ — প্রোডাকশন রানটাইম সেলফ-চেক | `src/App.jsx`-এ central error logging আছে (`app_errors/{autoId}`, protik-aa991 প্রজেক্টে পাঠায়) — কিন্তু periodic invariant-check (নেগেটিভ স্টক, cash-drawer mismatch ইত্যাদি), admin.html-এ invariant ড্যাশবোর্ড, এবং কোনো kill-switch/rollback মেকানিজম কোনোটাই নেই | আংশিক |

**যাচাই পদ্ধতি:** `package.json` scripts, `stryker.conf.json`, `.github/workflows/build-apk.yml`-এর জব-গ্রাফ, `src/App.jsx`-এর error-logging ব্লক, এবং `tests/rules-tests.mjs`-এর canary কমেন্ট — এই সবগুলো এই সেশনে সরাসরি ফাইল থেকে পড়ে নিশ্চিত করা হয়েছে (অনুমান না)।

---

## ফেজ A — স্তর ১ সম্পূর্ণ করা (৩ ধাপ) ✅ সম্পূর্ণ — ২২ জুলাই ২০২৬

- [x] **A1.** Fuzz test (`test:fuzz`) কয়েকবার সত্যিই green আসছে কিনা যাচাই করে, CI-তে `continue-on-error` সরিয়ে blocking করা — sandbox-এ ১০ বার চালিয়ে সবকটাতে green, `.github/workflows/build-apk.yml` আপডেট করা হয়েছে
- [x] **A2.** Stryker mutation score-এর baseline রান করে বাস্তবসম্মত threshold (`stryker.conf.json`-এর `thresholds.break`) বসানো, CI-তে অন্তত informational রিপোর্ট হিসেবে যোগ করা — বেসলাইন ৭২.৫৩%, `break: 65` বসানো হয়েছে, CI-তে নতুন informational step (`continue-on-error: true`) যোগ হয়েছে
- [x] **A3.** `BUGFIX_LOG.md`/`CLAUDE.md`-এ স্তর ১ "সম্পূর্ণ" হিসেবে মার্ক করা — উভয় ফাইলে এন্ট্রি যোগ হয়েছে

**নোট:** এই তিনটাই sandbox-এ সরাসরি রান করে যাচাই করা হয়েছে (`npm test`, `npm run test:fuzz` ×১০, `npm run test:mutation` ×২), কিন্তু আসল GitHub Actions runner-এ এই পরিবর্তিত workflow এখনো রান হয়নি — merge-এর পর প্রথম CI রান একবার চোখে দেখে নেওয়া উচিত।

## ফেজ B — স্তর ২: রিয়েল emulator-integration টেস্ট (৪ ধাপ)

⚠️ **যাচাই-অবস্থা (২২ জুলাই ২০২৬):** নিচের ৪টা ধাপের কোড/CI-জব সবই লেখা হয়েছে এবং
ম্যানুয়ালি রিভিউ করা হয়েছে (একবার rules-validation বাগ ধরা পড়ে ঠিক করাও হয়েছে —
নিচে দেখুন), কিন্তু **sandbox-এ আসল Firestore Emulator চালিয়ে যাচাই করা যায়নি** —
sandbox-এর network egress allowlist-এ `storage.googleapis.com` নেই বলে emulator
jar ডাউনলোডই ব্যর্থ হয় (`Error: download failed, status 403: Host not in
allowlist: storage.googleapis.com`)। এই কারণে বক্সগুলো এখনো `[x]` করা হয়নি —
ফেজ A-তে যেমন sandbox-এ ১০ বার চালিয়ে "green" নিশ্চিত হওয়ার পরই টিক দেওয়া
হয়েছিল, এখানে সেই পর্যায়টা এই সেশনে সম্ভব হয়নি। **আসল যাচাই হবে GitHub Actions-এ
প্রথম রান-এ** (CI job নিচে B4-এ যোগ করা হয়েছে, blocking) — সেই রানের ফলাফল দেখেই
এই বক্সগুলো টিক দেওয়া উচিত হবে।

- [ ] **B1.** ৩+ ডিভাইস simultaneous conflict সিনারিও — emulator-এ real integration টেস্ট (একই রেকর্ড দুই ডিভাইস থেকে একসাথে write, `mergeCollection`/`effectiveTs` লজিক যাচাই) — কোড লেখা হয়েছে `tests/sync-emulator-tests.mjs`-এ (২টা কেস: ২-ডিভাইস + ৩-ডিভাইস কনফ্লিক্ট, real `serverTimestamp()` দিয়ে), sandbox-এ রান-ভেরিফাই বাকি
- [ ] **B2.** Network-drop mid-merge সিনারিও — sync মাঝপথে বিচ্ছিন্ন হলে data corrupt হয় না তা যাচাই — কোড লেখা হয়েছে (আংশিক পুশ + resume, এবং duplicate-retry কেস), sandbox-এ রান-ভেরিফাই বাকি। নোট: `pushDurable`/outbox নিজেই `App.jsx`-এর ভেতরে React/IndexedDB-কাপলড কোড, তাই সরাসরি সেটা না চালিয়ে একই আচরণ (partial-write→resume, idempotent retry) real Firestore ডকুমেন্টের বিপরীতে সিমুলেট করা হয়েছে
- [ ] **B3.** Backup→restore বাইট-বাই-বাইট round-trip টেস্ট (real backup বানিয়ে restore করে ডেটা compare — পুরনো backup format-এর backward-compat সহ) — কোড লেখা হয়েছে (real ডেটা → `pickBackupFields` → JSON round-trip → আলাদা কালেকশনে restore → `diffBackupFields`/`hashCollection` দিয়ে zero-drift চেক, + অজানা legacy কী থাকলেও crash না করা), sandbox-এ রান-ভেরিফাই বাকি
- [ ] **B4.** নতুন টেস্টগুলো CI workflow-এ (`firestore-rules` জব বা নতুন জব) যোগ করে build-gate করা — `firestore-rules` জবেই নতুন blocking step (`npm run test:sync-emulator`) যোগ করা হয়েছে, YAML syntax যাচাই করা হয়েছে, কিন্তু আসল CI রান এখনো দেখা হয়নি

## ফেজ C — স্তর ৩: রিলিজ-ক্যানারি (একদম নতুন, ৩ ধাপ)

- [ ] **C1.** End-to-end canary স্ক্রিপ্ট লেখা: emulator-এ ইনভয়েস তৈরি → সিঙ্ক → ব্যাকআপ → রিস্টোর → ভয়েড — প্রতি ধাপ automatic ভ্যালিডেশনসহ
- [ ] **C2.** এটাকে release workflow-এ গেট হিসেবে যোগ করা (fail হলে release/APK build আটকাবে)
- [ ] **C3.** ক্যানারি ফেইলের ক্ষেত্রে স্পষ্ট রিপোর্ট (কোন ধাপে fail করলো) তৈরি করা

## ফেজ D — স্তর ৪: প্রোডাকশন সেলফ-চেক আপগ্রেড (৩ ধাপ)

- [ ] **D1.** Periodic invariant-check (নেগেটিভ স্টক, ইনভয়েস-টোটাল vs cash-drawer mismatch ইত্যাদি) — ডিভাইসে চলবে, `app_errors`-এ লগ হবে
- [ ] **D2.** `admin.html`-এ invariant-check ফলাফলের ড্যাশবোর্ড/অ্যালার্ট প্যানেল
- [ ] **D3.** "রিলিজ খারাপ গেলে" কিল-সুইচ/রোলব্যাক মেকানিজম (admin flag → ডিভাইসগুলো পুরনো ভার্সনে ফিরতে বলা বা নতুন sync থামানো)

---

## পরের সেশনের জন্য নোট

- প্রতিটা ফেজ স্বাধীনভাবে সেশন-বাউন্ডারিতে থামা যায় এমনভাবে সাজানো — একটা
  ধাপ শেষ না করে মাঝপথে থামলে সেটা "আংশিক" হিসেবে এখানে নোট করে রাখুন,
  চেকবক্স টিক দেবেন না।
- এই ফেজ B ও C-এর কাজে Firebase emulator লাগবে — এই ওয়েব sandbox-এ
  emulator চালানো সম্ভব না-ও হতে পারে (network নির্ভরতা)। সেক্ষেত্রে কোড
  লিখে দেওয়া যাবে, কিন্তু "চালিয়ে দেখা হয়েছে" দাবি করা যাবে না — CI-এর
  `firestore-rules` জবের উপর ভরসা করে যাচাই করতে হবে, এবং ব্যবহারকারীকে
  স্পষ্টভাবে জানাতে হবে কোনটা sandbox-এ রান করা হয়েছে বনাম কোনটা শুধু
  কোড-রিভিউ করে ধরে নেওয়া হয়েছে (CLAUDE.md-এর Post-flight নিয়ম #৫-৬)।
- ফেজ শুরু করার আগে `PHASE0_NOTES.md`/`ENTERPRISE_ROADMAP.md`/`BUGFIX_LOG.md`
  স্ক্যান করে দেখে নিন সেই এলাকায় ইতিমধ্যে কোনো ডকুমেন্টেড সিদ্ধান্ত আছে কিনা।
