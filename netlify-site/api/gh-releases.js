// netlify-site/api/gh-releases.js
// GitHub Releases proxy — admin.html সরাসরি api.github.com কল না করে এই
// endpoint কল করে। কারণ:
//  ১. unauthenticated GitHub API কল ঘণ্টায় মাত্র ৬০টা পায় — বারবার টেস্ট/রিলোড
//     করলে দ্রুত শেষ হয়ে 403 Forbidden দেয়। এখানে (ঐচ্ছিক) GH_TOKEN
//     Vercel env variable ব্যবহার করলে লিমিট ৫,০০০/ঘণ্টা হয়ে যায় — আর
//     token কখনো ব্রাউজারে যায় না, সম্পূর্ণ সার্ভার-সাইড।
//  ২. কয়েক মিনিট in-memory cache রাখা হয়, তাই বারবার admin panel রিলোড
//     করলেও GitHub-এ বারবার কল যায় না।
// Vercel serverless function (Node runtime, /api ফোল্ডার auto-detect হয়)।

const GH_OWNER_REPO = "jorzism-dotcom/SBM"; // 🔴 আগে admin.html-এ ভুল করে "Turjo" ছিল — এটাই আসল repo নাম
const CACHE_TTL_MS = 5 * 60 * 1000; // ৫ মিনিট

// module-level cache — একই warm serverless instance-এ পরের রিকোয়েস্টগুলোতে reuse হয়
// (cold start হলে খালি হয়ে যায়, সেটা ঠিক আছে — GitHub-এ একটা নতুন কল যাবে)
let cache = { data: null, fetchedAt: 0 };

module.exports = async (req, res) => {
  const ALLOWED_ORIGINS = [
    "https://sbm-admin-mocha.vercel.app",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
  ];
  const origin = req.headers?.origin || req.headers?.Origin || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "https://sbm-admin-mocha.vercel.app";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method Not Allowed" }); return; }

  try {
    const now = Date.now();
    if (cache.data && (now - cache.fetchedAt) < CACHE_TTL_MS) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json(cache.data);
      return;
    }

    const headers = { "Accept": "application/vnd.github+json" };
    const GH_TOKEN = process.env.GH_TOKEN; // ঐচ্ছিক — বসালে rate limit ৬০ → ৫,০০০/ঘণ্টা
    if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;

    const ghRes = await fetch(`https://api.github.com/repos/${GH_OWNER_REPO}/releases?per_page=15`, { headers });
    const data = await ghRes.json();

    if (!ghRes.ok) {
      // GitHub থেকে আসা আসল error (403/404 ইত্যাদি) স্বচ্ছভাবে ফরোয়ার্ড করা হয়,
      // যাতে admin.html-এ সঠিক কারণ দেখা যায় — অন্ধভাবে rate-limit ধরে না নিয়ে।
      res.status(ghRes.status).json(data);
      return;
    }

    cache = { data, fetchedAt: now };
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
