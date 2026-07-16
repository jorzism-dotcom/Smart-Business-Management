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
