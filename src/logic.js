// @ts-check
// ─── src/logic.js ────────────────────────────────────────────────────────────
// এই ফাইলে থাকা প্রতিটি ফাংশন খাঁটি (pure): কোনো React state, Firebase, বা DOM
// ছোঁয় না — শুধু ইনপুট নিয়ে হিসাব করে আউটপুট দেয়। এই কারণেই এগুলো এই আলাদা
// ফাইলে রাখা হয়েছে (App.jsx থেকে সরিয়ে আনা, কোনো লজিক পরিবর্তন ছাড়াই):
//
//   1. App.jsx এখান থেকে import করে ব্যবহার করে (browser bundle-এ)।
//   2. tests/logic-tests.mjs ঠিক এই একই ফাইল থেকে import করে টেস্ট চালায়
//      (plain Node.js-এ, কোনো browser/Firebase/build ছাড়াই, তাই CI-তে
//      সেকেন্ডে চলে)।
//
// ⚠️ এই ফাইলের কোনো ফাংশন বদলালে, tests/logic-tests.mjs-এ সংশ্লিষ্ট টেস্ট
// কেসও যাচাই/আপডেট করুন। নতুন কোনো pure formula/হিসাব ফাংশন লেখার সময় সেটাও
// এখানে রাখুন (App.jsx-এর ভেতরে ছড়িয়ে না রেখে) — যাতে ভবিষ্যতেও regression
// টেস্টে ধরা পড়ে।

// ─── তারিখ/সময় (বাংলাদেশ, GMT+6, DST নেই) ───────────────────────────────────
export const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

// d (যেকোনো real মুহূর্ত/Date) থেকে বাংলাদেশ সময় অনুযায়ী {y, m(0-indexed), day} বের করে
export function _bdParts(d = new Date()) {
  const s = new Date(d.getTime() + BD_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), day: s.getUTCDate() };
}

// ─── calcNextBatch — Option B: Date-based B-YYMM-N format ───────────────────
// ক্রয়ের তারিখ থেকে B-YYMM-N ফরম্যাটে ব্যাচ আইডি জেনারেট করে
// একই মাসে একাধিক ক্রয়: B-2506-1, B-2506-2, ...
export function calcNextBatch(productId, products, purchaseOrders, purchaseDate) {
  const now = purchaseDate ? new Date(purchaseDate) : new Date();
  // সবসময় GMT+6 (বাংলাদেশ) অনুযায়ী ব্যাচ-মাস নির্ধারিত হয় (ডিভাইসের local timezone না)।
  const { y: _by, m: _bm } = _bdParts(now);
  const yy = String(_by).slice(2);
  const mm = String(_bm + 1).padStart(2, "0");
  const prefix = `B-${yy}${mm}-`;

  const peEntries = (purchaseOrders || []).filter(e =>
    e._type === "pe" && e.productId === productId
  );
  const prod = (products || []).find(p => p.id === productId);
  const batchBatches = (prod?.batches || []).map(b => b.batchNo || "");

  const allBatchIds = [
    ...peEntries.map(e => e.batch || ""),
    ...batchBatches,
  ];
  const thisMonthNums = allBatchIds
    .filter(b => b.startsWith(prefix))
    .map(b => parseInt(b.slice(prefix.length), 10))
    .filter(n => !isNaN(n));

  const nextN = thisMonthNums.length > 0 ? Math.max(...thisMonthNums) + 1 : 1;
  return `${prefix}${nextN}`;
}

// ─── isBatchExpired — একটা তারিখ আজকের হিসেবে মেয়াদোত্তীর্ণ কিনা ─────────────
// date-only ("YYYY-MM-DD") হলে দিনের শেষ (23:59:59) পর্যন্ত সেইদিন এখনো বিক্রয়যোগ্য
/**
 * @param {string|null|undefined} expiryDate
 * @returns {boolean}
 */
