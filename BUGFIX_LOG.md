# বাগ-ফিক্স লগ

**উদ্দেশ্য:** প্রতিটা বাগ ফিক্সের পর এখানে ৫টা লাইন লিখে রাখুন। এতে (ক) ভবিষ্যতে
একই প্যাটার্নের বাগ চিনতে সুবিধা হবে, (খ) Claude-কে নতুন কাজ দেওয়ার সময় এই
ফাইলটা রেফারেন্স হিসেবে দিলে সে আগের ভুল রিপিট করবে না, (গ) "কোন ফিক্স কোন
সাইড-ইফেক্ট তৈরি করেছিল" পরে বোঝা সহজ হবে।

নতুন এন্ট্রি সবসময় **উপরে** যোগ করুন (সবচেয়ে সাম্প্রতিক প্রথমে)।

---

## টেমপ্লেট (কপি করে পূরণ করুন)

```
### [তারিখ] — [সংক্ষিপ্ত শিরোনাম]
- উপসর্গ (Symptom): কী ভুল দেখা যাচ্ছিল, ব্যবহারকারীর ভাষায়
- মূল কারণ (Root cause): আসল টেকনিক্যাল কারণ কী ছিল
- ফিক্স কোথায়: কোন ফাইল/ফাংশন বদলানো হয়েছে
- ব্লাস্ট রেডিয়াস: এই ফাংশন/স্টেট আর কোথায় কোথায় ব্যবহার হয় (তাই এখানে
  bug থাকলে আরও কোথায় প্রভাব পড়তে পারত)
- রিগ্রেশন টেস্ট যোগ হয়েছে কি: হ্যাঁ/না — tests/logic-tests.mjs-এ কোন কেস
```

---

## এন্ট্রি

### ২০২৬-০৭-১৭ — CI-তে নতুন `firestore-rules` জব ফেইল করছিল (JDK 17 vs firebase-tools-এর Java 21+ চাহিদা)
- উপসর্গ (Symptom): `.github/workflows/build-apk.yml`-এ নতুন যোগ করা
  `firestore-rules` জব প্রতিবার ফেইল করছিল (`Add files via upload #283`,
  `#282`), `npm run test:rules` ধাপে exit code 1, `build` জব `needs`-এর
  কারণে সম্পূর্ণ skip হয়ে যাচ্ছিল।
- মূল কারণ (Root cause): `firebase-tools`-এর বর্তমান ভার্সন Firestore
  Emulator চালাতে JDK 21+ চায়, কিন্তু জব-এ Gradle-এর সাথে মিলিয়ে ভুলবশত
  JDK 17 সেট করা হয়েছিল। এরর স্পষ্টই ছিল: "firebase-tools no longer
  supports Java version before 21."
- ফিক্স কোথায়: `.github/workflows/build-apk.yml` → `firestore-rules` জবের
  "Setup Java" ধাপ, `java-version: '17'` → `'21'`। **শুধু এই জবেই বদলানো
  হয়েছে** — `build` জবের Gradle Java 17 অপরিবর্তিত (আলাদা প্রয়োজন, ছোঁয়া
  হয়নি)।
- ব্লাস্ট রেডিয়াস: শুধু CI workflow ফাইল, প্রোডাকশন কোড/APK অপ্রভাবিত।
- রিগ্রেশন টেস্ট যোগ হয়েছে কি: প্রযোজ্য না (CI কনফিগ বাগ, unit test দিয়ে
  ধরার মতো না) — তবে এই sandbox-এ Java 21 কনফার্ম করে `firebase
  emulators:exec` চালিয়ে দেখা হয়েছে যে Java-সংক্রান্ত এরর আর নেই (এমুলেটর
  jar ডাউনলোডে আটকেছে, যেটা sandbox network policy-জনিত, GitHub Actions-এ
  হবে না)।

