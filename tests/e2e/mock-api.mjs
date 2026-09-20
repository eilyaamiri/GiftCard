import { createServer } from "node:http";

const now = "2026-09-18T12:00:00.000Z";
const later = "2026-09-18T12:15:00.000Z";

const categories = [
  { id: "category-gaming", slug: "gaming", name: "Gaming", nameFa: "بازی و گیم", iconKey: "gamepad-2", descriptionFa: null, parentId: null, sortOrder: 1, productCount: 1 },
  { id: "category-shopping", slug: "shopping", name: "Shopping", nameFa: "فروشگاهی و خرید", iconKey: "shopping-bag", descriptionFa: null, parentId: null, sortOrder: 2, productCount: 1 },
  { id: "category-entertainment", slug: "entertainment", name: "Entertainment", nameFa: "سرگرمی و استریم", iconKey: "clapperboard", descriptionFa: null, parentId: null, sortOrder: 3, productCount: 1 },
];

const brands = [
  { id: "brand-steam", slug: "steam", name: "Steam", nameFa: "استیم", logoUrl: null, descriptionFa: null, isPopular: true, sortOrder: 1, productCount: 1 },
  { id: "brand-apple", slug: "apple", name: "Apple", nameFa: "اپل", logoUrl: null, descriptionFa: null, isPopular: true, sortOrder: 2, productCount: 1 },
  { id: "brand-spotify", slug: "spotify", name: "Spotify", nameFa: "اسپاتیفای", logoUrl: null, descriptionFa: null, isPopular: false, sortOrder: 3, productCount: 1 },
];

const products = [
  {
    id: "product-steam", slug: "steam-wallet", brand: "Steam", title: "Steam Wallet", titleFa: "گیفت‌کارت استیم", description: null,
    descriptionFa: "اعتبار استیم برای خرید بازی و محتوای دیجیتال.", category: "Gaming", imageUrl: null, isActive: true,
    sortOrder: 1, regions: ["US", "UK"], createdAt: now,
    brandSlug: "steam", brandNameFa: "استیم", categorySlug: "gaming", categoryNameFa: "بازی و گیم", categoryIconKey: "gamepad-2",
    needsReview: false, isQuickPick: true,
  },
  {
    id: "product-apple", slug: "apple-us", brand: "Apple", title: "Apple Gift Card", titleFa: "گیفت‌کارت اپل", description: null,
    descriptionFa: "برای خرید از فروشگاه اپل آمریکا.", category: "Shopping", imageUrl: null, isActive: true,
    sortOrder: 2, regions: ["US"], createdAt: now,
    brandSlug: "apple", brandNameFa: "اپل", categorySlug: "shopping", categoryNameFa: "فروشگاهی و خرید", categoryIconKey: "shopping-bag",
    needsReview: false, isQuickPick: false,
  },
  /* Incomplete data: listed (§1 "هیچ محصول موجودی را بدون گزارش حذف نکن") but
   * with no priced region, so the catalog and the detail page both refuse a
   * buy button for it instead of hiding the product. */
  {
    id: "product-spotify", slug: "spotify-premium", brand: "Spotify", title: "Spotify Gift Card", titleFa: "گیفت‌کارت اسپاتیفای", description: null,
    descriptionFa: null, category: "Entertainment", imageUrl: null, isActive: true,
    sortOrder: 3, regions: [], createdAt: now,
    brandSlug: "spotify", brandNameFa: "اسپاتیفای", categorySlug: "entertainment", categoryNameFa: "سرگرمی و استریم", categoryIconKey: "clapperboard",
    needsReview: true, isQuickPick: false,
  },
];

const steam = {
  ...products[0],
  redemptionNotesFa: "کد را فقط در حساب استیم با منطقهٔ همسان استفاده کنید.",
  skus: [
    { id: "sku-steam-us-20", productId: "product-steam", code: "STEAM-US-20", region: "US", currency: "USD", faceValue: "20", denominationLabel: "$20", deliveryAssetType: "CODE", isActive: true, minQuantity: 1, maxQuantity: 5, indicativePriceIrr: "20000000", indicativePriceToman: "2000000", isAvailable: true },
    { id: "sku-steam-us-50", productId: "product-steam", code: "STEAM-US-50", region: "US", currency: "USD", faceValue: "50", denominationLabel: "$50", deliveryAssetType: "CODE", isActive: true, minQuantity: 1, maxQuantity: 5, indicativePriceIrr: "50000000", indicativePriceToman: "5000000", isAvailable: true },
    { id: "sku-steam-uk-20", productId: "product-steam", code: "STEAM-UK-20", region: "UK", currency: "GBP", faceValue: "20", denominationLabel: "£20", deliveryAssetType: "CODE", isActive: true, minQuantity: 1, maxQuantity: 5, indicativePriceIrr: "25000000", indicativePriceToman: "2500000", isAvailable: true },
  ],
};