export function isBatchExpired(expiryDate) {
  if (!expiryDate) return false;
  // date-only ইনপুট (যেমন "YYYY-MM-DD") হলে ফরম্যাট কড়াভাবে যাচাই করা হয় — কারণ
  // native Date parsing বিভিন্ন garbage string ("0U" ইত্যাদি) কেও চুপচাপ কোনো একটা
  // (ভুল) তারিখ হিসেবে মেনে নেয়, throw/NaN করে না (fuzz টেস্টে ধরা পড়া বাগ)।
  const isDateOnly = !/T/.test(expiryDate);
  if (isDateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return false;
  const exp = isDateOnly ? new Date(`${expiryDate}T23:59:59`) : new Date(expiryDate);
  if (isNaN(exp.getTime())) return false;
  return exp < new Date();
}

// ─── getSortedActiveBatches — p.batches থেকে FIFO অর্ডারে সব active (qty>0,
// অ-মেয়াদোত্তীর্ণ) batch — productBatchMap, prodBatchMap, এবং বিক্রয়ের সময়
// stock deduction — সব একই sort logic ব্যবহার করে
export function getSortedActiveBatches(product) {
  if (!product?.batches || product.batches.length === 0) return [];
  return product.batches
    .filter(b => (b.qty || 0) > 0 && !isBatchExpired(b.expiryDate))
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime();
    });
}

// ─── getActiveBatch — p.batches থেকে FIFO active (অ-মেয়াদোত্তীর্ণ) batch ────
export function getActiveBatch(product) {
  const active = getSortedActiveBatches(product);
  return active[0] || null;
}

// ─── getSellableStock — পণ্যের প্রকৃত বিক্রয়যোগ্য (অ-মেয়াদোত্তীর্ণ) স্টক ──────
export function getSellableStock(product) {
  if (!product) return 0;
  if (product.productType === "service") return Infinity;
  if (product.batches && product.batches.length > 0) {
    return getSortedActiveBatches(product).reduce((s, b) => s + (b.qty || 0), 0);
  }
  // legacy: batch-tracking ছাড়া পুরনো পণ্য — top-level expiryDate দিয়ে চেক
  if (isBatchExpired(product.expiryDate)) return 0;
  return product.stock || 0;
}

// ─── computeSupplierDueMap — সাপ্লায়ার-ভিত্তিক বাকি হিসাব ────────────────────
// due শুধুমাত্র ম্যানুয়াল "বাকি যোগ" এন্ট্রি (type:"due") ও পেমেন্ট (type:"payment")
// দিয়ে নির্ধারিত হয় — ক্রয় অর্ডারের মোট মূল্যের (totalPurchased) সাথে due-এর
// কোনো সরাসরি সম্পর্ক নেই (আগে একটা বাগ ছিল যেখানে শুধু ক্রয় অর্ডার থাকলেই
// বাকি দেখাতো, ম্যানুয়ালি যোগ না করলেও — এখন ফিক্সড)।
export function computeSupplierDueMap(products = [], purchaseOrders = [], supplierPayments = []) {
  const map = {};
  const ensure = (name) => {
    if (!map[name]) map[name] = { name, productCount: 0, totalStock: 0, totalPurchased: 0, paid: 0, due: 0 };
    return map[name];
  };
  (products || []).forEach(p => {
    const name = (p.company || p.supplier || "").trim();
    if (!name) return;
    const row = ensure(name);
    row.productCount++;
    row.totalStock += (p.stock || 0);
  });
  (purchaseOrders || []).forEach(po => {
    const name = (po.supplier || po.company || "").trim();
    if (!name) return;
    const row = ensure(name);
    const amt = (po.items || []).reduce((s, it) => s + (it.qty || 0) * (it.costPrice || it.price || 0), 0);
    row.totalPurchased += amt;
  });
  (supplierPayments || []).forEach(p => {
    const name = (p.supplierName || "").trim();
    if (!name) return;
    const row = ensure(name);
    const signed = p.type === "due" ? -(p.amount || 0) : (p.amount || 0);
    row.paid += signed;
  });
  Object.values(map).forEach(row => { row.due = Math.max(0, -row.paid); });
  return map;
}

// ─── Shared Profit Utilities ──────────────────────────────────────────────────
// সব জায়গায় একই formula: cost = it.costPrice ?? p.costPrice ?? 0 (invoice-time দাম আগে)
//                          revenue = inv.total (discount-পরবর্তী)
export function _itemCostPrice(item, prodMap) {
  const prod = prodMap?.get?.(item.productId);
  // সেবা পণ্যের costPrice সবসময় 0 (পুরো বিক্রয়মূল্যই লাভ)
  if (item.productType === "service" || prod?.productType === "service") return 0;
  return (item.costPrice != null) ? item.costPrice : (prod?.costPrice ?? 0);
}

