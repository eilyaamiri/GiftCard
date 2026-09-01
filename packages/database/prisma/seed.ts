 
/**
 * ============================================================================
 * SEED — DETERMINISTIC DEMO DATA. Owned by workstream S6 / B10 (QA, E2E & seed).
 * ============================================================================
 *
 * Running `pnpm db:seed` against a freshly migrated database always produces
 * the same rows: fixed ids, fixed timestamps, fixed amounts, no `Math.random`,
 * no `Date.now()`, no `@faker-js/faker`. This is what lets the reporting / E2E
 * assertions in `tests/**` compare EXACT numbers instead of "roughly N".
 *
 * DEMO DATA ONLY. Every row here is fictional. No real gift-card codes, no
 * real customers, no real payments. The script refuses to run when
 * `NODE_ENV=production` (see `assertNotProduction` below).
 *
 * Money rules still apply to fixture generation: every rial amount is a
 * `bigint`, every foreign-currency amount is built from `bigint` "cents" and
 * formatted to a decimal STRING (never a JS `Number` division). See
 * `applyBpsIrr` / `centsToDecimalString` below.
 * ============================================================================
 */

import { createCipheriv, createHash } from 'node:crypto';

import * as argon2 from 'argon2';

import {
  ChecklistItemStatus,
  ChecklistStatus,
  CustomerStatus,
  DeliveryAssetType,
  DeliveryChannel,
  DeliveryStatus,
  FeatureFlagKey,
  FulfillmentMethod,
  FulfillmentStatus,
  FxPair,
  IdentityType,
  OrderStatus,
  PaymentFailureReason,
  PaymentStatus,
  PricingRuleScope,
  QueueKey,
  QuoteStatus,
  ReconciliationIssueType,
  ReconciliationStatus,
  StaffRole,
  SupplierIntegrationMode,
  WorkItemStatus,
  WorkItemType,
} from '../generated/client';
import type { PrismaClient } from '../generated/client';

// Delayed until after the production guard so `NODE_ENV=production` refuses
// without even opening a database connection.
let prisma: PrismaClient;
let disconnectPrisma: () => Promise<void>;

// ============================================================================
// 0. Guardrails & determinism primitives
// ============================================================================

function assertNotProduction(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      '[seed] refusing to run: NODE_ENV=production. This script writes fictional demo data ' +
        'and must never touch a production database.',
    );
  }
}

/** Fixed "now" for every timestamp in the fixture. Never `new Date()`. */
const SEED_EPOCH = new Date('2026-01-01T00:00:00.000Z');

function atOffset(seconds: number): Date {
  return new Date(SEED_EPOCH.getTime() + seconds * 1000);
}

function pad(n: number, width = 6): string {
  return String(n).padStart(width, '0');
}

/**
 * Deterministic index cycling. The fixture never needs actual randomness — a
 * varied-but-repeatable spread across the catalog and customer pool is enough,
 * and a plain modulo cycle is easier to audit than a seeded PRNG.
 */
function pick<T>(arr: readonly T[], index: number): T {
  const item = arr[index % arr.length];
  if (item === undefined) {
    throw new Error('[seed] pick() out of range');
  }
  return item;
}

// ============================================================================
// 1. Money helpers — bigint only, never a float (AGENTS.md rule 2)
// ============================================================================

/** `applyBps(1_000_000n, 250)` -> 25_000n. Half-up rounding on the /10000 division. */
function applyBpsIrr(amountIrr: bigint, bps: number): bigint {
  const numerator = amountIrr * BigInt(bps) + 5_000n;
  return numerator / 10_000n;
}

function roundUpToStep(amountIrr: bigint, stepIrr: bigint): bigint {
  const remainder = amountIrr % stepIrr;
  return remainder === 0n ? amountIrr : amountIrr + (stepIrr - remainder);
}

/** USD amount expressed as integer cents -> a `Decimal(18,6)`-safe string. */
function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const wholeUnits = abs / 100n;
  const fractionCents = abs % 100n;
  const sign = negative ? '-' : '';
  return `${sign}${wholeUnits.toString()}.${fractionCents.toString().padStart(2, '0')}0000`;
}

/** USD cents x IRR-per-USD integer rate -> IRR bigint. Pure bigint math, floor division. */
function centsToIrr(cents: bigint, irrPerUsd: bigint): bigint {
  return (cents * irrPerUsd) / 100n;
}

// ============================================================================
// 2. A self-contained AES-256-GCM envelope, matching the application's format
//    (`v1.<iv>.<tag>.<ciphertext>`, all base64) WITHOUT importing app code —
//    packages/database must never depend on apps/api (golden dependency rule).
//    Used only to populate demo GiftCardAsset ciphertext; never a plaintext
//    column, never logged (AGENTS.md rule 10).
// ============================================================================

function demoEncryptionKey(): Buffer {
  const configured = process.env['GIFT_CARD_ENCRYPTION_KEY'];
  if (configured) {
    const decoded = Buffer.from(configured, 'base64');
    if (decoded.length === 32) return decoded;
  }
  // Deterministic 32-byte fallback for local/dev/test seeding only.
  return Buffer.alloc(32, 7);
}

function encryptDemoSecret(plaintext: string): string {
  const key = demoEncryptionKey();
  // Stable IVs are safe here because this is deterministic DEMO DATA and each
  // plaintext is unique per asset. Production encryption always uses a fresh
  // random IV in apps/api's crypto helper.
  const iv = createHash('sha256')
    .update(`seed-asset:${plaintext}`, 'utf8')
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from('barat-pay:gift-card-secret:v1', 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

function maskCode(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `XXXX-XXXX-${tail}`;
}

// ============================================================================
// 3. Reference data
// ============================================================================

async function seedFeatureFlags(): Promise<void> {
  const flags: Array<{
    key: FeatureFlagKey;
    isEnabled: boolean;
    rolloutBps: number;
    description: string;
  }> = [
    {
      key: FeatureFlagKey.gift_cards_enabled,
      isEnabled: true,
      rolloutBps: 10_000,
      description: 'Gift-card catalog & checkout',
    },
    {
      key: FeatureFlagKey.international_payments_enabled,
      isEnabled: true,
      rolloutBps: 10_000,
      description: 'International SaaS/AI/cloud/exam payments',
    },
    {
      key: FeatureFlagKey.manual_fulfillment_enabled,
      isEnabled: true,
      rolloutBps: 10_000,
      description: 'Operator manual fulfillment queues',
    },
    {
      key: FeatureFlagKey.supplier_api_enabled,
      isEnabled: false,
      rolloutBps: 0,
      description: 'Automatic supplier API purchase (Reloadly)',
    },
    {
      key: FeatureFlagKey.fx_auto_rate_enabled,
      isEnabled: false,
      rolloutBps: 0,
      description: 'Automatic FX aggregation from live providers',
    },
    {
      key: FeatureFlagKey.payment_gateway_enabled,
      isEnabled: true,
      rolloutBps: 10_000,
      description: 'Rial payment gateway (mock/ZarinPal)',
    },
    {
      key: FeatureFlagKey.zarinpal_enabled,
      isEnabled: false,
      rolloutBps: 0,
      description: 'Live ZarinPal gateway (disabled in the POC)',
    },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: { id: `seed_flag_${flag.key}`, ...flag },
      update: {
        isEnabled: flag.isEnabled,
        rolloutBps: flag.rolloutBps,
        description: flag.description,
      },
    });
  }
}

