import type { CustomerDto, CustomerStatus, PaymentStatus } from '@barat/contracts';
/* GAP: packages/contracts has no RefundStatus enum yet, so the refund status is
 * typed from the (frozen) Prisma schema until Foundation adds one. */
import type { RefundStatus } from '@barat/database';

/**
 * The customer's own payout details, as they may be shown back to them.
 * There is no field here that could carry a full IBAN or card number.
 */
export interface BankAccountDto {
  /** Snapshot of the profile name the details were declared under. */
  readonly holderName: string;
  readonly maskedIban: string;
  readonly ibanBankName: string | null;
  readonly maskedCardNumber: string;
  readonly cardBankName: string | null;
  readonly ownershipAttestedAt: string;
  /** False until a bank inquiry confirms the holder; nothing does that yet. */
  readonly isVerified: boolean;
  readonly updatedAt: string;
}

/** Customer-visible profile. Identity values are masked, never raw. */
export interface CustomerProfileDto {
  readonly customer: CustomerDto;
  readonly preferredLanguage: string;
  readonly marketingOptIn: boolean;
  /** True until first and last name are present; the UI gates checkout on it. */
  readonly requiresProfileCompletion: boolean;
  readonly bankAccount: BankAccountDto | null;
  readonly updatedAt: string;
}

export interface AccountOrderDto {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly totalAmountIrr: string;
  readonly displayAmountToman: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly paidAt: string | null;
  readonly fulfilledAt: string | null;
}

export interface AccountPaymentDto {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly provider: string;
  readonly status: PaymentStatus;
  readonly amountIrr: string;
  readonly displayAmountToman: string;
  readonly providerRefId: string | null;
  readonly maskedCard: string | null;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
}

export interface AccountRefundDto {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amountIrr: string;
  readonly status: RefundStatus;
  readonly requestedAt: string;
  readonly processedAt: string | null;
}

export interface PagedResult<TItem> {
  readonly items: readonly TItem[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

/* ------------------------------------------------------------- operator view */

export interface CustomerSearchHit {
  readonly customerId: string;
  readonly customerCode: string;
  readonly status: CustomerStatus;
  readonly maskedMobile: string | null;
  readonly maskedEmail: string | null;
  readonly fullName: string | null;
  readonly orderCount: number;
  readonly createdAt: string;
  /** Which field produced the match, for the operator's own confidence. */
  readonly matchedOn: 'CUSTOMER_CODE' | 'MOBILE' | 'EMAIL' | 'NAME' | 'ORDER_NUMBER' | 'PAYMENT_REF';
}

export interface Customer360Dto {
  readonly customer: CustomerDto;
  readonly profile: {
    readonly preferredLanguage: string;
    readonly marketingOptIn: boolean;
  };
  readonly flags: ReadonlyArray<{
    readonly key: string;
    readonly reason: string | null;
    readonly createdAt: string;
    readonly expiresAt: string | null;
  }>;
  readonly notes: ReadonlyArray<{
    readonly id: string;
    readonly body: string;
    readonly isPinned: boolean;
    readonly authorStaffId: string | null;
    readonly createdAt: string;
  }>;
  readonly orders: readonly AccountOrderDto[];
  readonly payments: readonly AccountPaymentDto[];
  readonly refunds: readonly AccountRefundDto[];
  readonly tickets: ReadonlyArray<{
    readonly id: string;
    readonly workItemId: string;
    readonly code: string;
    readonly subject: string;
    readonly status: string;
    readonly orderId: string | null;
    readonly orderNumber: string | null;
    readonly ownerStaffId: string | null;
    readonly ownerStaffName: string | null;
    readonly createdAt: string;
    readonly firstResponseDueAt: string;
    readonly nextResponseDueAt: string;
    readonly firstRespondedAt: string | null;
    readonly lastRespondedAt: string | null;
  }>;
  readonly totals: {
    readonly orderCount: number;
    readonly paidOrderCount: number;
    readonly lifetimePaidIrr: string;
  };
}