export function calcInvoiceProfit(inv, prodMap) {
  const items = inv.items || [];
  const subtotal = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  // total = subtotal - itemDiscount - discount + extraCharge
  // revenue = (subtotal - itemDiscount - discount) + extraCharge = items revenue + extraCharge
  const discount = (inv.discount || 0) + (inv.itemDiscount || 0);
  const extraCharge = inv.extraCharge || 0;
  const discountRatio = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  const itemsProfit = items.reduce((s, it) => {
    const qty = it.qty || 1;
    const revenue = (it.price || 0) * qty * discountRatio; // discount-adjusted
    const cost = _itemCostPrice(it, prodMap) * qty;
    return s + revenue - cost;
  }, 0);
  // extraCharge পুরোটাই লাভ (কোনো cost নেই)
  return itemsProfit + extraCharge;
}

export function calcProfitTotal(invList, prodMap) {
  return invList.reduce((s, inv) => s + calcInvoiceProfit(inv, prodMap), 0);
}

// ✅ আপডেট: নিচের ৪টি ফাংশন আর "reference-copy" না — এখন single-source-of-truth।
// createInvoice() / voidInvoice() / buildDailySummaryData() (App.jsx) এখন এই
// ফাংশনগুলো সরাসরি import করে কল করে, নিজেদের আলাদা কপি রাখে না (দেখুন
// BUGFIX_LOG.md-এর "reference-copy ফাংশনগুলো আসল করা হলো" এন্ট্রি)। তাই এখন
// এই ফাংশন বদলালে App.jsx-এর আসল ইনভয়েস/ভয়েড/সামারি লজিকও একইসাথে বদলে যায় —
// আলাদা করে App.jsx-এ হাতে মিলিয়ে আপডেট করার দরকার নেই।
// ─── ইনভয়েস total সূত্র — createInvoice() সরাসরি এই ফাংশন কল করে ────────────
/**
 * @param {Array<{qty:number, price:number, itemDiscount?:number}>} items
 * @param {number} discount
 * @param {number} extraCharge
 * @returns {number}
 */
export function calcInvoiceTotal(items, discount, extraCharge) {
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const itemDiscTotal = items.reduce((s, i) => s + Math.min(Math.max(i.itemDiscount || 0, 0), i.qty * i.price), 0);
  const safeDiscount = Number.isFinite(discount) ? discount : 0;
  const safeExtraCharge = Number.isFinite(extraCharge) ? extraCharge : 0;
  const discAmt = Math.min(Math.max(safeDiscount, 0), Math.max(0, subtotal - itemDiscTotal));
  const extraAmt = Math.max(safeExtraCharge, 0);
  return subtotal - itemDiscTotal - discAmt + extraAmt;
}

// ─── ভয়েড-রিভার্সাল netChange সূত্র — voidInvoice() সরাসরি এই ফাংশন কল করে ────
/**
 * @param {{payType?:string, total?:number, bakiAmount?:number, overpayAmount?:number}} inv
 * @returns {number}
 */
export function calcVoidNetChange(inv) {
  return (inv.payType === "baki" ? inv.total : (inv.bakiAmount || 0)) - (inv.overpayAmount || 0);
}

// ─── ক্যাশ ড্রয়ার সূত্র — buildDailySummaryData() সরাসরি এই ফাংশন কল করে ──────
/**
 * @param {number} opening
 * @param {number} cashSale
 * @param {number} joma
 * @param {number} withdrawal
 * @returns {number}
 */
export function calcCashDrawer(opening, cashSale, joma, withdrawal) {
  return opening + cashSale + joma - withdrawal;
}

// ─── ব্যাচ-স্টক রিস্টোর — voidInvoice() সরাসরি এই ফাংশন কল করে ────────────────
/**
 * @param {Array<{batchNo:string, qty:number}>} batches
 * @param {string} batchNo
 * @param {number} restoredQty
 * @param {object} [fallback]
 * @returns {Array<{batchNo:string, qty:number}>}
 */