const QUEUE_DEFS: Array<{ key: QueueKey; name: string; description: string; slaMinutes: number }> =
  [
    {
      key: QueueKey.GIFT_CARD_MANUAL,
      name: 'Gift card fulfillment',
      description: 'Manual gift-card purchase & delivery',
      slaMinutes: 30,
    },
    {
      key: QueueKey.SAAS_PAYMENT,
      name: 'SaaS payments',
      description: 'International SaaS subscription payments',
      slaMinutes: 60,
    },
    {
      key: QueueKey.AI_TOOLS,
      name: 'AI tools payments',
      description: 'AI tool subscriptions (OpenAI, Anthropic, etc.)',
      slaMinutes: 60,
    },
    {
      key: QueueKey.DOMAIN_HOSTING,
      name: 'Domain & hosting',
      description: 'Domain registration and hosting invoices',
      slaMinutes: 120,
    },
    {
      key: QueueKey.EXAM_PAYMENT,
      name: 'Exam fees',
      description: 'International exam / certification fee payments',
      slaMinutes: 180,
    },
    {
      key: QueueKey.SUPPLIER_ISSUE,
      name: 'Supplier follow-up',
      description: 'Escalations to a supplier',
      slaMinutes: 240,
    },
    {
      key: QueueKey.CUSTOMER_INFO_REQUIRED,
      name: 'Customer info required',
      description: 'Blocked pending information from the customer',
      slaMinutes: 240,
    },
    {
      key: QueueKey.UNKNOWN_OUTCOME,
      name: 'Unknown outcome',
      description: 'Ambiguous supplier / payment outcomes needing review',
      slaMinutes: 60,
    },
    {
      key: QueueKey.REFUND_REVIEW,
      name: 'Refund review',
      description: 'Refund requests awaiting approval',
      slaMinutes: 120,
    },
  ];

async function seedQueues(): Promise<Record<QueueKey, string>> {
  const ids: Partial<Record<QueueKey, string>> = {};
  for (const [i, q] of QUEUE_DEFS.entries()) {
    const id = `seed_queue_${pad(i + 1, 2)}`;
    await prisma.queue.upsert({
      where: { key: q.key },
      create: {
        id,
        key: q.key,
        name: q.name,
        description: q.description,
        slaMinutes: q.slaMinutes,
      },
      update: { name: q.name, description: q.description, slaMinutes: q.slaMinutes },
    });
    ids[q.key] = id;
  }
  return ids as Record<QueueKey, string>;
}

const STAFF_DEFS: Array<{ role: StaffRole; email: string; fullName: string }> = [
  { role: StaffRole.ADMIN, email: 'admin@barat.demo', fullName: 'Admin Demo' },
  { role: StaffRole.MANAGEMENT, email: 'management@barat.demo', fullName: 'Management Demo' },
  { role: StaffRole.OPS_MANAGER, email: 'ops-manager@barat.demo', fullName: 'Ops Manager Demo' },
  { role: StaffRole.OPERATOR, email: 'operator1@barat.demo', fullName: 'Operator One' },
  { role: StaffRole.OPERATOR, email: 'operator2@barat.demo', fullName: 'Operator Two' },
  { role: StaffRole.FINANCE, email: 'finance@barat.demo', fullName: 'Finance Demo' },
  { role: StaffRole.SUPPORT, email: 'support@barat.demo', fullName: 'Support Demo' },
  { role: StaffRole.VIEWER, email: 'viewer@barat.demo', fullName: 'Viewer Demo' },
];

/** All staff share this password in the seed. NEVER used outside local/dev/test. */
const DEMO_STAFF_PASSWORD = 'Seed-Passw0rd!Demo';

async function seedStaff(): Promise<{ operatorIds: string[]; managerId: string; adminId: string }> {
  // A fixed salt keeps the DEMO DATA byte-identical between clean database
  // rebuilds. This password is local/dev-only and is never a production secret.
  const passwordHash = await argon2.hash(DEMO_STAFF_PASSWORD, {
    type: argon2.argon2id,
    salt: Buffer.alloc(16, 42),
  });
  const operatorIds: string[] = [];
  let managerId = '';
  let adminId = '';

  for (const [i, s] of STAFF_DEFS.entries()) {
    const id = `seed_staff_${pad(i + 1, 2)}`;
    await prisma.staffUser.upsert({
      where: { email: s.email },
      create: {
        id,
        email: s.email,
        passwordHash,
        fullName: s.fullName,
        role: s.role,
        isActive: true,
      },
      update: { fullName: s.fullName, role: s.role, isActive: true },
    });
    if (s.role === StaffRole.OPERATOR) operatorIds.push(id);
    if (s.role === StaffRole.OPS_MANAGER) managerId = id;
    if (s.role === StaffRole.ADMIN) adminId = id;
  }

  return { operatorIds, managerId, adminId };
}

/**
 * Puts the operators and the ops manager into every queue.
 *
 * `WorkItemsService.claim` refuses an OPERATOR who is not a member of the
 * item's queue — correct, but with no memberships seeded it meant a plain
 * operator was refused on every claim, which reads as a broken permission
 * system rather than as missing data. Higher roles skip the check, so this
 * gap was invisible to anyone testing as an admin.
 *
 * The ops manager gets `canAssign`; operators do not, because handing work to
 * somebody else is a supervisory act.
 */
async function seedQueueMemberships(
  queueIds: Record<QueueKey, string>,
  operatorIds: string[],
  managerId: string,
): Promise<void> {
  const members = [
    ...operatorIds.map((staffUserId) => ({ staffUserId, canAssign: false })),
    { staffUserId: managerId, canAssign: true },
  ];

  for (const queueId of Object.values(queueIds)) {
    for (const member of members) {
      await prisma.queueMembership.upsert({
        where: {
          queueId_staffUserId: { queueId, staffUserId: member.staffUserId },
        },
        create: { queueId, staffUserId: member.staffUserId, canAssign: member.canAssign },
        update: { canAssign: member.canAssign },
      });
    }
  }
}

