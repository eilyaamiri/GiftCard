import { faker } from '@faker-js/faker';

/**
 * Deterministic test data. Call `resetFactorySequence()` before each suite when
 * tests need identical values independent of execution order.
 */
export const FACTORY_SEED = 20_260_101;

const seededFaker = faker;
seededFaker.seed(FACTORY_SEED);
let sequence = 0;

export function resetFactorySequence(seed = FACTORY_SEED): void {
  seededFaker.seed(seed);
  sequence = 0;
}

function next(prefix: string): string {
  sequence += 1;
  return `${prefix}_${String(sequence).padStart(5, '0')}`;
}

function merge<T extends object>(defaults: T, overrides?: Partial<T>): T {
  return { ...defaults, ...overrides };
}

export interface CustomerFactoryValue {
  id: string;
  customerCode: string;
  status: 'ACTIVE' | 'DISABLED' | 'REVIEW_REQUIRED';
  mobile: string;
  email: string;
  createdAt: Date;
}

export interface ProductFactoryValue {
  id: string;
  slug: string;
  brand: string;
  title: string;
  titleFa: string;
  category: string;
  isActive: boolean;
}

export interface SkuFactoryValue {
  id: string;
  productId: string;
  code: string;
  region: string;
  currency: string;
  /** Decimal-compatible string; never a floating-point money value. */
  faceValue: string;
  denominationLabel: string;
  deliveryAssetType: 'CODE' | 'CODE_PIN' | 'URL' | 'PROVIDER_DIRECT_EMAIL';
  isActive: boolean;
}

export interface SupplierFactoryValue {
  id: string;
  code: string;
  name: string;
  integrationMode: 'MANUAL' | 'API';
  supportsRawCode: boolean;
  isActive: boolean;
}

export interface SupplierOfferFactoryValue {
  id: string;
  supplierId: string;
  skuId: string;
  costCurrency: string;
  /** Decimal-compatible string. */
  costAmount: string;
  discountBps: number;
  priority: number;
  isActive: boolean;
}

export interface PricingRuleFactoryValue {
  id: string;
  name: string;
  scope: 'GLOBAL' | 'PRODUCT' | 'SKU' | 'SERVICE';
  version: number;
  fxSpreadBps: number;
  fxRiskBufferBps: number;
  serviceFeeBps: number;
  serviceFeeFixedIrr: bigint;
  operationalFeeIrr: bigint;
  targetMarginBps: number;
  minimumMarginIrr: bigint;
  paymentFeeBps: number;
  paymentFeeFixedIrr: bigint;
  quoteTtlSeconds: number;
  roundingStepIrr: bigint;
  maxSupplierCostToleranceBps: number;
}

export interface FxRateFactoryValue {
  id: string;
  pair: 'USD_IRR';
  buyRate: string;
  sellRate: string;
  midRate: string;
  source: string;
  provider: string;
  isManualOverride: boolean;
  receivedAt: Date;
  effectiveAt: Date;
}

export interface QuoteFactoryValue {
  id: string;
  quoteNumber: string;
  customerId: string;
  skuId?: string;
  serviceId?: string;
  supplierOfferId?: string;
  quantity: number;
  currency: string;
  marketFxRate: string;
  effectiveFxRate: string;
  fxProvider: string;
  supplierCostUsd: string;
  supplierCostIrr: bigint;
  paymentFee: bigint;
  serviceFee: bigint;
  operationalFee: bigint;
  marginAmount: bigint;
  discountAmount: bigint;
  subtotal: bigint;
  finalAmountIrr: bigint;
  displayAmountToman: bigint;
  status: 'ACTIVE' | 'EXPIRED' | 'ACCEPTED' | 'CANCELLED';
  expiresAt: Date;
  snapshot: Record<string, unknown>;
}

export interface OrderFactoryValue {
  id: string;
  orderNumber: string;
  customerId: string;
  quoteId: string;
  status:
    | 'DRAFT'
    | 'AWAITING_PAYMENT'
    | 'PAYMENT_PENDING'
    | 'PAID'
    | 'FULFILLMENT_PENDING'
    | 'FULFILLING'
    | 'FULFILLED'
    | 'FAILED'
    | 'REVIEW_REQUIRED'
    | 'REFUND_PENDING'
    | 'REFUNDED'
    | 'CANCELLED';
  totalAmountIrr: bigint;
  displayAmountToman: bigint;
  currency: 'IRR';
  idempotencyKey: string;
  deliveryEmail: string;
  createdAt: Date;
}