### [পূরণ করুন] — #৮-এর এন্টারপ্রাইজ ধাপ: সিঙ্ক/ব্যাকআপ লজিক আলাদা করে টেস্টযোগ্য বানানো হলো (src/sync.js)
- সমস্যা যা ছিল: সিঙ্ক/ব্যাকআপের পুরো লজিক (checksum, `pickBackupFields`,
  `diffBackupFields`, Master Sync-এর মাল্টি-ডিভাইস merge/conflict-resolution)

  App.jsx-এর ভেতরে React hooks/Firebase-এর সাথে জড়ানো ছিল — তাই
  `tests/logic-tests.mjs`, fuzz test, `@ts-check` কোনোটাই এগুলো ছুঁতে পারত না।
  এই এলাকায় এডিট করলে অন্য কোথাও ভাঙল কিনা ধরার কোনো অটোমেটেড উপায় ছিল না,
  শুধু ডিভাইসে ম্যানুয়াল টেস্টই একমাত্র সেফটি-নেট ছিল।
- কী করা হলো: pure অংশটুকু (React/Firebase নির্ভরতাবিহীন) `src/sync.js`-এ
  বের করা হলো — `BACKUP_FIELDS` রেজিস্ট্রি, `pickBackupFields`,
  `diffBackupFields`, hash ফাংশনগুলো (`hashString`/`hashRecord`/
  `hashCollection`/`buildContentHashes`), `diffChangedFields`, `effectiveTs`।
  App.jsx-এ এখন এগুলো import করা হয় (ডুপ্লিকেট সংজ্ঞা নেই)।
- নতুন কী যোগ হলো: `mergeCollection()` — Master Sync-এর ভেতরে আগে inline
  লেখা কনফ্লিক্ট-রেজোলিউশন লজিকটা (local vs remote, `effectiveTs` দিয়ে
  last-write-wins, tombstone-protected — মুছে ফেলা রেকর্ড resurrect হবে না)
  এখন একটা আলাদা pure ফাংশন। `performMasterSync()`-এর ভেতরের ২৫-লাইনের
  inline merge loop এখন এই ফাংশনকেই কল করে — আচরণ অপরিবর্তিত, শুধু এখন
  টেস্টযোগ্য।
- নতুন টেস্ট: `tests/sync-tests.mjs` — ২৪টা কেস। বিশেষভাবে কভার করে:
  দুই ডিভাইস অফলাইনে একই রেকর্ড এডিট করলে কী হয় (`_updatedAt` ও `_serverTs`
  উভয় দিয়ে), tombstone-এ থাকা মোছা রেকর্ড পুরনো ব্যাকআপ থেকে resurrect হয়
  না কিনা, শুধু-local/শুধু-remote রেকর্ড, id-null edge case, hash-এর
  order-independence, delta-sync স্কিপ-লজিক, backup round-trip।
- `package.json` — `npm test` চেইনে `tests/sync-tests.mjs` যোগ হলো, তাই
  CI (build-apk.yml) ও husky pre-commit উভয়েই এখন এটা অটো চলে।
- ব্লাস্ট রেডিয়াস: `applyBackupFields`, restore preview, Master Sync,
  local/Drive auto-backup — সবগুলোই এই রেজিস্ট্রি/হ্যাশ/মার্জ ফাংশনগুলোর
  ওপর নির্ভরশীল, তাই এই এক্সট্র্যাকশন এদের সবার জন্যই regression-নিরাপত্তা
  বাড়ালো।
- আচরণ বদলায়নি কিনা: হ্যাঁ, নিশ্চিত — শুধু কোড সরানো হয়েছে, লজিক হুবহু একই
  (ব্যতিক্রম শুধু inline loop → ফাংশন কল, ফলাফল অভিন্ন)।
- যাচাই: `node tests/sync-tests.mjs` (২৪/২৪ পাস), সব বিদ্যমান
  `logic-tests.mjs`/`schema-tests.mjs`/`integration-tests.mjs` (৬৭/৬৭ পাস,
  অপরিবর্তিত), esbuild দিয়ে পুরো App.jsx বান্ডল করে সিনট্যাক্স/রেফারেন্স
  ভ্যালিডেট করা হয়েছে (কোনো error নেই) — এই সেশনে বাস্তবে চালিয়ে কনফার্ম।
  **তবে ডিভাইসে গিয়ে Master Sync/Backup/Restore ফিচার বাস্তবে আগের মতোই
  কাজ করছে কিনা — ডিপ্লয়ের পর একবার ম্যানুয়ালি চোখে দেখে নিন (behavior
  বদলানোর উদ্দেশ্য ছিল না, কিন্তু বড় রিফ্যাক্টর তাই সতর্কতা হিসেবে)।**