const services = [{
  id: "service-hosting", slug: "hosting-payment", name: "Hosting payment", nameFa: "پرداخت سرویس میزبانی", category: "Hosting", currency: "USD", minAmount: "5", maxAmount: "500", isActive: true, requiresManualReview: false,
  fields: [{ id: "field-invoice", key: "invoiceNumber", label: "Invoice number", labelFa: "شماره فاکتور", fieldType: "TEXT", isRequired: true, validationRegex: null, helpTextFa: "شمارهٔ فاکتور را از صفحهٔ پرداخت کپی کنید.", options: null, sortOrder: 0 }],
}];

function quoteFor(body = {}) {
  const service = Boolean(body.serviceId);
  const quote = {
    id: "quote-e2e-001", quoteNumber: "Q-E2E-001", customerId: null, commerceSessionId: "commerce-e2e", cartId: null,
    skuId: service ? null : "sku-steam-us-20", serviceId: service ? "service-hosting" : null, supplierOfferId: null, quantity: 1, currency: service ? "USD" : "USD",
    pricingRuleId: "rule-e2e", pricingVersion: 1,
    rule: { id: "rule-e2e", name: "E2E pricing", version: 1, fxSpreadBps: 100, fxRiskBufferBps: 50, serviceFeeBps: 100, serviceFeeFixedIrr: "100000", operationalFeeIrr: "100000", targetMarginBps: 300, minimumMarginIrr: "100000", paymentFeeBps: 100, paymentFeeFixedIrr: "100000", quoteTtlSeconds: 900, roundingStepIrr: "10000", maxSupplierCostToleranceBps: 500 },
    marketFxRate: "1000000", effectiveFxRate: "1015000", fxProvider: "e2e-fixture", fxRateId: "fx-e2e", fxRateTimestamp: now, fxSpreadAmount: "200000", fxRiskBufferAmount: "100000",
    supplierCostUsd: service ? "25" : "20", supplierCostIrr: service ? "25000000" : "20000000", paymentFee: "300000", serviceFee: "300000", operationalFee: "100000", marginAmount: "800000", discountAmount: "0", subtotal: service ? "26500000" : "21500000", finalAmountIrr: service ? "26500000" : "21500000", displayAmountToman: service ? "2650000" : "2150000",
    status: "ACTIVE", expiresAt: later, remainingSeconds: 900, acceptedAt: null, cancelledAt: null, createdAt: now,
    components: [{ kind: "SUPPLIER_COST", label: "Supplier cost", labelFa: "ارزش کالا", amountIrr: service ? "25000000" : "20000000", amountForeign: service ? "25" : "20", currency: "USD", bps: null, sortOrder: 0 }],
  };
  return {
    quote,
    breakdown: { pricingVersion: 1, ruleId: "rule-e2e", marketFxRate: "1000000", effectiveFxRate: "1015000", fxProvider: "e2e-fixture", fxRateTimestamp: now, fxSpreadAmount: "200000", fxRiskBufferAmount: "100000", supplierCostForeign: service ? "25" : "20", supplierCostCurrency: "USD", supplierCostIrr: service ? "25000000" : "20000000", paymentFee: "300000", serviceFee: "300000", operationalFee: "100000", marginAmount: "800000", marginFloorApplied: false, discountAmount: "0", subtotal: service ? "26500000" : "21500000", roundingAdjustment: "0", finalAmountIrr: service ? "26500000" : "21500000", displayAmountToman: service ? "2650000" : "2150000", contributionIrr: "800000", effectiveMarginBps: 300, components: quote.components },
    fx: { id: "fx-e2e", pair: "USD_IRR", buyRate: "1000000", sellRate: "1000000", midRate: "1000000", provider: "e2e-fixture", source: "MANUAL", receivedAt: now, effectiveAt: now, expiresAt: later, isManualOverride: true, overrideReason: "E2E fixture", ageSeconds: 0, isStale: false },
  };
}

/* ============================================================================
 * Session and orders
 *
 * Signed-in pages are reached by setting the `barat_session` cookie the web app
 * forwards. Tests that do not set it keep seeing the signed-out storefront, so
 * the public specs are unaffected.
 * ==========================================================================*/

const customer = {
  id: "customer-e2e", customerCode: "BP-C-0001", status: "ACTIVE", firstName: "آزمون", lastName: "کاربر",
  maskedMobile: "0912***4567", maskedEmail: null, isMobileVerified: true, isEmailVerified: false, createdAt: now,
};

function signedIn(request) {
  return (request.headers.cookie ?? "").includes("barat_session=");
}

/**
 * The orders behind the pro-forma invoice, held in memory so a cancel is
 * visible on the next read — exactly what the page does after
 * `router.refresh()`. There are two so that the spec which cancels one cannot
 * decide what the spec which only looks at one sees.
 *
 * `createdAt` is stamped at server start rather than fixed, because the payment
 * countdown is measured from it: a hard-coded date would render an order that
 * expired years ago.
 */