export interface PaymentFactoryValue {
  id: string;
  orderId: string;
  customerId: string;
  provider: string;
  status:
    | 'CREATED'
    | 'REDIRECTED'
    | 'PENDING'
    | 'PAID'
    | 'FAILED'
    | 'CANCELLED'
    | 'UNKNOWN'
    | 'REFUND_PENDING'
    | 'REFUNDED';
  amountIrr: bigint;
  displayAmountToman: bigint;
  providerAuthority: string;
  idempotencyKey: string;
}

export interface WorkItemFactoryValue {
  id: string;
  code: string;
  orderId: string;
  customerId: string;
  queueId: string;
  type:
    | 'MANUAL_GIFT_CARD_FULFILLMENT'
    | 'INTERNATIONAL_PAYMENT'
    | 'CUSTOMER_INFORMATION'
    | 'SUPPLIER_FOLLOWUP'
    | 'UNKNOWN_OUTCOME'
    | 'REFUND_REVIEW'
    | 'SUPPORT_REQUEST';
  status:
    | 'UNASSIGNED'
    | 'ASSIGNED'
    | 'IN_PROGRESS'
    | 'WAITING_CUSTOMER'
    | 'WAITING_SUPPLIER'
    | 'NEED_REVIEW'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';
  priority: number;
  title: string;
}

const epoch = new Date('2026-01-01T00:00:00.000Z');

export function customerFactory(overrides?: Partial<CustomerFactoryValue>): CustomerFactoryValue {
  const n = sequence + 1;
  return merge(
    {
      id: next('customer'),
      customerCode: `BP-TEST-${String(n).padStart(6, '0')}`,
      status: 'ACTIVE' as const,
      mobile: `0912${String(1_000_000 + n).padStart(7, '0')}`,
      email: `customer-${String(n).padStart(5, '0')}@example.test`,
      createdAt: new Date(epoch.getTime() + n * 1000),
    },
    overrides,
  );
}

export function productFactory(overrides?: Partial<ProductFactoryValue>): ProductFactoryValue {
  const n = sequence + 1;
  return merge(
    {
      id: next('product'),
      slug: `test-product-${n}`,
      brand: 'Demo Brand',
      title: 'Demo Gift Card',
      titleFa: 'گیفت کارت آزمایشی',
      category: 'gift-card',
      isActive: true,
    },
    overrides,
  );
}

export function skuFactory(overrides?: Partial<SkuFactoryValue>): SkuFactoryValue {
  const n = sequence + 1;
  return merge(
    {
      id: next('sku'),
      productId: 'product_00001',
      code: `TEST-SKU-${String(n).padStart(5, '0')}`,
      region: 'US',
      currency: 'USD',
      faceValue: '25.000000',
      denominationLabel: '$25',
      deliveryAssetType: 'CODE' as const,
      isActive: true,
    },
    overrides,
  );
}

export function supplierFactory(overrides?: Partial<SupplierFactoryValue>): SupplierFactoryValue {
  return merge(
    {
      id: next('supplier'),
      code: 'test-supplier',
      name: 'Test Supplier',
      integrationMode: 'MANUAL' as const,
      supportsRawCode: true,
      isActive: true,
    },
    overrides,
  );
}

export function supplierOfferFactory(
  overrides?: Partial<SupplierOfferFactoryValue>,
): SupplierOfferFactoryValue {
  return merge(
    {
      id: next('offer'),
      supplierId: 'supplier_00001',
      skuId: 'sku_00001',
      costCurrency: 'USD',
      costAmount: '23.000000',
      discountBps: 800,
      priority: 100,
      isActive: true,
    },
    overrides,
  );
}

export function pricingRuleFactory(
  overrides?: Partial<PricingRuleFactoryValue>,
): PricingRuleFactoryValue {
  return merge(
    {
      id: next('pricing-rule'),
      name: 'Deterministic test pricing rule',
      scope: 'GLOBAL' as const,
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
    },
    overrides,
  );
}