- এখনো বাকি (out-of-scope এই সেশনে): `applyBackupFields`-এর ভেতরের
  setter-কলিং অংশ ও `RestoreSelfTest`/`RetentionDB`/`ArchiveDB` এখনো
  App.jsx-এই আছে (IndexedDB/state-নির্ভর side-effect বেশি, pure করা কঠিন)।
  চাইলে পরের ধাপে backup→restore-এর পুরো round-trip (real IndexedDB মক করে)
  আলাদা integration test হিসেবে যোগ করা যায়।

### [পূরণ করুন] — ESLint যোগ করতেই ধরা পড়ল: "Cash Flow Forecast" ফিচার সম্পূর্ণ ভাঙা ছিল (src/worker.js)
- উপসর্গ (Symptom): কোনো ইউজার-রিপোর্ট ছিল না — এটা "Static Analysis" (আইটেম #৮-এর
  বাকি অংশ, ESLint) যোগ করার সময় প্রথম রানেই ধরা পড়েছে।
- মূল কারণ (Root cause): `src/worker.js`-এ `self.onmessage = ({ data }) => { ... };`
  হ্যান্ডলারের বন্ধনী `};` ভুল জায়গায় ছিল — "Cash Flow Forecast" (৬ নম্বর ফিচার)-এর
  পুরো ব্লকটা এই বন্ধনীর *বাইরে*, মডিউল top-level-এ বসানো ছিল। ফলে `data`
  ভ্যারিয়েবলটা undefined (`no-undef` — ESLint-এ error হিসেবে ধরা পড়ল), এবং worker
  script load হওয়ার সময়েই `ReferenceError` থ্রো করত।
- ব্লাস্ট রেডিয়াস: App.jsx থেকে `CASH_FLOW_FORECAST` টাইপ মেসেজ পাঠানো হতো এবং
  `CASH_FLOW_RESULT`-এর জন্য অপেক্ষা করা হতো (`setCashFlow`) — কিন্তু worker কখনো
  এই কোড পর্যন্ত পৌঁছাতোই না। মানে **"আগামী ৭ দিনের ক্যাশ ফ্লো ফোরকাস্ট" ফিচারটা
  প্রতিটা দোকানে, প্রতিবার, সম্পূর্ণ নিরবভাবে ব্যর্থ হচ্ছিল** — কোনো error UI-তে
  দেখা যেত না (worker script-level error, React ErrorBoundary এটা ধরে না), শুধু
  ফলাফল কখনো আসত না। এই ৮ নম্বর কাজের (auto bug detection) গুরুত্ব ঠিক এই
  ধরনের নিরব ব্যর্থতা ধরার জন্যই।
- ফিক্স কোথায়: `src/worker.js` — `CASH_FLOW_FORECAST` ব্লকটা `self.onmessage`
  হ্যান্ডলারের ভেতরে সরিয়ে আনা হলো (বন্ধনী সঠিক জায়গায়)।
- রিগ্রেশন টেস্ট: এই কোডটা browser Worker API-নির্ভর (postMessage/self), তাই
  plain-Node regression suite-এ সরাসরি কভার করা কঠিন — কিন্তু ESLint এখন CI-তে
  প্রতিটা push-এ চলে, তাই একই ধরনের "orphaned block, undefined variable" বাগ
  ভবিষ্যতে আর build পাস করতে পারবে না।
- যাচাই: `npm run lint` (0 errors), `npm run build` (সফল), `node --check src/worker.js`
  (syntax valid) — এই সেশনে আসলে চালিয়ে কনফার্ম করা হয়েছে। **তবে ডিভাইসে/টেস্ট
  শপে গিয়ে Cash Flow Forecast ফিচারটা বাস্তবে এখন ডেটা দেখাচ্ছে কিনা — এটা এখনো
  ম্যানুয়ালি চোখে দেখে যাচাই করা হয়নি, ডিপ্লয়ের পর করে নিন।**