async function seedChecklistTemplates(): Promise<void> {
  // Mirrors apps/api/src/modules/fulfillment/checklist-templates.ts. Duplicated
  // as literal seed data (not imported) because packages/database must never
  // depend on apps/api — the golden dependency direction in AGENTS.md section 2.
  const SYSTEM_VERIFIED = {
    PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
    ACTUAL_COST_PRESENT: 'ACTUAL_COST_PRESENT',
    PROVIDER_REFERENCE_PRESENT: 'PROVIDER_REFERENCE_PRESENT',
    GIFT_CARD_ASSET_PRESENT: 'GIFT_CARD_ASSET_PRESENT',
  } as const;

  const giftCardManual = [
    {
      key: SYSTEM_VERIFIED.PAYMENT_VERIFIED,
      label: 'Customer payment verified',
      labelFa: 'پرداخت مشتری تأیید شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 10,
    },
    {
      key: 'DELIVERY_EMAIL_PRESENT',
      label: 'Delivery e-mail recorded',
      labelFa: 'ایمیل تحویل ثبت شده است',
      type: 'REQUIRED_FIELD',
      isBlocking: true,
      sortOrder: 20,
    },
    {
      key: 'SUPPLIER_ORDER_PLACED',
      label: 'Order placed with the supplier',
      labelFa: 'سفارش نزد تأمین‌کننده ثبت شد',
      type: 'BOOLEAN',
      isBlocking: true,
      sortOrder: 30,
    },
    {
      key: SYSTEM_VERIFIED.PROVIDER_REFERENCE_PRESENT,
      label: 'Supplier reference recorded',
      labelFa: 'کد پیگیری تأمین‌کننده ثبت شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 40,
    },
    {
      key: SYSTEM_VERIFIED.ACTUAL_COST_PRESENT,
      label: 'Actual supplier cost recorded',
      labelFa: 'هزینهٔ واقعی تأمین‌کننده ثبت شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 50,
    },
    {
      key: SYSTEM_VERIFIED.GIFT_CARD_ASSET_PRESENT,
      label: 'Delivery asset stored',
      labelFa: 'دارایی تحویل ذخیره شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 60,
    },
    {
      key: 'ASSET_MATCHES_ORDER',
      label: 'Asset value and region match the order',
      labelFa: 'مبلغ و منطقهٔ کارت با سفارش مطابقت دارد',
      type: 'BOOLEAN',
      isBlocking: true,
      sortOrder: 70,
    },
  ];

  const internationalPayment = [
    {
      key: SYSTEM_VERIFIED.PAYMENT_VERIFIED,
      label: 'Customer payment verified',
      labelFa: 'پرداخت مشتری تأیید شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 10,
    },
    {
      key: 'DELIVERY_EMAIL_PRESENT',
      label: 'Delivery e-mail recorded',
      labelFa: 'ایمیل تحویل ثبت شده است',
      type: 'REQUIRED_FIELD',
      isBlocking: true,
      sortOrder: 20,
    },
    {
      key: 'SERVICE_ACCOUNT_REFERENCE',
      label: 'Customer service account / invoice reference recorded',
      labelFa: 'شناسهٔ حساب یا شمارهٔ صورتحساب مشتری ثبت شده است',
      type: 'REQUIRED_FIELD',
      isBlocking: true,
      sortOrder: 30,
    },
    {
      key: 'PAYMENT_EXECUTED_ABROAD',
      label: 'Payment executed on the foreign provider',
      labelFa: 'پرداخت روی سرویس خارجی انجام شد',
      type: 'BOOLEAN',
      isBlocking: true,
      sortOrder: 40,
    },
    {
      key: SYSTEM_VERIFIED.PROVIDER_REFERENCE_PRESENT,
      label: 'Provider reference recorded',
      labelFa: 'کد پیگیری سرویس‌دهنده ثبت شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 50,
    },
    {
      key: SYSTEM_VERIFIED.ACTUAL_COST_PRESENT,
      label: 'Actual cost recorded',
      labelFa: 'هزینهٔ واقعی ثبت شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 60,
    },
    {
      key: SYSTEM_VERIFIED.GIFT_CARD_ASSET_PRESENT,
      label: 'Receipt / confirmation asset stored',
      labelFa: 'رسید یا تأییدیهٔ تحویل ذخیره شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 70,
    },
    {
      key: 'SUBSCRIPTION_ACTIVE_CONFIRMED',
      label: 'Subscription / service confirmed active',
      labelFa: 'فعال بودن سرویس بررسی و تأیید شد',
      type: 'BOOLEAN',
      isBlocking: true,
      sortOrder: 80,
    },
  ];

  const generic = [
    {
      key: SYSTEM_VERIFIED.PAYMENT_VERIFIED,
      label: 'Customer payment verified',
      labelFa: 'پرداخت مشتری تأیید شده است',
      type: 'SYSTEM_VERIFIED',
      isBlocking: true,
      sortOrder: 10,
    },
    {
      key: 'ISSUE_RESOLVED',
      label: 'Issue resolved and documented',
      labelFa: 'موضوع بررسی و مستند شد',
      type: 'BOOLEAN',
      isBlocking: true,
      sortOrder: 20,
    },
  ];

  const templates: Array<{ workItemType: WorkItemType; queueKey: QueueKey; definition: unknown }> =
    [
      {
        workItemType: WorkItemType.MANUAL_GIFT_CARD_FULFILLMENT,
        queueKey: QueueKey.GIFT_CARD_MANUAL,
        definition: giftCardManual,
      },
      {
        workItemType: WorkItemType.INTERNATIONAL_PAYMENT,
        queueKey: QueueKey.SAAS_PAYMENT,
        definition: internationalPayment,
      },
      {
        workItemType: WorkItemType.CUSTOMER_INFORMATION,
        queueKey: QueueKey.CUSTOMER_INFO_REQUIRED,
        definition: generic,
      },
      {
        workItemType: WorkItemType.SUPPLIER_FOLLOWUP,
        queueKey: QueueKey.SUPPLIER_ISSUE,
        definition: generic,
      },
      {
        workItemType: WorkItemType.UNKNOWN_OUTCOME,
        queueKey: QueueKey.UNKNOWN_OUTCOME,
        definition: generic,
      },
      {
        workItemType: WorkItemType.REFUND_REVIEW,
        queueKey: QueueKey.REFUND_REVIEW,
        definition: generic,
      },
      {
        workItemType: WorkItemType.SUPPORT_REQUEST,
        queueKey: QueueKey.CUSTOMER_INFO_REQUIRED,
        definition: generic,
      },
    ];

  for (const [i, t] of templates.entries()) {
    await prisma.taskChecklistTemplate.upsert({
      where: {
        workItemType_queueKey_version: {
          workItemType: t.workItemType,
          queueKey: t.queueKey,
          version: 1,
        },
      },
      create: {
        id: `seed_checklist_tpl_${pad(i + 1, 2)}`,
        workItemType: t.workItemType,
        queueKey: t.queueKey,
        name: `${t.workItemType} v1`,
        version: 1,
        isActive: true,
        definition: t.definition as never,
      },
      update: { definition: t.definition as never, isActive: true },
    });
  }
}

async function seedPricingRule(adminId: string): Promise<string> {
  const id = 'seed_pricing_rule_global_v1';
  // The @@unique is [scope, targetId, version] and targetId is null for a GLOBAL
  // rule. Postgres treats NULL as distinct from every other NULL, so Prisma
  // refuses null inside a compound-unique lookup. The seed id is deterministic,
  // so upserting by id gives the same idempotency without the illegal where.
  await prisma.pricingRule.upsert({
    where: { id },
    create: {
      id,
      name: 'Global default pricing rule',
      scope: PricingRuleScope.GLOBAL,
      targetId: null,
      version: 1,
      fxSpreadBps: 150,
      fxRiskBufferBps: 100,
      serviceFeeBps: 200,
      serviceFeeFixedIrr: 0n,
      operationalFeeIrr: 0n,
      targetMarginBps: 300,
      minimumMarginIrr: 0n,
      paymentFeeBps: 100,
      paymentFeeFixedIrr: 0n,
      quoteTtlSeconds: 600,
      roundingStepIrr: 10_000n,
      maxSupplierCostToleranceBps: 500,
      isActive: true,
      effectiveFrom: SEED_EPOCH,
      createdByStaffId: adminId,
    },
    update: {},
  });
  return id;
}