export function fxRateFactory(overrides?: Partial<FxRateFactoryValue>): FxRateFactoryValue {
  return merge(
    {
      id: next('fx-rate'),
      pair: 'USD_IRR' as const,
      buyRate: '1915000.000000',
      sellRate: '1925000.000000',
      midRate: '1920000.000000',
      source: 'TEST',
      provider: 'mock',
      isManualOverride: false,
      receivedAt: epoch,
      effectiveAt: epoch,
    },
    overrides,
  );
}

export function quoteFactory(overrides?: Partial<QuoteFactoryValue>): QuoteFactoryValue {
  const n = sequence + 1;
  const supplierCostIrr = 44_160_000n;
  const subtotal = 46_368_000n;
  const finalAmountIrr = 46_370_000n;
  return merge(
    {
      id: next('quote'),
      quoteNumber: `Q-TEST-${String(n).padStart(6, '0')}`,
      customerId: 'customer_00001',
      skuId: 'sku_00001',
      quantity: 1,
      currency: 'USD',
      marketFxRate: '1920000.000000',
      effectiveFxRate: '1944000.000000',
      fxProvider: 'mock',
      supplierCostUsd: '23.000000',
      supplierCostIrr,
      paymentFee: 441_600n,
      serviceFee: 883_200n,
      operationalFee: 0n,
      marginAmount: 1_324_800n,
      discountAmount: 0n,
      subtotal,
      finalAmountIrr,
      displayAmountToman: finalAmountIrr / 10n,
      status: 'ACTIVE' as const,
      expiresAt: new Date(epoch.getTime() + 600_000),
      snapshot: { source: 'test-factory', pricingVersion: 1 },
    },
    overrides,
  );
}

export function orderFactory(overrides?: Partial<OrderFactoryValue>): OrderFactoryValue {
  const n = sequence + 1;
  const totalAmountIrr = 46_370_000n;
  return merge(
    {
      id: next('order'),
      orderNumber: `BP-TEST-2026-${String(n).padStart(6, '0')}`,
      customerId: 'customer_00001',
      quoteId: 'quote_00001',
      status: 'DRAFT' as const,
      totalAmountIrr,
      displayAmountToman: totalAmountIrr / 10n,
      currency: 'IRR' as const,
      idempotencyKey: `order-test-idempotency-${n}`,
      deliveryEmail: `customer-${String(n).padStart(5, '0')}@example.test`,
      createdAt: epoch,
    },
    overrides,
  );
}

export function paymentFactory(overrides?: Partial<PaymentFactoryValue>): PaymentFactoryValue {
  const n = sequence + 1;
  const amountIrr = 46_370_000n;
  return merge(
    {
      id: next('payment'),
      orderId: 'order_00001',
      customerId: 'customer_00001',
      provider: 'mock',
      status: 'CREATED' as const,
      amountIrr,
      displayAmountToman: amountIrr / 10n,
      providerAuthority: `mock_test_authority_${n}`,
      idempotencyKey: `payment-test-idempotency-${n}`,
    },
    overrides,
  );
}

export function workItemFactory(overrides?: Partial<WorkItemFactoryValue>): WorkItemFactoryValue {
  const n = sequence + 1;
  return merge(
    {
      id: next('work-item'),
      code: `WI-TEST-${String(n).padStart(6, '0')}`,
      orderId: 'order_00001',
      customerId: 'customer_00001',
      queueId: 'queue_test_00001',
      type: 'MANUAL_GIFT_CARD_FULFILLMENT' as const,
      status: 'UNASSIGNED' as const,
      priority: 100,
      title: 'Test gift-card fulfillment',
    },
    overrides,
  );
}

export const makeCustomer = customerFactory;
export const makeProduct = productFactory;
export const makeSku = skuFactory;
export const makeSupplier = supplierFactory;
export const makeSupplierOffer = supplierOfferFactory;
export const makePricingRule = pricingRuleFactory;
export const makeFxRate = fxRateFactory;
export const makeQuote = quoteFactory;
export const makeOrder = orderFactory;
export const makePayment = paymentFactory;
export const makeWorkItem = workItemFactory;

export { seededFaker };
