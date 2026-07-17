# Firebase Authentication + Role Enforcement — পূর্ণ রোডম্যাপ (মাল্টি-সেশন)

এই ডকুমেন্ট কোড না, প্ল্যান। প্রতিটা ফেজ আলাদা সেশনে, প্রতিটার আগে confirm
করে implement করা হবে — আপনার established working style অনুযায়ী।

---

## ০. সবার আগে যে ব্লকারটা জানা দরকার

**Cloud Functions চালাতে হলে প্রতিটা দোকানের Firebase project-কে Spark
(ফ্রি) থেকে Blaze (pay-as-you-go) প্ল্যানে upgrade করতে হবে** — এটা Firebase
platform-এর নিজস্ব সীমাবদ্ধতা, আমাদের আর্কিটেকচারের সমস্যা না। Blaze মানে
প্রতিটা প্রজেক্টে একটা billing account (real card) লাগবে, যদিও এই স্কেলের
ব্যবহারে (একটামাত্র ছোট Function, কম কল) প্রতি মাসে বিল প্রায় ০ টাকাই থাকার
কথা (Blaze-এও একটা free quota আছে) — কিন্তু "৫০০টা দোকানের প্রতিটায় billing
account লাগানো" — এটা নিজেই একটা বড়, মানুষের-হাতে-করা অপারেশনাল কাজ, যা
কোনো script দিয়ে automate করা যায় না (Google account owner-কেই card যোগ
করতে হয়)।

তাই কোড লেখা শুরুর আগে এই সিদ্ধান্তটা নিতে হবে —

### অপশন A — Cloud Functions per shop (roadmap-এ যেটা ধরে নেওয়া হয়েছিল)
- প্রতিটা দোকান Blaze-এ upgrade করতে হবে (manual, ৫০০ বার)
- `admin.html`-এ নতুন "Deploy Function" ধাপ যোগ করতে হবে — এটা rules/indexes
  push করার চেয়ে অনেক জটিল (কোড zip আপলোড, Cloud Build ট্রিগার, IAM
  permission, ইত্যাদি — REST API-তে সরাসরি "text paste করে publish" এর মতো
  সহজ না)
- সুবিধা: app-এর ভেতর থেকেই owner সরাসরি staff যোগ করতে পারবে (বর্তমান UX
  বজায় থাকে), role-change রিয়েল-টাইম

### অপশন B — Developer-mediated claims (কোনো Cloud Function লাগে না)
- `admin.html` (আপনি নিজে, Google OAuth দিয়ে, প্রজেক্ট owner হিসেবে) সরাসরি
  Identity Platform Admin REST API (`accounts:update` + `customAttributes`)
  কল করে নির্দিষ্ট user-এর role claim বসাবে — কোনো Function/Blaze লাগবে না
- সীমাবদ্ধতা: দোকানদার নিজে app থেকে নতুন staff-কে সরাসরি "admin বানানো"
  করতে পারবে না — সেটা করতে হলে আপনাকে (developer-কে) admin.html দিয়ে করে
  দিতে হবে। ছোট দোকানে staff role change কালেভদ্রে হয়, তাই এই ট্রেড-অফ
  বাস্তবসম্মত হতে পারে
- সুবিধা: Blaze প্ল্যান লাগে না, deploy mechanism আগের মতোই সহজ থাকে

### অপশন C — হাইব্রিড
- শুরুতে অপশন B দিয়ে চালু (দ্রুত, কম ঝুঁকি), পরে চাহিদা বুঝে যেসব দোকান
  ঘনঘন staff role বদলায় তাদের জন্য অপশন A (Cloud Function) চালু করা

**সুপারিশ:** অপশন B দিয়ে শুরু করা — সবচেয়ে কম ব্লকার, সবচেয়ে দ্রুত রোল-আউট,
আর "role escalation বন্ধ" মূল সিকিউরিটি সমস্যাটা এটাতেই সমাধান হয়ে যায়
(client নিজে নিজের role আর বদলাতে পারবে না, শুধু developer-authorized claim
দিয়েই role নির্ধারিত হবে)। ফেজ ভাঙা হয়েছে অপশন B ধরে — কিন্তু ফেজ ১-২ দুটোই
অপশন A/C-এর জন্যও দরকার, তাই সিদ্ধান্ত পরেও পাল্টানো যাবে।

---

