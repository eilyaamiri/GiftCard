import type { PaymentAmountUnit, PaymentFailureReason } from '@barat/contracts';

/**
 * Provider-neutral input for opening a rial payment session.
 *
 * `amountIrr` is always the canonical business amount. An adapter is solely
 * responsible for converting it to the unit required by its merchant contract.
 */
export interface CreatePaymentInput {
  readonly amountIrr: bigint;
  readonly orderNumber: string;
  readonly description: string;
  readonly callbackUrl: string;
  readonly customerMobile?: string | null;
  readonly customerEmail?: string | null;
  readonly idempotencyKey: string;
}

export type CreatePaymentResult =
  | {
      readonly ok: true;
      readonly authority: string;
      readonly redirectUrl: string;
      readonly providerCode: number;
      readonly providerAmount: bigint;
      readonly providerAmountUnit: PaymentAmountUnit;
      readonly providerFeeIrr: bigint | null;
      readonly providerFeeType: string | null;
    }
  | {
      readonly ok: false;
      readonly providerCode: number | null;
      readonly failureReason: PaymentFailureReason;
    };

/**
 * The amount is supplied by our stored Payment row, never by callback input.
 */
export interface VerifyPaymentInput {
  readonly authority: string;
  readonly amountIrr: bigint;
}

export type VerifyResult =
  | {
      readonly outcome: 'VERIFIED';
      readonly providerCode: 100;
      readonly authority: string;
      readonly providerAmount: bigint;
      readonly providerAmountUnit: PaymentAmountUnit;
      readonly refId: string;
      readonly maskedCard: string | null;
      readonly cardHash: string | null;
      readonly providerFeeIrr: bigint | null;
      readonly providerFeeType: string | null;
    }
  | {
      readonly outcome: 'ALREADY_VERIFIED';
      readonly providerCode: 101;
      readonly authority: string;
      readonly providerAmount: bigint;
      readonly providerAmountUnit: PaymentAmountUnit;
    }
  | {
      readonly outcome: 'FAILED' | 'UNKNOWN';
      readonly providerCode: number | null;
      readonly failureReason: PaymentFailureReason;
    };

export interface GetPaymentStatusInput {
  readonly authority: string;
  readonly amountIrr: bigint;
}

export type GetPaymentStatusResult =
  | {
      readonly status: 'PAID' | 'ALREADY_VERIFIED';
      readonly providerCode: 100 | 101;
    }
  | {
      readonly status: 'FAILED' | 'UNKNOWN';
      readonly providerCode: number | null;
      readonly failureReason: PaymentFailureReason;
    };

export interface RefundInput {
  readonly authority: string;
  readonly amountIrr: bigint;
  readonly idempotencyKey: string;
}

/**
 * A provider must never report a fake refund. Until a real, verified refund API
 * is implemented, it returns this explicit result.
 */
export type RefundResult = {
  readonly outcome: 'NOT_SUPPORTED';
  readonly failureReason: 'NOT_SUPPORTED';
};

export interface RialPaymentProvider {
  readonly name: string;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyResult>;
  getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}