### [পূরণ করুন] — Auto bug detection guide (#৮)-এর বাকি অংশ যোগ হলো: ESLint, Integration tests, JSDoc+@ts-check
- কী যোগ হলো:
  - `eslint.config.js` — ইচ্ছাকৃতভাবে সংকীর্ণ কনফিগ: `react-hooks/rules-of-hooks`
    ও `no-undef`/`no-unreachable` ইত্যাদি সত্যিকারের bug-প্যাটার্ন সবসময় error,
    কিন্তু `react-hooks/exhaustive-deps` ও `no-unused-vars` warn (legacy ৩৩k-লাইন
    ফাইলে শত শত pre-existing warning আছে — সেগুলো এখনই সব ফিক্স করা এই কাজের
    scope-এর বাইরে, তাই CI ব্লক করে না)।
  - `tests/integration-tests.mjs` — নতুন, ১০টা কেস। logic-tests.mjs-এর মতো একটা
    ফাংশন আলাদা টেস্ট না করে, একাধিক ফাংশন চেইন করে বাস্তব ফ্লো যাচাই করে
    (সেল→ভয়েড রাউন্ড-ট্রিপ, মিশ্র-পেমেন্ট দৈনিক সামারি, ক্রয়→সাপ্লায়ার-বাকি→ব্যাচ
    নম্বর, FEFO স্টক সিলেকশন)।
  - `jsconfig.json` + `@ts-check` (শুধু `src/logic.js`, `src/schemas.js`-এ) —
    App.jsx-এ টাইপ-চেক করা হয়নি ইচ্ছাকৃতভাবে (টাইপবিহীন ৩৩k লাইনে চালালে শত শত
    false-positive আসত)। এই চেকেই `getSortedActiveBatches`-এ একটা real
    type-safety ইস্যু ধরা পড়ল (`Date - Date` ইমপ্লিসিট coercion) — রানটাইমে
    বাগ ছিল না, কিন্তু `.getTime()` দিয়ে explicit করে দেওয়া হলো (আরও নিরাপদ)।
  - `npm run lint`, `npm run typecheck` — নতুন script; দুটোই CI gate-এ যোগ,
    build ধাপের আগে (`npm test`-এরও আগে)।
- বর্তমান বেসলাইন: ESLint ০ error / ৩৮৩ warning (সব `no-unused-vars` টাইপ নয়েজ),
  TypeScript ০ error। `npm test` এখন ৪৩+১৪+১০ = ৬৭টা কেস।
- যাচাই: lint/typecheck/test/build — সবগুলো এই সেশনে বাস্তবে চালিয়ে কনফার্ম
  করা হয়েছে।

### [পূরণ করুন] — fast-check fuzz testing প্রথমবার আসলে রান করে ৩টা এজ-কেস বাগ ধরা পড়ল ও ফিক্স হলো
- উপসর্গ (Symptom): আগের সেশনে fast-check ইনস্টল/লেখা হয়েছিল কিন্তু network-বিহীন
  কন্টেইনারে কখনো আসলে রান করা যায়নি — শুধু কোড-রিভিউ করে "ঠিক আছে" ধরে নেওয়া
  হয়েছিল। এই সেশনে প্রথমবার আসলে `npm run test:fuzz` চালিয়ে ৩টা রিয়েল বাগ পাওয়া গেল।
- মূল কারণ (Root cause):
  1. `calcInvoiceTotal(items, discount, extraCharge)` — `discount` extreme
     negative (যেমন `-Infinity`) হলে `Math.min(discount, ...)` নিজেই ঋণাত্মক
     অসীম হয়ে total-কে `Infinity` বানিয়ে দিত। একইভাবে `extraCharge` অসীম হলেও
     total `Infinity` হতো।
  2. `isBatchExpired(expiryDate)` — date-only ইনপুটে (`"YYYY-MM-DD"` প্রত্যাশিত)
     ফরম্যাট যাচাই ছাড়াই সরাসরি `new Date()` দিয়ে parse করা হতো। JS-এর native
     Date parser লেনিয়েন্ট — গার্বেজ স্ট্রিং ("0U") কেও চুপচাপ কোনো একটা
     (ভুল) তারিখ হিসেবে মেনে নেয়, `NaN`/throw করে না। ফলে ভুল ডেটা এলে ব্যাচ
     ভুলভাবে "মেয়াদোত্তীর্ণ" বা "মেয়াদহীন" ধরা হতে পারত।
- ফিক্স কোথায় (`src/logic.js`):
  - `calcInvoiceTotal`: `discount`/`extraCharge` কে `Number.isFinite()` দিয়ে
    যাচাই করে non-finite হলে `0` ধরা হয়, তারপর আগের ক্ল্যাম্পিং লজিক চলে।
  - `isBatchExpired`: date-only ব্রাঞ্চে `^\d{4}-\d{2}-\d{2}$` regex দিয়ে ফরম্যাট
    কড়াভাবে যাচাই করার পরই parse করা হয়; না মিললে সরাসরি `false`।