## ফেজ ১ — Anonymous Auth wiring (ছোট, কম ঝুঁকি) ✅ সম্পন্ন (এই সেশনে)

**লক্ষ্য:** প্রতিটা ডিভাইস Firebase Auth-এ একটা স্থায়ী identity (UID) পায়,
কিন্তু কোনো ব্যবহারকারী-facing পরিবর্তন নেই (PIN/login UI আগের মতোই)।

- `src/App.jsx` → `FSS.init()`-এ `signInAnonymously()` যোগ (App Check-এর
  fallback প্যাটার্ন অনুসরণ করে — ব্যর্থ হলেও অ্যাপ বন্ধ হবে না)
- `onAuthStateChanged` দিয়ে UID resolve হওয়া পর্যন্ত write queue/wait
- **টেস্ট:** `tests/rules-tests.mjs`-এ `authenticatedContext(uid)` কেস যোগ,
  কিন্তু rules এখনো বদলাবে না (এই ফেজে শুধু identity তৈরি হচ্ছে, enforce না)
- **রোলআউট ঝুঁকি:** কম — rules অপরিবর্তিত থাকায় পুরনো APK (auth ছাড়া) এখনো
  কাজ করবে, নতুন APK auth নিয়ে যোগ হবে ধীরে ধীরে

### যা আসলে করা হয়েছে
- `src/App.jsx`-এ `firebase/auth` ইম্পোর্ট (`getAuth`, `signInAnonymously`,
  `onAuthStateChanged`) — কোনো নতুন npm dependency লাগেনি, `firebase`
  প্যাকেজের ভেতরেই আছে।
- `FSS` অবজেক্টে `_auth`/`_authUid`/`_authInitTried` state + `getAuthUid()`
  + `_ensureAnonAuth()` — `init()`-এর শেষে (App Check-এর ঠিক পরে) fire-and
  -forget কল হয়, `teardown()`-এ রিসেট হয়।
- **UI/rules/PIN ফ্লো-তে কোনো পরিবর্তন নেই** — `getAuthUid()` এখন কোথাও
  ব্যবহৃতও হচ্ছে না, শুধু availability তৈরি হলো পরের ফেজের জন্য।
- Firebase Console-এ Anonymous provider এখনো কোনো শপে Enable করা লাগবে
  (per-project ম্যানুয়াল ধাপ, ফেজ ৫-এ admin.html চেকলিস্টে যোগ হবে) —
  না করা থাকলে `signInAnonymously()` silently ব্যর্থ হবে, অ্যাপ স্বাভাবিক
  চলবে (এটাই ইচ্ছাকৃত fallback আচরণ)।

### যাচাই
- `npx esbuild` দিয়ে সম্পূর্ণ `src/App.jsx` parse (0 error)
- `npm run build` — আসল production Vite build সফল (firebase/auth ঠিকভাবে
  bundle হয়েছে, `dist/assets/firebase-*.js`-এ)
- `npm run lint` — 388 warning (0 error), নতুন কোডে **কোনো নতুন warning
  নেই** (auth-সংক্রান্ত সব warning পুরনো, অসম্পর্কিত কোডে)
- `npm run typecheck` — clean
- `npm test` (logic+schema+integration+sync+rules-sync) — সব পাস
- `tests/rules-tests.mjs`-এ একটা নতুন parity কেস যোগ হয়েছে
  (`authenticatedContext` থেকে লেখা আজও unauthenticated-এর মতোই আচরণ করে
  — rules এখনো বদলায়নি বলে এটাই প্রত্যাশিত)। এমুলেটরে সরাসরি রান করে
  দেখানো যায়নি (sandbox network policy-তে `storage.googleapis.com`
  ব্লকড, আগের সেশনের মতোই) — CI-তে `firestore-rules` জব প্রথমবার সবুজ
  হওয়া দেখে নিশ্চিত হবেন।
- **ডিভাইসে/আসল দোকানে এখনো চালিয়ে দেখা হয়নি** — deploy করার আগে অন্তত
  একবার dev/staging শপে চালিয়ে Settings-এ কোনো error/lockout হচ্ছে না
  নিশ্চিত করা উচিত।

## ফেজ ২ — `users/{uid}` মাইগ্রেশন

**লক্ষ্য:** এখনকার random `uid()` ডকুমেন্ট-আইডির বদলে Firebase Auth UID-কেই
`users` কালেকশনের ডকুমেন্ট-আইডি বানানো, যাতে rules-এ
`request.auth.uid == userId` ম্যাচ করা যায়।