function orderFixture(orderNumber) {
  return {
    id: `order-${orderNumber}`, orderNumber, customerId: customer.id, quoteId: "quote-e2e-001", cartId: null,
    status: "AWAITING_PAYMENT", totalAmountIrr: "21500000", displayAmountToman: "2150000", currency: "IRR",
    itemTitleFa: "گیفت‌کارت استیم — $20", createdAt: new Date().toISOString(),
    paidAt: null, fulfilledAt: null, cancelledAt: null, failureReason: null, delivery: null, timeline: [],
  };
}

const orders = new Map(
  ["BP-2026-000001", "BP-2026-000002"].map((orderNumber) => [orderNumber, orderFixture(orderNumber)]),
);

/**
 * The published contact channels, already carrying the `href` the API builds.
 *
 * `TICKET` is here twice over: it is the only internal one, and the only one
 * that needs a session, so the sheet's two link behaviours are both covered.
 */
const supportChannels = [
  { kind: "PHONE", title: "تماس تلفنی", description: "شنبه تا چهارشنبه، ۹ تا ۱۷", href: "tel:02191001234", isExternal: false, requiresAuth: false },
  { kind: "TELEGRAM", title: "تلگرام", description: "پاسخ‌گویی تا ۲۴ ساعت", href: "https://t.me/baratpay", isExternal: true, requiresAuth: false },
  { kind: "WHATSAPP", title: "واتساپ", description: "گفت‌وگوی متنی و صوتی", href: "https://wa.me/989121234567", isExternal: true, requiresAuth: false },
  { kind: "TICKET", title: "ثبت تیکت", description: "پیگیری کتبی با شمارهٔ رهگیری", href: "/account/support", isExternal: false, requiresAuth: true },
];

/* Overridable so a second checkout can run the suite without colliding with a
 * fixture already listening on the default port. */
const PORT = Number(process.env["MOCK_API_PORT"] ?? 4001);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost:4001");
  if (url.pathname === "/health") return json(response, 200, { ok: true });
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return signedIn(request)
      ? json(response, 200, { customer, isAuthenticated: true })
      : json(response, 200, { customer: null, isAuthenticated: false });
  }
  if (request.method === "GET" && url.pathname === "/api/support/channels") return json(response, 200, { items: supportChannels });
  const orderRoute = /^\/api\/orders\/([^/]+)(\/cancel)?$/u.exec(url.pathname);
  if (orderRoute) {
    const order = orders.get(decodeURIComponent(orderRoute[1]));
    if (!signedIn(request)) return json(response, 401, { code: "UNAUTHORIZED", message: "Unauthorized" });
    if (!order) return json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    if (request.method === "GET" && !orderRoute[2]) return json(response, 200, { order });
    if (request.method === "POST" && orderRoute[2]) {
      /* The real API refuses a paid order; the fixture only ever holds an
       * unpaid one, so cancelling always succeeds and is idempotent on replay. */
      order.status = "CANCELLED";
      order.cancelledAt ??= new Date().toISOString();
      return json(response, 200, { order });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/catalog/categories") return json(response, 200, { items: categories });
  if (request.method === "GET" && url.pathname === "/api/catalog/brands") return json(response, 200, { items: brands });
  if (request.method === "GET" && url.pathname === "/api/catalog/products") {
    const categorySlug = url.searchParams.get("categorySlug");
    const brandSlug = url.searchParams.get("brandSlug");
    const region = url.searchParams.get("region");
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    /* Mirrors the real API: the region facet is computed off everything except
     * the region filter, so picking one region never hides the way back to
     * another. */
    const beforeRegion = products.filter((product) =>
      (!categorySlug || product.categorySlug === categorySlug) &&
      (!brandSlug || product.brandSlug === brandSlug) &&
      (!search || [product.titleFa, product.title, product.brand].some((value) => value.toLowerCase().includes(search))));
    const items = beforeRegion.filter((product) => !region || product.regions.includes(region));
    const regions = [...new Set(beforeRegion.flatMap((product) => product.regions))].sort();
    return json(response, 200, { items, regions, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } });
  }
  if (request.method === "GET" && url.pathname === "/api/catalog/products/steam-wallet") return json(response, 200, { product: steam });
  if (request.method === "GET" && url.pathname === "/api/catalog/products/apple-us") return json(response, 200, { product: { ...products[1], redemptionNotesFa: null, skus: [] } });
  if (request.method === "GET" && url.pathname === "/api/catalog/products/spotify-premium") return json(response, 200, { product: { ...products[2], redemptionNotesFa: null, skus: [] } });
  if (request.method === "GET" && url.pathname === "/api/catalog/services") return json(response, 200, { items: services, meta: { page: 1, pageSize: 20, total: services.length, totalPages: 1 } });
  if (request.method === "GET" && url.pathname === "/api/quotes/quote-e2e-001") return json(response, 200, { quote: quoteFor().quote });
  if (request.method === "POST" && url.pathname === "/api/quotes") {
    let text = "";
    for await (const chunk of request) text += chunk;
    return json(response, 201, quoteFor(JSON.parse(text || "{}")));
  }
  return json(response, 404, { code: "NOT_FOUND", message: "Not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`Mock E2E API listening on http://127.0.0.1:${PORT}`));