- ব্লাস্ট রেডিয়াস: `calcInvoiceTotal` সরাসরি `createInvoice()`-এ ব্যবহৃত, তাই এই
  বাগ থিওরিটিক্যালি বাস্তব ইনভয়েসেও total ভুল/Infinity করে দিতে পারত (যদিও UI
  থেকে discount/extraCharge কখনো Infinity পাঠানোর কথা না — বাস্তব ঝুঁকি কম,
  কিন্তু ডেটা-করাপশন/import বাগে সম্ভব)। `isBatchExpired` ব্যাচ স্টক/সেলযোগ্যতা
  হিসাবে ব্যবহৃত হয় — ভুল তারিখ পার্স হলে স্টক ভুল দেখানোর ঝুঁকি ছিল।
- রিগ্রেশন টেস্ট: হ্যাঁ — ৩টা নতুন কেস `tests/logic-tests.mjs`-এ যোগ করা হয়েছে
  (মোট ৪০ → ৪৩টা), যাতে এই এজ-কেসগুলো ভবিষ্যতে চুপচাপ ফিরে না আসে। fuzz suite
  ৫ বার (× ১০০০ random রান) চালিয়ে কনফার্ম করা হয়েছে — সব প্রপার্টি পাস।
- যাচাই: `npm test` (৪৩+১৪ কেস পাস), `npm run test:fuzz` (৫ বার), `npm run build`
  (সফল), `npx stryker run` (৭২.৫% — আগের বেসলাইনের কাছাকাছি, রিগ্রেশন নেই) —
  সবগুলো এই সেশনে আসলে চালিয়ে যাচাই করা হয়েছে, শুধু কোড-রিভিউ না।

### [পূরণ করুন] — Safety-net সম্প্রসারণ: fuzz testing, mutation testing, pre-commit gate, schema validation, dependency scanning
- উপসর্গ/উদ্দেশ্য: এটা কোনো বাগ-ফিক্স না — এন্টারপ্রাইজ-লেভেল অ্যাপ (Stripe/Shopify-সমতুল্য)
  সাধারণত যা করে তার সাথে এখনো যা বাকি ছিল, তার ৪টা যোগ করা হলো (branch protection
  আগেই, ব্যবহারকারী নিজে GitHub Settings-এ সেট করেছেন)।