- বিদ্যমান শপে ইতিমধ্যে থাকা `users` ডকুমেন্ট migrate করার লজিক (একবার-চলা
  script, প্রতিটা ডিভাইসের প্রথম বুটে)
- staff QR restore flow-এ নতুন UID resolve/map করা
- centralRecoveryPush/staff device recovery ফ্লো আপডেট (এখানে আগেও একবার
  bug পাওয়া গিয়েছিল — এই ফেজে বাড়তি সতর্কতা দরকার)
- **টেস্ট:** integration-tests.mjs-এ migration লজিকের pure অংশ, rules-tests
  এ owner-vs-other-uid কেস

## ফেজ ৩ — Rules-এ auth enforce করা (staged rollout)

**লক্ষ্য:** `request.auth != null` সব collection-এ বসানো (read/write আর
সম্পূর্ণ খোলা থাকবে না) — কিন্তু role-based bypass এখনো বন্ধ হচ্ছে না, শুধু
"সম্পূর্ণ অচেনা ক্লায়েন্ট" আটকানো হচ্ছে।

- প্রথমে ১টা টেস্ট-শপে (আপনার নিজের dev প্রজেক্টে) deploy + কয়েকদিন Monitor
- rules-tests.mjs-এর canary কেসগুলো (`assertSucceeds` unauthenticated) এই
  ফেজে flip হয়ে `assertFails` হওয়া উচিত — এটাই এই ফেজ "সম্পন্ন" হওয়ার প্রমাণ
- admin.html-এর "Deploy" ট্যাবে একটা সতর্কবার্তা/চেকবক্স যোগ (পুরনো,
  auth-বিহীন APK ব্যবহার করা ডিভাইসের জন্য rollback প্ল্যান)

## ফেজ ৪ — Role claims (অপশন B ধরে) + role-based rules

**লক্ষ্য:** `request.auth.token.role` দিয়ে admin/staff আলাদা করা, staff
নিজের role client-side লিখে বদলাতে না পারা।

- `admin.html`-এ নতুন সেকশন: "Staff role manager" — Identity Platform
  `accounts:update` REST কল দিয়ে নির্দিষ্ট UID-এর `customAttributes` সেট
  করা (developer নিজে চালাবে, per-shop)
- Firestore rules-এ `users/{id}` write-এ শর্ত: নিজের role field client থেকে
  বদলানো যাবে না (`request.resource.data.role == resource.data.role` অথবা
  admin claim না থাকলে role field touch-ই করতে না পারা)
- **টেস্ট:** rules-tests.mjs-এ role-claim সহ/ছাড়া context বানিয়ে
  staff-bypass আসলেই বন্ধ প্রমাণ করা — এটাই আসল roadmap-চাওয়া কেস

## ফেজ ৫ — সব শপে রোলআউট + cleanup

- admin.html দিয়ে batch-এ (একটা একটা করে, প্রতিটার পরে confirm) সব দোকানে
  নতুন rules push
- App.jsx-এর পুরনো "role শুধু local state" ধরে নেওয়া জায়গাগুলো ঝাড়াই-বাছাই
- `PHASE0_NOTES.md`-এর canary নোট সরিয়ে rules-tests.mjs আপডেট করা
- BUGFIX_LOG.md-এ পুরো migration-এর সারসংক্ষেপ এন্ট্রি

---

## এখন কী করব?

এই সেশনে শুধু ডকুমেন্ট রাখলাম (`FIREBASE_AUTH_ROADMAP.md`)। পরের যেকোনো
সেশনে বললেই ফেজ ১ (Anonymous Auth wiring) দিয়ে শুরু করব — সবচেয়ে ছোট,
সবচেয়ে কম ঝুঁকি, আর App Check-এর মতোই "fallback-সহ, ব্যর্থ হলেও অ্যাপ বন্ধ
না হওয়া" প্যাটার্নে। শুরুর আগে একটা জিনিস আপনার কাছ থেকে লাগবে: **অপশন A/B/C
কোনটায় এগোতে চান, সেটা কনফার্ম** — কারণ ফেজ ৪-এর ডিজাইন এটার উপর নির্ভর করে
(যদিও ফেজ ১-৩ দুই অপশনেই একই থাকে, তাই এখনই সিদ্ধান্ত না নিলেও ফেজ ১ শুরু
করা যায়)।