const FX_MID_IRR_PER_USD = 1_920_000n;

async function seedFxRate(adminId: string): Promise<string> {
  const id = 'seed_fxrate_usd_irr_001';
  const spread = 5_000n; // ~0.26% buy/sell spread around the mid rate, demo only.
  await prisma.fxRate.upsert({
    where: { id },
    create: {
      id,
      pair: FxPair.USD_IRR,
      buyRate: (FX_MID_IRR_PER_USD - spread).toString(),
      sellRate: (FX_MID_IRR_PER_USD + spread).toString(),
      midRate: FX_MID_IRR_PER_USD.toString(),
      source: 'API',
      provider: 'seed',
      isManualOverride: false,
      createdByStaffId: adminId,
      receivedAt: SEED_EPOCH,
      effectiveAt: SEED_EPOCH,
    },
    update: {},
  });
  return id;
}

// ============================================================================
// 4. Catalog — 20 gift-card SKUs + 6 international services
// ============================================================================

interface SkuDef {
  productSlug: string;
  brand: string;
  title: string;
  titleFa: string;
  category: string;
  region: string;
  currency: string;
  faceValueCents: bigint;
  denominationLabel: string;
  assetType: DeliveryAssetType;
}

const SKU_DEFS: SkuDef[] = [
  {
    productSlug: 'apple-gift-card',
    brand: 'Apple',
    title: 'Apple Gift Card',
    titleFa: 'گیفت کارت اپل',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 2500n,
    denominationLabel: '$25',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'apple-gift-card',
    brand: 'Apple',
    title: 'Apple Gift Card',
    titleFa: 'گیفت کارت اپل',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'apple-gift-card',
    brand: 'Apple',
    title: 'Apple Gift Card',
    titleFa: 'گیفت کارت اپل',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 10_000n,
    denominationLabel: '$100',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'apple-gift-card-uk',
    brand: 'Apple',
    title: 'Apple Gift Card (UK)',
    titleFa: 'گیفت کارت اپل (انگلستان)',
    category: 'gift-card',
    region: 'UK',
    currency: 'GBP',
    faceValueCents: 2500n,
    denominationLabel: '£25',
    assetType: DeliveryAssetType.CODE,
  },

  {
    productSlug: 'google-play-gift-card',
    brand: 'Google Play',
    title: 'Google Play Gift Card',
    titleFa: 'گیفت کارت گوگل پلی',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 1000n,
    denominationLabel: '$10',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'google-play-gift-card',
    brand: 'Google Play',
    title: 'Google Play Gift Card',
    titleFa: 'گیفت کارت گوگل پلی',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 2500n,
    denominationLabel: '$25',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'google-play-gift-card',
    brand: 'Google Play',
    title: 'Google Play Gift Card',
    titleFa: 'گیفت کارت گوگل پلی',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.CODE,
  },

  {
    productSlug: 'playstation-store-gift-card',
    brand: 'PlayStation',
    title: 'PlayStation Store Gift Card',
    titleFa: 'گیفت کارت پلی استیشن',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 2500n,
    denominationLabel: '$25',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'playstation-store-gift-card',
    brand: 'PlayStation',
    title: 'PlayStation Store Gift Card',
    titleFa: 'گیفت کارت پلی استیشن',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'playstation-store-gift-card-uk',
    brand: 'PlayStation',
    title: 'PlayStation Store Gift Card (UK)',
    titleFa: 'گیفت کارت پلی استیشن (انگلستان)',
    category: 'gift-card',
    region: 'UK',
    currency: 'GBP',
    faceValueCents: 2000n,
    denominationLabel: '£20',
    assetType: DeliveryAssetType.CODE_PIN,
  },

  {
    productSlug: 'steam-wallet-code',
    brand: 'Steam',
    title: 'Steam Wallet Code',
    titleFa: 'کد کیف پول استیم',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 2000n,
    denominationLabel: '$20',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'steam-wallet-code',
    brand: 'Steam',
    title: 'Steam Wallet Code',
    titleFa: 'کد کیف پول استیم',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'steam-wallet-code',
    brand: 'Steam',
    title: 'Steam Wallet Code',
    titleFa: 'کد کیف پول استیم',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 10_000n,
    denominationLabel: '$100',
    assetType: DeliveryAssetType.CODE,
  },

  {
    productSlug: 'netflix-gift-card',
    brand: 'Netflix',
    title: 'Netflix Gift Card',
    titleFa: 'گیفت کارت نتفلیکس',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 2500n,
    denominationLabel: '$25',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'netflix-gift-card',
    brand: 'Netflix',
    title: 'Netflix Gift Card',
    titleFa: 'گیفت کارت نتفلیکس',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.CODE,
  },

  {
    productSlug: 'xbox-gift-card',
    brand: 'Xbox',
    title: 'Xbox Gift Card',
    titleFa: 'گیفت کارت ایکس‌باکس',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 1000n,
    denominationLabel: '$10',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'xbox-gift-card',
    brand: 'Xbox',
    title: 'Xbox Gift Card',
    titleFa: 'گیفت کارت ایکس‌باکس',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 2500n,
    denominationLabel: '$25',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'xbox-gift-card',
    brand: 'Xbox',
    title: 'Xbox Gift Card',
    titleFa: 'گیفت کارت ایکس‌باکس',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.PROVIDER_DIRECT_EMAIL,
  },

  {
    productSlug: 'amazon-gift-card',
    brand: 'Amazon',
    title: 'Amazon Gift Card',
    titleFa: 'گیفت کارت آمازون',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 5000n,
    denominationLabel: '$50',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'amazon-gift-card',
    brand: 'Amazon',
    title: 'Amazon Gift Card',
    titleFa: 'گیفت کارت آمازون',
    category: 'gift-card',
    region: 'US',
    currency: 'USD',
    faceValueCents: 20_000n,
    denominationLabel: '$200',
    assetType: DeliveryAssetType.CODE,
  },
  {
    productSlug: 'amazon-gift-card-eu',
    brand: 'Amazon',
    title: 'Amazon Gift Card (EU)',
    titleFa: 'گیفت کارت آمازون (اروپا)',
    category: 'gift-card',
    region: 'EU',
    currency: 'EUR',
    faceValueCents: 5000n,
    denominationLabel: '€50',
    assetType: DeliveryAssetType.CODE,
  },
];

