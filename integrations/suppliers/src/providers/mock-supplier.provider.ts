import type {
  SupplierAvailability,
  SupplierBalance,
  SupplierCatalogItem,
  SupplierMoney,
  SupplierProvider,
  SupplierPurchaseRequest,
  SupplierPurchaseResult,
} from '../supplier-provider.interface';

export interface MockSupplierProviderOptions {
  readonly catalog?: readonly SupplierCatalogItem[];
  readonly prices?: Readonly<Record<string, SupplierMoney>>;
  readonly availability?: Readonly<Record<string, SupplierAvailability>>;
  readonly purchaseResult?: SupplierPurchaseResult;
  /** Omitted means "funded"; a test that cares about the empty case sets it. */
  readonly balance?: SupplierMoney;
  /** Makes `getBalance` throw, standing in for an unreachable venue. */
  readonly balanceFailure?: string;
}

const DEFAULT_MOCK_BALANCE: SupplierMoney = { amount: '1000000', currency: 'USD' };

/**
 * Deterministic in-memory provider for tests and local development.
 *
 * Purchase requests are idempotent by `idempotencyKey`. In particular, an
 * UNKNOWN result is cached and returned unchanged; it is never retried or
 * silently converted into a second supplier purchase.
 */
export class MockSupplierProvider implements SupplierProvider {
  readonly key = 'mock';

  private readonly catalog: readonly SupplierCatalogItem[];
  private readonly prices: Readonly<Record<string, SupplierMoney>>;
  private readonly availability: Readonly<Record<string, SupplierAvailability>>;
  private nextPurchaseResult: SupplierPurchaseResult;
  private balance: SupplierMoney;
  private balanceFailure: string | null;
  private readonly purchases = new Map<string, SupplierPurchaseResult>();
  private readonly purchaseStatuses = new Map<string, SupplierPurchaseResult>();
  private purchaseInvocationCount = 0;

  constructor(options: MockSupplierProviderOptions = {}) {
    this.catalog = options.catalog ?? [];
    this.prices = options.prices ?? {};
    this.availability = options.availability ?? {};
    this.nextPurchaseResult = options.purchaseResult ?? {
      status: 'FAILED',
      failureCode: 'MOCK_NOT_CONFIGURED',
    };
    this.balance = options.balance ?? DEFAULT_MOCK_BALANCE;
    this.balanceFailure = options.balanceFailure ?? null;
  }

  setNextPurchaseResult(result: SupplierPurchaseResult): void {
    this.nextPurchaseResult = result;
  }

  setBalance(balance: SupplierMoney): void {
    this.balance = balance;
    this.balanceFailure = null;
  }

  setBalanceFailure(failureCode: string): void {
    this.balanceFailure = failureCode;
  }

  async getBalance(): Promise<SupplierBalance> {
    if (this.balanceFailure !== null) {
      throw new Error(this.balanceFailure);
    }
    return { ...this.balance, observedAt: new Date() };
  }

  setPurchaseStatus(providerReference: string, result: SupplierPurchaseResult): void {
    this.purchaseStatuses.set(providerReference, result);
  }

  getPurchaseInvocationCount(): number {
    return this.purchaseInvocationCount;
  }

  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    return this.catalog;
  }

  async getPrice(providerSku: string) {
    const cost = this.prices[providerSku];
    if (!cost) {
      throw new Error('Mock supplier price is not configured for this SKU');
    }

    return { providerSku, cost, observedAt: new Date() };
  }

  async checkAvailability(providerSku: string) {
    return {
      providerSku,
      availability: this.availability[providerSku] ?? 'UNKNOWN',
      observedAt: new Date(),
    };
  }

  async purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult> {
    const existing = this.purchases.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }

    this.purchaseInvocationCount += 1;
    const result = this.nextPurchaseResult;
    this.purchases.set(request.idempotencyKey, result);

    if (result.providerReference) {
      this.purchaseStatuses.set(result.providerReference, result);
    }

    return result;
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    return (
      this.purchaseStatuses.get(providerReference) ?? {
        status: 'UNKNOWN',
        providerReference,
        failureCode: 'MOCK_STATUS_NOT_CONFIGURED',
      }
    );
  }
}