export function restoreBatchQty(batches, batchNo, restoredQty, fallback = {}) {
  let updated = batches ? [...batches] : [];
  const idx = updated.findIndex(b => b.batchNo === batchNo);
  if (idx >= 0) updated[idx] = { ...updated[idx], qty: (updated[idx].qty || 0) + restoredQty };
  else updated.push({ batchNo, qty: restoredQty, ...fallback });
  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTERPRISE_MONITORING_PLAN.md ফেজ D / D1 — প্রোডাকশন রানটাইম ইনভ্যারিয়েন্ট-চেক
// ═══════════════════════════════════════════════════════════════════════════
// এই ফাংশন সম্পূর্ণ pure (কোনো Firestore/React কল না) — App.jsx একটা periodic
// টাইমারে এটা কল করে, ফলাফলে কোনো violation পেলে logErrorToCentral() দিয়ে
// app_errors-এ (context: "invariant_check:<type>") লগ করে — admin.html-এর
// এরর লগ প্যানেলে (ERROR_KB-সহ) সেটা স্বয়ংক্রিয়ভাবে দেখা যায়।
//
// কভারেজ (D1-এ উল্লেখিত দুটো নির্দিষ্ট ইনভ্যারিয়েন্ট):
//   ১. নেগেটিভ স্টক — কোনো পণ্যের stock (বা কোনো ব্যাচের qty) ০-এর নিচে নামা
//      কখনোই সম্ভব হওয়ার কথা না — তাই যদি তাও দেখা যায়, সেটা একটা real
//      bug/রেস-কন্ডিশনের লক্ষণ।
//   ২. ক্যাশ-ড্রয়ার mismatch — calcCashDrawer() দিয়ে হিসাব করা প্রত্যাশিত ক্যাশ
//      ঋণাত্মক হওয়া মানে opening/cashSale/joma/withdrawal-এর কোথাও ভুল ডেটা
//      ঢুকেছে (ডাবল-কাউন্ট, মিসিং txn ইত্যাদি)।
//
// নোট: এই ফাংশন নিজে কিছু লগ করে না (pure, তাই tests/logic-tests.mjs থেকে
// সরাসরি টেস্ট করা যায়) — শুধু violation-এর তালিকা ফেরত দেয়, লগ করাটা
// caller (App.jsx)-এর দায়িত্ব।
function _isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }

/**
 * @param {{
 *   products?: Array<{id?:string,name?:string,stock?:number,batches?:Array<{batchNo?:string,qty?:number}>}>,
 *   opening?: number, cashSale?: number, joma?: number, withdrawal?: number,
 * }} state
 * @returns {Array<{type:string, message:string}>}
 */
export function runInvariantChecks(state = {}) {
  const violations = [];
  const products = state.products || [];

  // ১) নেগেটিভ স্টক — পণ্যের top-level stock এবং প্রতিটা ব্যাচের qty দুটোই চেক
  for (const p of products) {
    if (_isFiniteNum(p?.stock) && p.stock < 0) {
      violations.push({
        type: "negative_stock",
        message: `পণ্য "${p.name || p.id || "?"}" (id: ${p.id || "?"})-এর stock ঋণাত্মক: ${p.stock}`,
      });
    }
    for (const b of (p?.batches || [])) {
      if (_isFiniteNum(b?.qty) && b.qty < 0) {
        violations.push({
          type: "negative_stock",
          message: `পণ্য "${p.name || p.id || "?"}"-এর ব্যাচ "${b.batchNo || "?"}"-এর qty ঋণাত্মক: ${b.qty}`,
        });
      }
    }
  }

  // ২) ক্যাশ-ড্রয়ার mismatch — শুধু ইনপুট দেওয়া থাকলেই চেক করা হয় (caller
  // buildDailySummaryData()-এর ফলাফল থেকে opening/cashSale/joma/withdrawal পাঠায়)
  const { opening, cashSale, joma, withdrawal } = state;
  if ([opening, cashSale, joma, withdrawal].some(_isFiniteNum)) {
    const drawer = calcCashDrawer(opening || 0, cashSale || 0, joma || 0, withdrawal || 0);
    if (drawer < 0) {
      violations.push({
        type: "cash_drawer_mismatch",
        message: `ক্যাশ ড্রয়ার হিসাব ঋণাত্মক: opening=${opening || 0} + cashSale=${cashSale || 0} + joma=${joma || 0} - withdrawal=${withdrawal || 0} = ${drawer}`,
      });
    }
  }

  return violations;
}