const SERVICE_DEFS = [
  {
    slug: 'saas-subscriptions',
    name: 'SaaS Subscriptions',
    nameFa: 'اشتراک نرم‌افزارهای SaaS',
    category: 'saas',
  },
  { slug: 'ai-tools', name: 'AI Tools', nameFa: 'ابزارهای هوش مصنوعی', category: 'ai-tools' },
  { slug: 'cloud-hosting', name: 'Cloud Hosting', nameFa: 'میزبانی ابری', category: 'cloud' },
  {
    slug: 'domain-hosting',
    name: 'Domain & Hosting',
    nameFa: 'دامنه و هاستینگ',
    category: 'domain-hosting',
  },
  {
    slug: 'online-courses',
    name: 'Online Courses',
    nameFa: 'دوره‌های آموزشی آنلاین',
    category: 'courses',
  },
  {
    slug: 'exam-fees',
    name: 'Exam Fees',
    nameFa: 'هزینه‌های آزمون بین‌المللی',
    category: 'exam-fees',
  },
];

async function seedCatalog(): Promise<{ skuIds: string[]; skuDefs: (SkuDef & { id: string })[] }> {
  // Products, keyed by slug so repeated SKU_DEFS entries share one Product row.
  const productIdBySlug = new Map<string, string>();
  const productMeta = new Map<
    string,
    { brand: string; title: string; titleFa: string; category: string }
  >();
  for (const def of SKU_DEFS) {
    if (!productMeta.has(def.productSlug)) {
      productMeta.set(def.productSlug, {
        brand: def.brand,
        title: def.title,
        titleFa: def.titleFa,
        category: def.category,
      });
    }
  }

  let productIndex = 0;
  for (const [slug, meta] of productMeta) {
    productIndex += 1;
    const id = `seed_product_${pad(productIndex, 2)}`;
    await prisma.product.upsert({
      where: { slug },
      create: {
        id,
        slug,
        brand: meta.brand,
        title: meta.title,
        titleFa: meta.titleFa,
        category: meta.category,
        sortOrder: productIndex,
      },
      update: {},
    });
    productIdBySlug.set(slug, id);
  }

  const skuIds: string[] = [];
  const skuDefsWithId: (SkuDef & { id: string })[] = [];
  for (const [i, def] of SKU_DEFS.entries()) {
    const productId = productIdBySlug.get(def.productSlug);
    if (!productId) throw new Error(`[seed] missing product for ${def.productSlug}`);
    const code =
      `${def.productSlug}-${def.region}-${def.denominationLabel.replace(/[^0-9]/g, '')}`.toUpperCase();
    const id = `seed_sku_${pad(i + 1, 2)}`;
    await prisma.sku.upsert({
      where: { code },
      create: {
        id,
        productId,
        code,
        region: def.region,
        currency: def.currency,
        faceValue: centsToDecimalString(def.faceValueCents),
        denominationLabel: def.denominationLabel,
        deliveryAssetType: def.assetType,
        minQuantity: 1,
        maxQuantity: 10,
      },
      update: {},
    });
    skuIds.push(id);
    skuDefsWithId.push({ ...def, id });
  }

  for (const [i, svc] of SERVICE_DEFS.entries()) {
    const serviceId = `seed_service_${pad(i + 1, 2)}`;
    await prisma.internationalService.upsert({
      where: { slug: svc.slug },
      create: {
        id: serviceId,
        slug: svc.slug,
        name: svc.name,
        nameFa: svc.nameFa,
        category: svc.category,
        currency: 'USD',
        requiresManualReview: true,
        sortOrder: i + 1,
      },
      update: {},
    });

    await prisma.serviceFieldDefinition.upsert({
      where: { serviceId_key: { serviceId, key: 'accountEmail' } },
      create: {
        id: `seed_svcfield_${pad(i + 1, 2)}_1`,
        serviceId,
        key: 'accountEmail',
        label: 'Account e-mail',
        labelFa: 'ایمیل حساب کاربری',
        fieldType: 'EMAIL',
        isRequired: true,
        sortOrder: 10,
      },
      update: {},
    });
    await prisma.serviceFieldDefinition.upsert({
      where: { serviceId_key: { serviceId, key: 'invoiceReference' } },
      create: {
        id: `seed_svcfield_${pad(i + 1, 2)}_2`,
        serviceId,
        key: 'invoiceReference',
        label: 'Invoice / order reference',
        labelFa: 'شمارهٔ فاکتور / سفارش',
        fieldType: 'TEXT',
        isRequired: false,
        sortOrder: 20,
      },
      update: {},
    });
  }

  return { skuIds, skuDefs: skuDefsWithId };
}

// ============================================================================
// 5. Suppliers — Tillo (raw code) + Reloadly (no raw code)
// ============================================================================

async function seedSuppliers(
  skuDefs: (SkuDef & { id: string })[],
): Promise<{ tilloId: string; reloadlyId: string; tilloOfferBySkuId: Map<string, string> }> {
  const tilloId = 'seed_supplier_tillo';
  const reloadlyId = 'seed_supplier_reloadly';

  await prisma.supplier.upsert({
    where: { code: 'tillo' },
    create: {
      id: tilloId,
      code: 'tillo',
      name: 'Tillo',
      integrationMode: SupplierIntegrationMode.MANUAL,
      supportsRawCode: true,
      defaultCurrency: 'USD',
    },
    update: {},
  });

  await prisma.supplier.upsert({
    where: { code: 'reloadly' },
    create: {
      id: reloadlyId,
      code: 'reloadly',
      name: 'Reloadly',
      integrationMode: SupplierIntegrationMode.API,
      supportsRawCode: false,
      defaultCurrency: 'USD',
    },
    update: {},
  });

  const tilloOfferBySkuId = new Map<string, string>();
  for (const [i, def] of skuDefs.entries()) {
    // Tillo: every SKU, 8% discount off face value, priority 100.
    const tilloOfferId = `seed_offer_tillo_${pad(i + 1, 2)}`;
    const tilloCostCents = (def.faceValueCents * 92n) / 100n;
    await prisma.supplierOffer.upsert({
      where: { supplierId_skuId: { supplierId: tilloId, skuId: def.id } },
      create: {
        id: tilloOfferId,
        supplierId: tilloId,
        skuId: def.id,
        costCurrency: def.currency,
        costAmount: centsToDecimalString(tilloCostCents),
        discountBps: 800,
        priority: 100,
      },
      update: {},
    });
    tilloOfferBySkuId.set(def.id, tilloOfferId);

    // Reloadly: every other SKU also has a slightly cheaper API offer (priority 50,
    // lower wins) so supplier-offer-selection logic has more than one candidate.
    if (i % 2 === 0) {
      const reloadlyOfferId = `seed_offer_reloadly_${pad(i + 1, 2)}`;
      const reloadlyCostCents = (def.faceValueCents * 90n) / 100n;
      await prisma.supplierOffer.upsert({
        where: { supplierId_skuId: { supplierId: reloadlyId, skuId: def.id } },
        create: {
          id: reloadlyOfferId,
          supplierId: reloadlyId,
          skuId: def.id,
          costCurrency: def.currency,
          costAmount: centsToDecimalString(reloadlyCostCents),
          discountBps: 1000,
          priority: 50,
        },
        update: {},
      });
    }
  }

  return { tilloId, reloadlyId, tilloOfferBySkuId };
}