- কী যোগ হলো:
  1. **`tests/logic-fuzz.mjs`** (fast-check) — fixed উদাহরণের বদলে হাজার হাজার
     random ইনপুট (negative qty, extreme discount, garbage date string ইত্যাদি)
     দিয়ে `calcInvoiceTotal`, `calcCashDrawer`, `restoreBatchQty`, `isBatchExpired`,
     `getSortedActiveBatches`, `computeSupplierDueMap`-এর invariant (যেমন "total
     কখনো নেগেটিভ হয় না") যাচাই করে। রান: `npm run test:fuzz`।
  2. **`stryker.conf.json`** (Stryker mutation testing) — `src/logic.js`-এ
     ইচ্ছাকৃত ছোট বাগ ঢুকিয়ে দেখে regression suite সেটা ধরে কিনা। রান:
     `npm run test:mutation`।
  3. **`.husky/pre-commit`** — commit করার আগেই লোকাল মেশিনে `npm test` চলে;
     সমস্যা GitHub Actions পর্যন্ত পৌঁছানোরও আগে ধরা পড়ে। `npm install`-এর পর
     স্বয়ংক্রিয়ভাবে সক্রিয় হয় (`prepare` script দিয়ে)।
  4. **`src/schemas.js`** (zod) + `FSS.setRecord()`-এ hook — Firestore-এ যেকোনো
     write-এর আগে টাকা/স্টক-সংক্রান্ত ফিল্ড (invoice.total, product.stock,
     cashLog.amount ইত্যাদি) NaN/undefined/Infinity কিনা যাচাই করে।
  5. **`.github/dependabot.yml`** — npm ও GitHub Actions dependency-তে security
     vulnerability এলে স্বয়ংক্রিয় PR।
- ⚠️ ইচ্ছাকৃত ডিজাইন সিদ্ধান্ত (গুরুত্বপূর্ণ, ভবিষ্যতে মনে রাখা দরকার):
  - Schema validation এই মুহূর্তে **soft mode** — invalid data পেলেও write আটকায়
    না, শুধু `console.warn` + `app_errors`-এ লগ করে। কারণ: strict validation
    ভুল করে বৈধ-কিন্তু-নতুন-শেপের ডেটা ব্লক করে লাইভ দোকানে বিক্রি আটকে দিতে
    পারত — সেই ঝুঁকি না নিয়ে আগে কিছুদিন লগ পর্যবেক্ষণ করে, false-positive না
    থাকলে তারপর hard-reject মোডে পাল্টানো উচিত (দেখুন `src/schemas.js`-এর
    শুরুর কমেন্ট)।
  - fuzz ও mutation টেস্ট **এখনো CI gate-এ (`build-apk.yml`) ব্লকিং না** —
    `npm test`-এ যোগ করা হয়নি ইচ্ছাকৃতভাবে, কারণ network-বিহীন পরিবেশে এই
    সেশনে নতুন dependency (fast-check, Stryker) বাস্তব GitHub Actions রানে
    কখনো সত্যিকারভাবে চালিয়ে দেখা যায়নি। প্রথমবার ম্যানুয়ালি রান করে ফলাফল
    দেখে নিশ্চিত হওয়ার পরই এগুলোকে ব্লকিং করা উচিত।
  - `src/schemas.js` ও `tests/schema-tests.mjs` স্থানীয়ভাবে zod (v3.23.8, একটা
    ইতিমধ্যে-ইনস্টল-করা কপি দিয়ে) দিয়ে সত্যিকারভাবে চালিয়ে ১৪টা কেস পাস
    কনফার্ম করা হয়েছে। fast-check ও Stryker নেটওয়ার্ক-বিহীন এই কন্টেইনারে
    ইনস্টল করা সম্ভব হয়নি বলে সেগুলো `npm install` করার পর প্রথমবার
    ম্যানুয়ালি রান করে নিশ্চিত হওয়া দরকার।
- ব্লাস্ট রেডিয়াস: `FSS.setRecord()` সব কালেকশনের (invoices, products,
  purchaseOrders, cashLogs, supplierPayments, customers) জন্য একই choke-point,
  তাই schema validation এক জায়গায় বসিয়েই সব কভার হয়ে গেছে।
- রিগ্রেশন টেস্ট যোগ হয়েছে কি: হ্যাঁ — `tests/schema-tests.mjs` (১৪টা কেস, `npm
  test`-এর অংশ) এবং `tests/logic-fuzz.mjs` (আলাদা স্ক্রিপ্ট, `npm run test:fuzz`)।

### [পূরণ করুন] — computeSupplierDueMap ডাবল-কাউন্টিং বাগ
- উপসর্গ: ম্যানুয়ালি "বাকি যোগ" না করলেও, শুধু ক্রয় অর্ডার থাকলেই সাপ্লায়ার
  পেজে বাকি দেখাত।
- মূল কারণ: `due = totalPurchased − paid` হিসেবে বের করা হতো, কিন্তু
  totalPurchased (ক্রয় অর্ডারের মোট মূল্য) আর "বাকি" এক জিনিস না — দোকানদার
  হয়তো ক্যাশে পুরো টাকা দিয়েই কিনেছেন, তাও সিস্টেম বাকি দেখাচ্ছিল।
- ফিক্স কোথায়: `src/logic.js` → `computeSupplierDueMap()` — এখন due শুধু
  ম্যানুয়াল বাকি-এন্ট্রি (type:"due") ও পেমেন্ট (type:"payment") দিয়ে নির্ধারিত।
- ব্লাস্ট রেডিয়াস: SupplierPaymentModule, Dashboard-এর ক্যাশ উইথড্রয়াল ফ্লো —
  দুটোই এই একই ফাংশন ব্যবহার করে, তাই একবার ফিক্স করলে দুই জায়গাতেই সিঙ্ক থাকে।
- রিগ্রেশন টেস্ট: হ্যাঁ — "সাপ্লায়ার বাকি" স্যুটের ৩টা কেস, বিশেষ করে
  "শুধু ক্রয় অর্ডার থাকলে... due ০ হওয়া উচিত" কেসটা সরাসরি এই বাগ আটকায়।

---

### [পূরণ করুন] — reference-copy ফাংশনগুলো আসল করা হলো (৪টা)
- উপসর্গ: এতদিন `calcInvoiceTotal`, `calcVoidNetChange`, `calcCashDrawer`,
  `restoreBatchQty` — এই ৪টা `src/logic.js`-এ শুধু "reference-copy" হিসেবে
  ছিল; আসল `createInvoice()`/`voidInvoice()`/`buildDailySummaryData()`
  নিজের মতো করে একই ফর্মুলা আলাদাভাবে লিখে রেখেছিল। ফলে টেস্ট সুইট পাস করলেও
  আসল প্রোডাকশন কোডে বাগ থাকলে সেটা ধরা পড়ত না (false sense of security)।
- মূল কারণ: প্রথম দফায় (আগের এন্ট্রি দ্রষ্টব্য) শুধু already-standalone
  ফাংশনগুলো নিরাপদে সরানো হয়েছিল, state-bound ফাংশনের ভেতরের ফর্মুলা তখন
  ছোঁয়া হয়নি — ইচ্ছাকৃতভাবে।
- ফিক্স কোথায়:
  - `voidInvoice()` → netChange হিসাব এখন `calcVoidNetChange(inv)` কল করে।
  - `voidInvoice()` → ব্যাচ-qty রিস্টোর (fallback পাথ) এখন `restoreBatchQty()`
    কল করে (soldBatchNo আছে/নেই — দুই ব্রাঞ্চই)।
  - `createInvoice()` → `total` হিসাব এখন `calcInvoiceTotal(items, discAmt, extraAmt)`
    কল করে (subtotal/itemDiscTotal/discAmt/extraAmt — যেগুলো UI display-তেও
    লাগে — এখনো লোকাল ভ্যারিয়েবল হিসেবে রাখা হয়েছে, শুধু final total-টা shared)।
  - `buildDailySummaryData()` → `currentCashDrawer` হিসাব এখন `calcCashDrawer()`
    কল করে।
- ব্লাস্ট রেডিয়াস: এই ৪টা ফাংশন এখন সত্যিকারের single-source-of-truth —
  ভবিষ্যতে কেউ ভুল করে ফর্মুলা বদলে ফেললে `npm test` সাথে সাথে ধরে ফেলবে,
  build/deploy আটকে যাবে (CI gate আগে থেকেই বসানো ছিল)।
- রিগ্রেশন টেস্ট: হ্যাঁ — বিদ্যমান ৩৩টা কেস এখন আসল App.jsx কোডকেই পরোক্ষভাবে
  cover করছে (import chain এখন App.jsx ↔ tests একই ফাইল থেকে আসে)।
- কোড-লেভেল যাচাই: এই সেশনে esbuild দিয়ে পুরো App.jsx syntax-check করা হয়েছে
  (parse error শূন্য) এবং `node tests/logic-tests.mjs` চালিয়ে confirm করা
  হয়েছে — কিন্তু **আসল ডিভাইসে/Test শপে চালিয়ে দেখা হয়নি**, তাই ডিপ্লয়ের আগে
  অন্তত একবার ম্যানুয়ালি একটা ইনভয়েস তৈরি + ভয়েড করে দেখে নেওয়া উচিত।

### [পূরণ করুন] — Coverage measurement (c8) যোগ করা হলো
- কী যোগ হলো: `npm run test:coverage` — `src/logic.js`-এর কত % আসলে টেস্ট
  হচ্ছে তার রিপোর্ট দেয় (text + html)।
- বর্তমান বেসলাইন: ৯৯% statement, ১০০% function, ~৬৭% branch কভারেজ।
- ৪০টা কেস এখন আছে (আগের ৩৩ + নতুন ৭টা — legacy stock path, FEFO sort
  tie-breaking, supplier aggregation, getActiveBatch)।
- এখনো এই ২ লাইন আনকভার্ড: `calcNextBatch`-এর `peEntries` ফিল্টার ব্র্যাঞ্চ
  (লাইন ৩৭) ও sort-এ উভয় ব্যাচেরই expiryDate থাকার ব্র্যাঞ্চ (লাইন ৭৪) —
  ছোট, low-risk গ্যাপ, পরে সময় হলে যোগ করা যায়।
