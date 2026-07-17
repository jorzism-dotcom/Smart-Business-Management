# ফেজ ০ — যা করা হলো, যা করা হয়নি, এবং কেন

## ১. প্রথমেই একটা discrepancy ধরা পড়েছে

`ENTERPRISE_ROADMAP.md` লেখা হয়েছিল ধরে নিয়ে যে Firestore Security Rules
ফাইলই নেই ("❌ Firebase Authentication, Security Rules — কোনোটাই নেই")।
কিন্তু আসল কোড চেক করে দেখা গেছে **rules আসলে আগে থেকেই আছে এবং প্রতিটা
দোকানের প্রজেক্টে deploy হয়** — শুধু standalone ফাইল হিসেবে repo-তে ছিল না,
বরং `netlify-site/admin.html`-এর ভেতর `FB_DEFAULT_RULES` / `FB_DEFAULT_INDEXES`
/ `FB_DEFAULT_RTDB` নামে জাভাস্ক্রিপ্ট টেমপ্লেট-লিটারেল হিসেবে embedded ছিল,
যেটা admin.html-এর "Firebase Deploy" ট্যাব থেকে প্রতিটা শপের নিজস্ব Firebase
project-এ push করা হয়।

সেই rules-এর নিজের কমেন্টেই ইতিমধ্যে স্পষ্ট লেখা আছে (আগের কোনো সেশনে করা):

- এই আর্কিটেকচারে Firebase Auth ব্যবহার করা হয় না — PIN/login সম্পূর্ণ
  client-side, তাই "কে" read/write করছে সেটা rules দিয়ে নিয়ন্ত্রণ করা সম্ভব
  না।
- তাই rules দুটো কাজ করে: (ক) shape/schema validation (ঋণাত্মক balance,
  অজানা status ইত্যাদি আটকানো), (খ) read/write ইচ্ছাকৃতভাবে খোলা (`if true`)
  রাখা।
- "কে" নিয়ন্ত্রণের জন্য ইতিমধ্যে **Firebase App Check** integrate করা আছে
  (`src/App.jsx` → `FSS.init()`, reCAPTCHA v3 provider, per-project optional
  `appCheckSiteKey`, Monitor/Enforce মোড)।

অর্থাৎ roadmap-এর ফেজ ০ আইটেম ২ ("Firebase Authentication যোগ করা") এবং তার
নিচের ধারণা ("যেকোনো ইউজার নিজেকে admin বানাতে পারে") — বাস্তবেই এখনো সত্যি,
কিন্তু এটা একটা **আগে থেকে নেওয়া, ডকুমেন্টেড আর্কিটেকচার সিদ্ধান্ত**, ভুলে
বাদ পড়া জিনিস না। নিচে "যা করা হয়নি" অংশে বিস্তারিত।

## ২. এই সেশনে যা করা হলো (verified, `npm test` এ পাস)

| # | কাজ | ফাইল |
|---|---|---|
| 1 | `firestore.rules` — admin.html থেকে extract করে standalone সোর্স-অফ-ট্রুথ ফাইল বানানো হয়েছে | `firestore.rules` |
| 2 | `firestore.indexes.json` — একইভাবে extract | `firestore.indexes.json` |
| 3 | `database.rules.json` (RTDB) — একইভাবে extract | `database.rules.json` |
| 4 | Firestore Emulator Suite কনফিগ (রোডম্যাপ ফেজ ০ আইটেম ১) | `firebase.json`, `.firebaserc` (demo-প্রজেক্ট, offline mode) |
| 5 | `@firebase/rules-unit-testing` দিয়ে rules-এর বিরুদ্ধে emulator টেস্ট — প্রতিটা collection-এর জন্য পজিটিভ + নেগেটিভ কেস (রোডম্যাপ ফেজ ০ আইটেম ৪) | `tests/rules-tests.mjs` — ৩২টা কেস |
| 6 | drift-detector — `firestore.rules`/`indexes`/`database.rules.json` আর admin.html-এর embedded কপি এক আছে কিনা যাচাই করে, না মিললে CI fail করে | `scripts/check-rules-sync.mjs` |
| 7 | `npm test` চেইনে sync-check যোগ; নতুন `npm run test:rules` ও `npm run emulators` স্ক্রিপ্ট | `package.json` |
| 8 | CI-তে নতুন `firestore-rules` জব — emulator চালিয়ে rules টেস্ট রান করে, `build` জব এর উপর নির্ভরশীল (rules regression হলে APK build আটকে যাবে) | `.github/workflows/build-apk.yml` |

### যাচাই কীভাবে হয়েছে
- `npm test` (logic ৪৩ + schema ১৪ + integration ১০ + sync ২৪ + rules-sync = সব পাস)।
- `tests/rules-tests.mjs` **আসল Firestore emulator চালিয়ে** এই sandbox-এই রান
  করানোর চেষ্টা হয়েছে (`npx firebase emulators:exec`) — Java 21 পাওয়া গেছে,
  কিন্তু emulator jar ডাউনলোডের জন্য `storage.googleapis.com` লাগে, যেটা এই
  sandbox-এর network allowlist-এ নেই (`403: Host not in allowlist`)। তাই এই
  একটা টেস্ট সেশনে সরাসরি চালিয়ে দেখানো যায়নি — শুধু syntax/module-resolution
  পর্যন্ত যাচাই হয়েছে (`node --check`, import resolve)।
  **GitHub Actions-এর runner-এ পূর্ণ ইন্টারনেট থাকে, তাই CI-তে এটা প্রথমবার
  push করার পর নিজে চোখে green/red দেখে নিশ্চিত হওয়া উচিত** — ঠিক যেভাবে
  BUGFIX_LOG.md-এর অন্য এন্ট্রিগুলোতেও "ডিভাইসে চালিয়ে দেখা হয়নি" নোট রাখা
  হয়েছে।