// ============================================================================
// 6. Customers — a fixed pool reused across the funnel fixture
// ============================================================================

const CUSTOMER_COUNT = 60;

async function seedCustomers(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= CUSTOMER_COUNT; i += 1) {
    const id = `seed_customer_${pad(i, 3)}`;
    const customerCode = `BP-${pad(i, 6)}`;
    await prisma.customer.upsert({
      where: { customerCode },
      create: {
        id,
        customerCode,
        status: CustomerStatus.ACTIVE,
        createdAt: atOffset(i),
        identities: {
          create: [
            {
              id: `seed_identity_${pad(i, 3)}`,
              type: IdentityType.MOBILE,
              value: `0912${pad(1_000_000 + i, 7)}`,
              valueNormalized: `0912${pad(1_000_000 + i, 7)}`,
              isPrimary: true,
              isVerified: true,
              verifiedAt: atOffset(i),
            },
          ],
        },
        profile: {
          create: {
            id: `seed_profile_${pad(i, 3)}`,
            firstName: `Demo${pad(i, 3)}`,
            lastName: 'Customer',
            preferredLanguage: 'fa',
          },
        },
      },
      update: {},
    });
    ids.push(id);
  }
  return ids;
}

// ============================================================================
// 7. The funnel fixture:
//    100 quotes -> 80 checkouts (orders) -> 70 payment attempts -> 65 paid
//    (5 failed) -> 60 fulfilled (5 paid-not-fulfilled) — the exact numbers the
//    reporting dashboard E2E test asserts against.
// ============================================================================

const TOTAL_QUOTES = 100;
const CHECKOUT_COUNT = 80;
const PAYMENT_ATTEMPT_COUNT = 70;
const PAID_COUNT = 65; // 70 - 5 failed
const FULFILLED_COUNT = 60; // 65 - 5 paid-not-fulfilled

interface QuoteBreakdown {
  supplierCostCents: bigint;
  supplierCostIrr: bigint;
  effectiveFxRate: bigint;
  paymentFee: bigint;
  serviceFee: bigint;
  marginAmount: bigint;
  subtotal: bigint;
  finalAmountIrr: bigint;
}

const PRICING = {
  fxSpreadBps: 150,
  fxRiskBufferBps: 100,
  serviceFeeBps: 200,
  paymentFeeBps: 100,
  targetMarginBps: 300,
  roundingStepIrr: 10_000n,
};

function computeDemoBreakdown(costCents: bigint): QuoteBreakdown {
  const effectiveFxRate =
    FX_MID_IRR_PER_USD +
    applyBpsIrr(FX_MID_IRR_PER_USD, PRICING.fxSpreadBps) +
    applyBpsIrr(FX_MID_IRR_PER_USD, PRICING.fxRiskBufferBps);
  const supplierCostIrr = centsToIrr(costCents, effectiveFxRate);
  const paymentFee = applyBpsIrr(supplierCostIrr, PRICING.paymentFeeBps);
  const serviceFee = applyBpsIrr(supplierCostIrr, PRICING.serviceFeeBps);
  const marginAmount = applyBpsIrr(supplierCostIrr, PRICING.targetMarginBps);
  const subtotal = supplierCostIrr + paymentFee + serviceFee + marginAmount;
  const finalAmountIrr = roundUpToStep(subtotal, PRICING.roundingStepIrr);
  return {
    supplierCostCents: costCents,
    supplierCostIrr,
    effectiveFxRate,
    paymentFee,
    serviceFee,
    marginAmount,
    subtotal,
    finalAmountIrr,
  };
}

