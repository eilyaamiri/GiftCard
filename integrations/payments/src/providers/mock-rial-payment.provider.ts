import { createHash } from 'node:crypto';

import type { PaymentFailureReason } from '@barat/contracts';

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  GetPaymentStatusInput,
  GetPaymentStatusResult,
  RefundInput,
  RefundResult,
  RialPaymentProvider,
  VerifyPaymentInput,
  VerifyResult,
} from '../rial-payment-provider.interface';

export type MockCreateOutcome = 'success' | 'failure' | 'timeout';
export type MockVerifyOutcome = 'success' | 'failure' | 'timeout' | 'already-verified';

export interface MockRialPaymentProviderOptions {
  readonly defaultCreateOutcome?: MockCreateOutcome;
  readonly defaultVerifyOutcome?: MockVerifyOutcome;
  readonly failureReason?: PaymentFailureReason;
}

/**
 * Permanent deterministic test provider.
 *
 * Tests can queue an outcome for the next call without sleeping or reaching the
 * network. Values are derived from stable inputs, so snapshots are repeatable.
 */
export class MockRialPaymentProvider implements RialPaymentProvider {
  readonly name = 'mock';

  private readonly createOutcomes: MockCreateOutcome[] = [];
  private readonly verifyOutcomes: MockVerifyOutcome[] = [];
  private readonly defaultCreateOutcome: MockCreateOutcome;
  private readonly defaultVerifyOutcome: MockVerifyOutcome;
  private readonly failureReason: PaymentFailureReason;

  constructor(options: MockRialPaymentProviderOptions = {}) {
    this.defaultCreateOutcome = options.defaultCreateOutcome ?? 'success';
    this.defaultVerifyOutcome = options.defaultVerifyOutcome ?? 'success';
    this.failureReason = options.failureReason ?? 'VERIFY_FAILED';
  }

  forceNextCreate(outcome: MockCreateOutcome): void {
    this.createOutcomes.push(outcome);
  }

  forceNextVerify(outcome: MockVerifyOutcome): void {
    this.verifyOutcomes.push(outcome);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const outcome = this.createOutcomes.shift() ?? this.defaultCreateOutcome;

    if (outcome === 'timeout') {
      return {
        ok: false,
        providerCode: null,
        failureReason: 'PROVIDER_TIMEOUT',
      };
    }

    if (outcome === 'failure') {
      return {
        ok: false,
        providerCode: -1,
        failureReason: this.failureReason === 'VERIFY_FAILED' ? 'REQUEST_REJECTED' : this.failureReason,
      };
    }

    const authority = `mock_${digest(input.idempotencyKey).slice(0, 32)}`;
    return {
      ok: true,
      authority,
      redirectUrl: `https://mock-gateway.invalid/start/${authority}`,
      providerCode: 100,
      providerAmount: input.amountIrr,
      providerAmountUnit: 'IRR',
      providerFeeIrr: 0n,
      providerFeeType: 'MOCK',
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyResult> {
    const outcome = this.verifyOutcomes.shift() ?? this.defaultVerifyOutcome;

    if (outcome === 'timeout') {
      return {
        outcome: 'UNKNOWN',
        providerCode: null,
        failureReason: 'PROVIDER_TIMEOUT',
      };
    }

    if (outcome === 'failure') {
      return {
        outcome: 'FAILED',
        providerCode: -51,
        failureReason: this.failureReason,
      };
    }

    if (outcome === 'already-verified') {
      return {
        outcome: 'ALREADY_VERIFIED',
        providerCode: 101,
        authority: input.authority,
        providerAmount: input.amountIrr,
        providerAmountUnit: 'IRR',
      };
    }

    const fingerprint = digest(`${input.authority}:${input.amountIrr.toString()}`);
    return {
      outcome: 'VERIFIED',
      providerCode: 100,
      authority: input.authority,
      providerAmount: input.amountIrr,
      providerAmountUnit: 'IRR',
      refId: BigInt(`0x${fingerprint.slice(0, 14)}`).toString(),
      maskedCard: '6037********1234',
      cardHash: fingerprint,
      providerFeeIrr: 0n,
      providerFeeType: 'MOCK',
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult> {
    const result = await this.verifyPayment(input);

    if (result.outcome === 'VERIFIED') {
      return { status: 'PAID', providerCode: 100 };
    }
    if (result.outcome === 'ALREADY_VERIFIED') {
      return { status: 'ALREADY_VERIFIED', providerCode: 101 };
    }
    return {
      status: result.outcome,
      providerCode: result.providerCode,
      failureReason: result.failureReason,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    void input;
    return { outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' };
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