- `scripts/check-rules-sync.mjs` সরাসরি রান করে ৩টা ফাইলই admin.html-এর সাথে
  sync-এ আছে confirm করা হয়েছে।

## ৩. যা করা হয়নি (ইচ্ছাকৃতভাবে) — এবং কেন

### Firebase Authentication (রোডম্যাপ ফেজ ০ আইটেম ২)
এটা **অ্যাপ্লাই করিনি**। কারণ:
- এটা `App.jsx`-এর ৩৩,০০০+ লাইনের অনেক জায়গায় ছড়ানো `currentUser`/role লজিক,
  `FSS.init()`, staff device recovery, QR restore flow — সব কিছুকে ছুঁতে হবে।
- একবারে, review ছাড়া এত বড় production ফাইলে identity লেয়ার যোগ করা
  ঝুঁকিপূর্ণ — একটা ভুল হলে সব দোকানের সব ডিভাইস লকআউট হতে পারে (ঠিক যেভাবে
  App Check-এর কমেন্টেও "Monitor mode আগে, Enforce পরে" সতর্কতা লেখা আছে)।
- আপনার নিজের established working style অনুযায়ী এই মাপের পরিবর্তনের আগে
  স্পষ্ট প্ল্যান confirm করা দরকার।

**প্রস্তাবিত পরবর্তী ধাপ (আলাদা সেশনে, confirm করার পর):**
1. প্রতিটা ডিভাইসে **Anonymous Auth** সাইন-ইন যোগ করা (`FSS.init()`-এ,
   ব্যর্থ হলেও অ্যাপ বন্ধ না হওয়ার fallback-সহ, App Check-এর প্যাটার্ন
   অনুসরণ করে)।
2. `users/{uid}` ডকুমেন্টের id-টা Firebase Auth UID-এর সাথে map করা (এখন
   `uid()` দিয়ে random id, Auth UID না)।
3. role escalation বন্ধ করতে rules-এ `request.auth != null` + নিজের role
   বদলাতে না পারা শর্ত যোগ — কিন্তু **admin↔staff role আসলে server-side
   enforce করতে হলে custom claims লাগবে, যেটা একটা Cloud Function ছাড়া
   সম্ভব না** — আর Cloud Functions deploy করতে হলে GitHub Actions-এ নতুন
   workflow + Firebase CLI token লাগবে (এখন শুধু APK build workflow আছে)।
4. প্রতিটা ধাপ Monitor/staging-এ যাচাই করে তারপর সব শপে rollout — admin.html
   দিয়ে rules deploy আগে থেকেই আছে, তাই deployment mechanism নতুন করে বানানো
   লাগবে না।

### Server-side validation (রোডম্যাপ ফেজ ০ আইটেম ৫)
আংশিক ইতিমধ্যে আছে — shape/schema validation rules দিয়েই হচ্ছে (negative
balance, ভুল enum আটকানো)। কিন্তু role/discount-সীমা এর মতো "কে কী করতে
পারবে" সংক্রান্ত validation Auth+claims ছাড়া সম্ভব না — উপরের পয়েন্টের সাথে
বাঁধা।

### `@firebase/rules-unit-testing`-এ "staff bypass করা যাচ্ছে না" প্রমাণ করার কেস
রোডম্যাপে চাওয়া হয়েছিল এই কেসটা। এখন যেহেতু Auth নেই, উল্টো সত্যিটাই টেস্টে
canary হিসেবে রাখা হয়েছে: `users: [canary] role:admin unauthenticated
অবস্থাতেও সেট করা যায়` — এই টেস্ট **এখন পাস করাই প্রমাণ করে গ্যাপটা এখনো
খোলা আছে**। Auth যোগ হলে এই canary টেস্টটা fail করা শুরু করবে, তখন সেটাকে
উল্টে `assertFails`-এ পরিবর্তন করলেই bypass বন্ধ হওয়া প্রমাণিত হবে।

## ৪. সারসংক্ষেপ — roadmap স্ট্যাটাস আপডেট

- ✅ Firestore Emulator Suite সেটআপ
- ✅ Firestore Security Rules (আগে থেকেই ছিল, এখন standalone + testable)
- ✅ `@firebase/rules-unit-testing` টেস্ট (staff-bypass প্রমাণের বদলে
  বর্তমান open-write সীমাবদ্ধতার canary + সব schema validation কভার)
- ✅ CI workflow-এ emulator জব
- ⛔ Firebase Authentication — না করা হয়েছে (উপরে reasoning + প্রস্তাব)
- ⛔ Server-side role/discount enforcement — Auth-নির্ভর, তাই এখনো বাকি