async function seedFunnel(params: {
  customerIds: string[];
  skuDefs: (SkuDef & { id: string })[];
  tilloOfferBySkuId: Map<string, string>;
  pricingRuleId: string;
  fxRateId: string;
  tilloId: string;
  operatorIds: string[];
  managerId: string;
}): Promise<{ paidNotFulfilledOrderId: string; amountMismatchOrderId: string }> {
  const {
    customerIds,
    skuDefs,
    tilloOfferBySkuId,
    pricingRuleId,
    fxRateId,
    tilloId,
    operatorIds,
    managerId,
  } = params;

  const paidNotFulfilledOrderIds: string[] = [];

  for (let i = 1; i <= TOTAL_QUOTES; i += 1) {
    const sku = pick(skuDefs, i - 1);
    const offerId = tilloOfferBySkuId.get(sku.id);
    if (!offerId) throw new Error(`[seed] no Tillo offer for sku ${sku.id}`);
    const customerId = pick(customerIds, i - 1);
    const breakdown = computeDemoBreakdown(sku.faceValueCents - (sku.faceValueCents * 8n) / 100n);

    const quoteId = `seed_quote_${pad(i, 3)}`;
    const createdAt = atOffset(1000 + i * 30);
    const willCheckout = i <= CHECKOUT_COUNT;
    const quoteStatus = willCheckout
      ? QuoteStatus.ACCEPTED
      : i % 4 === 0
        ? QuoteStatus.EXPIRED
        : QuoteStatus.ACTIVE;

    await prisma.quote.upsert({
      where: { id: quoteId },
      create: {
        id: quoteId,
        quoteNumber: `Q-2026-${pad(i, 6)}`,
        customerId,
        skuId: sku.id,
        supplierOfferId: offerId,
        quantity: 1,
        currency: sku.currency,
        pricingRuleId,
        pricingVersion: 1,
        marketFxRate: FX_MID_IRR_PER_USD.toString(),
        effectiveFxRate: breakdown.effectiveFxRate.toString(),
        fxProvider: 'seed',
        fxRateId,
        fxRateTimestamp: SEED_EPOCH,
        fxSpreadAmount: applyBpsIrr(FX_MID_IRR_PER_USD, PRICING.fxSpreadBps),
        fxRiskBufferAmount: applyBpsIrr(FX_MID_IRR_PER_USD, PRICING.fxRiskBufferBps),
        supplierCostUsd: centsToDecimalString(breakdown.supplierCostCents),
        supplierCostIrr: breakdown.supplierCostIrr,
        paymentFee: breakdown.paymentFee,
        serviceFee: breakdown.serviceFee,
        operationalFee: 0n,
        marginAmount: breakdown.marginAmount,
        discountAmount: 0n,
        subtotal: breakdown.subtotal,
        finalAmountIrr: breakdown.finalAmountIrr,
        displayAmountToman: breakdown.finalAmountIrr / 10n,
        status: quoteStatus,
        expiresAt: new Date(createdAt.getTime() + 600_000),
        acceptedAt: willCheckout ? createdAt : null,
        idempotencyKey: willCheckout ? `seed-quote-accept-${pad(i, 3)}` : null,
        snapshot: {
          rule: {
            id: pricingRuleId,
            version: 1,
            ...PRICING,
            roundingStepIrr: PRICING.roundingStepIrr.toString(),
          },
          fx: { id: fxRateId, midRate: FX_MID_IRR_PER_USD.toString(), provider: 'seed' },
        },
        createdAt,
      },
      update: {},
    });

    if (!willCheckout) continue;

    const orderId = `seed_order_${pad(i, 3)}`;
    const orderNumber = `BP-2026-${pad(i, 6)}`;
    const hasPaymentAttempt = i <= PAYMENT_ATTEMPT_COUNT;
    const paymentSucceeds = i <= PAID_COUNT;
    const paidAndFulfilled = i <= FULFILLED_COUNT;

    let orderStatus: OrderStatus = OrderStatus.AWAITING_PAYMENT;
    if (hasPaymentAttempt) {
      orderStatus = paymentSucceeds
        ? paidAndFulfilled
          ? OrderStatus.FULFILLED
          : OrderStatus.PAID
        : OrderStatus.FAILED;
    }

    await prisma.order.upsert({
      where: { id: orderId },
      create: {
        id: orderId,
        orderNumber,
        customerId,
        quoteId,
        status: orderStatus,
        totalAmountIrr: breakdown.finalAmountIrr,
        displayAmountToman: breakdown.finalAmountIrr / 10n,
        currency: 'IRR',
        idempotencyKey: `seed-order-create-${pad(i, 3)}`,
        deliveryEmail: `demo-customer-${pad(i, 3)}@example.invalid`,
        failureReason: hasPaymentAttempt && !paymentSucceeds ? 'PAYMENT_VERIFY_FAILED' : null,
        placedAt: createdAt,
        paidAt: hasPaymentAttempt && paymentSucceeds ? atOffset(1000 + i * 30 + 60) : null,
        fulfilledAt: paidAndFulfilled ? atOffset(1000 + i * 30 + 600) : null,
        createdAt,
      },
      update: {},
    });
    if (hasPaymentAttempt) {
      const paymentId = `seed_payment_${pad(i, 3)}`;
      await prisma.payment.upsert({
        where: { id: paymentId },
        create: {
          id: paymentId,
          orderId,
          customerId,
          provider: 'mock',
          status: paymentSucceeds ? PaymentStatus.PAID : PaymentStatus.FAILED,
          amountIrr: breakdown.finalAmountIrr,
          displayAmountToman: breakdown.finalAmountIrr / 10n,
          providerAuthority: `mock_seed_${pad(i, 3)}`,
          providerRefId: paymentSucceeds ? `REF-${pad(i, 6)}` : null,
          providerRequestCode: 100,
          providerVerifyCode: paymentSucceeds ? 100 : -51,
          failureReason: paymentSucceeds ? null : PaymentFailureReason.VERIFY_FAILED,
          idempotencyKey: `seed-payment-${pad(i, 3)}`,
          requestedAt: createdAt,
          redirectedAt: createdAt,
          callbackAt: atOffset(1000 + i * 30 + 55),
          verifiedAt: paymentSucceeds ? atOffset(1000 + i * 30 + 60) : null,
          createdAt,
        },
        update: {},
      });

      if (paymentSucceeds) {
        // -----------------------------------------------------------------
        // Fulfillment path
        // -----------------------------------------------------------------
        const workItemId = `seed_workitem_${pad(i, 3)}`;

        /* Every work item used to arrive already assigned, so the operator
         * queue was empty of anything claimable and the claim path — the whole
         * point of the workspace — could not be exercised on seeded data. Leave
         * the unfulfilled tail unassigned so there is work waiting to be picked
         * up. Deterministic: the same orders are open on every rebuild. */
        const isUnclaimed = !paidAndFulfilled && i % 2 === 1;

        const operatorId = isUnclaimed ? null : pick(operatorIds, i - 1);
        const workItemStatus = paidAndFulfilled
          ? WorkItemStatus.COMPLETED
          : isUnclaimed
            ? WorkItemStatus.UNASSIGNED
            : WorkItemStatus.IN_PROGRESS;

        await prisma.workItem.upsert({
          where: { id: workItemId },
          create: {
            id: workItemId,
            code: `WI-${pad(i, 6)}`,
            orderId,
            customerId,
            queueId: 'seed_queue_01', // GIFT_CARD_MANUAL
            type: WorkItemType.MANUAL_GIFT_CARD_FULFILLMENT,
            status: workItemStatus,
            activeOrderKey: paidAndFulfilled ? null : orderId,
            assignedToStaffId: operatorId,
            /* An unclaimed item has never been assigned or started; the claim
             * endpoint is what stamps those. Backdating them here would let the
             * queue show work that is simultaneously waiting and in progress. */
            assignedAt: isUnclaimed ? null : createdAt,
            startedAt: isUnclaimed ? null : createdAt,
            completedAt: paidAndFulfilled ? atOffset(1000 + i * 30 + 600) : null,
            title: `Fulfil ${sku.title} (${sku.denominationLabel}) for ${orderNumber}`,
            createdAt,
          },
          /* An empty `update` makes re-running the seed a no-op on rows that
           * already exist, so a demo database can never pick up a change to
           * what the seed considers correct. Restating the assignment fields
           * keeps this convergent: re-seeding returns the queue to its intended
           * shape instead of leaving whatever a previous version wrote. */
          update: {
            status: workItemStatus,
            assignedToStaffId: operatorId,
            assignedAt: isUnclaimed ? null : createdAt,
            startedAt: isUnclaimed ? null : createdAt,
          },
        });

        const checklistId = `seed_checklist_${pad(i, 3)}`;
        await prisma.fulfillmentChecklist.upsert({
          where: { id: checklistId },
          create: {
            id: checklistId,
            workItemId,
            status: paidAndFulfilled ? ChecklistStatus.COMPLETED : ChecklistStatus.INCOMPLETE,
            completedAt: paidAndFulfilled ? atOffset(1000 + i * 30 + 590) : null,
          },
          update: {},
        });

        const checklistKeys = [
          'PAYMENT_VERIFIED',
          'DELIVERY_EMAIL_PRESENT',
          'SUPPLIER_ORDER_PLACED',
          'PROVIDER_REFERENCE_PRESENT',
          'ACTUAL_COST_PRESENT',
          'GIFT_CARD_ASSET_PRESENT',
          'ASSET_MATCHES_ORDER',
        ];
        for (const [k, key] of checklistKeys.entries()) {
          const status = paidAndFulfilled
            ? ChecklistItemStatus.PASSED
            : k === 0
              ? ChecklistItemStatus.PASSED
              : ChecklistItemStatus.PENDING;
          await prisma.fulfillmentChecklistItem.upsert({
            where: { checklistId_key: { checklistId, key } },
            create: {
              id: `seed_checklistitem_${pad(i, 3)}_${k}`,
              checklistId,
              key,
              label: key,
              labelFa: key,
              type: key.endsWith('PRESENT') ? 'SYSTEM_VERIFIED' : 'BOOLEAN',
              status,
              isBlocking: true,
              sortOrder: k * 10,
              verifiedByStaffId: status === ChecklistItemStatus.PASSED ? operatorId : null,
              verifiedAt: status === ChecklistItemStatus.PASSED ? createdAt : null,
            },
            update: {},
          });
        }

        if (paidAndFulfilled) {
          const fulfillmentId = `seed_fulfillment_${pad(i, 3)}`;
          await prisma.fulfillment.upsert({
            where: { id: fulfillmentId },
            create: {
              id: fulfillmentId,
              orderId,
              workItemId,
              supplierId: tilloId,
              status: FulfillmentStatus.COMPLETED,
              method: FulfillmentMethod.MANUAL,
              supplierReference: `TILLO-REF-${pad(i, 6)}`,
              actualSupplierCost: centsToDecimalString(breakdown.supplierCostCents),
              actualSupplierCurrency: sku.currency,
              actualSupplierCostIrr: breakdown.supplierCostIrr,
              costVarianceBps: 0,
              fulfilledByStaffId: operatorId,
              approvedByStaffId: managerId,
              approvedAt: createdAt,
              startedAt: createdAt,
              completedAt: atOffset(1000 + i * 30 + 600),
              idempotencyKey: `seed-fulfillment-${pad(i, 3)}`,
              createdAt,
            },
            update: {},
          });

          const plaintextCode = `DEMO-${pad(i, 6)}-CODE`;
          const assetId = `seed_asset_${pad(i, 3)}`;
          await prisma.giftCardAsset.upsert({
            where: { id: assetId },
            create: {
              id: assetId,
              fulfillmentId,
              orderId,
              skuId: sku.id,
              assetType: sku.assetType,
              encryptedCode:
                sku.assetType === DeliveryAssetType.URL ||
                sku.assetType === DeliveryAssetType.PROVIDER_DIRECT_EMAIL
                  ? null
                  : encryptDemoSecret(plaintextCode),
              maskedCode:
                sku.assetType === DeliveryAssetType.URL ||
                sku.assetType === DeliveryAssetType.PROVIDER_DIRECT_EMAIL
                  ? null
                  : maskCode(plaintextCode),
              deliveryUrl:
                sku.assetType === DeliveryAssetType.URL
                  ? 'https://redeem.example.invalid/demo'
                  : null,
              recipientEmail:
                sku.assetType === DeliveryAssetType.PROVIDER_DIRECT_EMAIL
                  ? `demo-customer-${pad(i, 3)}@example.invalid`
                  : null,
              status: DeliveryStatus.SENT,
              enteredByUserId: operatorId,
              enteredAt: createdAt,
              sentAt: atOffset(1000 + i * 30 + 605),
              createdAt,
            },
            update: {},
          });

          const deliveryAttemptId = `seed_delivery_${pad(i, 3)}`;
          await prisma.deliveryAttempt.upsert({
            where: { id: deliveryAttemptId },
            create: {
              id: deliveryAttemptId,
              giftCardAssetId: assetId,
              orderId,
              channel: DeliveryChannel.EMAIL,
              recipientMasked: `dem***@example.invalid`,
              status: DeliveryStatus.SENT,
              attemptNumber: 1,
              sentAt: atOffset(1000 + i * 30 + 605),
              createdAt,
            },
            update: {},
          });
        } else {
          paidNotFulfilledOrderIds.push(orderId);
        }
      }
    }
  }

  const paidNotFulfilledOrderId = paidNotFulfilledOrderIds[0] ?? '';
  const amountMismatchOrderId = paidNotFulfilledOrderIds[1] ?? paidNotFulfilledOrderIds[0] ?? '';
  return { paidNotFulfilledOrderId, amountMismatchOrderId };
}

// ============================================================================
// 8. Deliberate reconciliation anomalies
// ============================================================================

async function seedReconciliationAnomalies(ids: {
  paidNotFulfilledOrderId: string;
  amountMismatchOrderId: string;
}): Promise<void> {
  if (ids.amountMismatchOrderId) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: ids.amountMismatchOrderId },
    });
    const payment = await prisma.payment.findFirst({
      where: { orderId: ids.amountMismatchOrderId },
    });
    await prisma.reconciliationIssue.upsert({
      where: { id: 'seed_reconissue_amount_mismatch' },
      create: {
        id: 'seed_reconissue_amount_mismatch',
        type: ReconciliationIssueType.amount_mismatch,
        status: ReconciliationStatus.OPEN,
        severity: 'HIGH',
        orderId: order.id,
        paymentId: payment?.id ?? null,
        expectedAmountIrr: order.totalAmountIrr,
        actualAmountIrr: order.totalAmountIrr + 10_000n,
        differenceIrr: 10_000n,
        details: {
          note: 'Demo fixture: provider callback amount reported 10,000 IRR higher than the order total.',
        },
        detectedAt: SEED_EPOCH,
      },
      update: {},
    });
  }

  if (ids.paidNotFulfilledOrderId) {
    await prisma.reconciliationIssue.upsert({
      where: { id: 'seed_reconissue_paid_not_fulfilled' },
      create: {
        id: 'seed_reconissue_paid_not_fulfilled',
        type: ReconciliationIssueType.paid_not_fulfilled,
        status: ReconciliationStatus.OPEN,
        severity: 'MEDIUM',
        orderId: ids.paidNotFulfilledOrderId,
        details: {
          note: 'Demo fixture: order has been PAID for longer than the fulfillment SLA with no completed fulfillment.',
        },
        detectedAt: SEED_EPOCH,
      },
      update: {},
    });
  }

  await prisma.reconciliationIssue.upsert({
    where: { id: 'seed_reconissue_unknown_payment' },
    create: {
      id: 'seed_reconissue_unknown_payment',
      type: ReconciliationIssueType.unknown_payment,
      status: ReconciliationStatus.OPEN,
      severity: 'CRITICAL',
      details: {
        note: 'Demo fixture: a gateway callback referenced authority "mock_seed_unknown_authority" that does not match any Payment row.',
        providerAuthority: 'mock_seed_unknown_authority',
      },
      detectedAt: SEED_EPOCH,
    },
    update: {},
  });
}

// ============================================================================
// main
// ============================================================================

async function main(): Promise<void> {
  assertNotProduction();
  const database = await import('../src/client');
  prisma = database.prisma;
  disconnectPrisma = database.disconnectPrisma;

  console.log('[seed] starting deterministic demo seed...');

  await seedFeatureFlags();
  const queueIds = await seedQueues();
  const { operatorIds, managerId, adminId } = await seedStaff();
  await seedQueueMemberships(queueIds, operatorIds, managerId);
  await seedChecklistTemplates();
  const pricingRuleId = await seedPricingRule(adminId);
  const fxRateId = await seedFxRate(adminId);
  const { skuDefs } = await seedCatalog();
  const { tilloId, tilloOfferBySkuId } = await seedSuppliers(skuDefs);
  const customerIds = await seedCustomers();

  const anomalyIds = await seedFunnel({
    customerIds,
    skuDefs,
    tilloOfferBySkuId,
    pricingRuleId,
    fxRateId,
    tilloId,
    operatorIds,
    managerId,
  });

  await seedReconciliationAnomalies(anomalyIds);

  console.log(
    `[seed] done. ${TOTAL_QUOTES} quotes, ${CHECKOUT_COUNT} checkouts, ${PAYMENT_ATTEMPT_COUNT} payment attempts, ` +
      `${PAID_COUNT} paid, ${FULFILLED_COUNT} fulfilled, ${PAYMENT_ATTEMPT_COUNT - PAID_COUNT} failed payments.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (disconnectPrisma) await disconnectPrisma();
  });
