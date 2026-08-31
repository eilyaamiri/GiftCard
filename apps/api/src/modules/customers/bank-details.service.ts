/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Inject, Injectable } from '@nestjs/common';

/* Directly, not through the `common/config` barrel: that barrel also loads
 * `config.module.ts`, which validates the whole environment at import time. */
import { AppConfigService } from '../../common/config/app-config.service';
import { seal } from '../../common/crypto/aead-envelope';
import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { IdentityActor } from '../identity/identity.tokens';
import type { SaveBankAccountRequest } from '../identity/identity.schemas';
import {
  cardBankName,
  ibanBankName,
  maskCardNumber,
  maskIban,
  normalizeCardNumber,
  normalizeHolderName,
  normalizeIban,
} from './bank-details.utils';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import type { BankAccountDto } from './customers.types';

/** Domain separation for the envelopes; see `aead-envelope.ts`. */
const IBAN_AAD = 'barat-pay:customer-bank-iban:v1';
const CARD_AAD = 'barat-pay:customer-bank-card:v1';

/**
 * The customer's own payout details.
 *
 * Two rules shape everything here:
 *
 * 1. **The account must be the customer's own.** There is no "holder name"
 *    input, because a name the customer types proves nothing that the
 *    confirmation checkbox does not already claim. The stored holder is a
 *    snapshot of the profile name on file, so the record is tied to the
 *    identity the account was opened with, and a customer with no name on file
 *    cannot save payout details at all.
 * 2. **Nothing readable is stored or returned.** The IBAN and the card number go
 *    into AES-256-GCM envelopes; the masked forms are what every DTO, audit row
 *    and log line sees. This service has no read path for the plaintext — a
 *    payout process that needs it is a separate, human-reviewed change.
 */
@Injectable()
export class BankDetailsService {
  constructor(
    @Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async get(customerId: string): Promise<BankAccountDto | null> {
    const row = await this.database.customerBankAccount.findUnique({
      where: { customerId },
      select: {
        holderName: true,
        ibanMasked: true,
        ibanBankName: true,
        cardMasked: true,
        cardBankName: true,
        ownershipAttestedAt: true,
        verifiedAt: true,
        updatedAt: true,
      },
    });
    if (!row) {
      return null;
    }

    return {
      holderName: row.holderName,
      maskedIban: row.ibanMasked,
      ibanBankName: row.ibanBankName,
      maskedCardNumber: row.cardMasked,
      cardBankName: row.cardBankName,
      ownershipAttestedAt: row.ownershipAttestedAt.toISOString(),
      isVerified: row.verifiedAt !== null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(
    customerId: string,
    input: SaveBankAccountRequest,
    actor: IdentityActor,
  ): Promise<BankAccountDto> {
    if (!input.ownershipConfirmed) {
      throw DomainErrors.validation([
        {
          path: 'ownershipConfirmed',
          message: 'باید تأیید کنید که شبا و کارت به نام خودتان است.',
        },
      ]);
    }

    const holderName = await this.holderNameOnFile(customerId);
    const iban = normalizeIban(input.iban);
    const cardNumber = normalizeCardNumber(input.cardNumber);

    const data = {
      holderName,
      ...this.encryptDetails(iban, cardNumber),
      ibanMasked: maskIban(iban),
      ibanBankName: ibanBankName(iban),
      cardMasked: maskCardNumber(cardNumber),
      cardBankName: cardBankName(cardNumber),
      ownershipAttestedAt: new Date(),
      /* Re-declaring the details drops any earlier confirmation: a new number
       * has not been checked against anything. */
      verifiedAt: null,
    };

    const before = await this.database.customerBankAccount.findUnique({
      where: { customerId },
      select: { ibanMasked: true, cardMasked: true, holderName: true },
    });

    await this.database.customerBankAccount.upsert({
      where: { customerId },
      create: { customerId, ...data },
      update: data,
    });

    /* Masked values only. The envelopes are left out entirely rather than
     * relying on the audit redactor to catch their field names. */
    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'CUSTOMER_BANK_ACCOUNT_SAVED',
      entity: 'CustomerBankAccount',
      entityId: customerId,
      before,
      after: {
        holderName: data.holderName,
        ibanMasked: data.ibanMasked,
        ibanBankName: data.ibanBankName,
        cardMasked: data.cardMasked,
        cardBankName: data.cardBankName,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    const saved = await this.get(customerId);
    if (!saved) {
      throw DomainErrors.notFound('CustomerBankAccount');
    }
    return saved;
  }

  async remove(customerId: string, actor: IdentityActor): Promise<{ removed: boolean }> {
    const before = await this.database.customerBankAccount.findUnique({
      where: { customerId },
      select: { ibanMasked: true, cardMasked: true, holderName: true },
    });
    if (!before) {
      return { removed: false };
    }

    await this.database.customerBankAccount.delete({ where: { customerId } });
    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'CUSTOMER_BANK_ACCOUNT_REMOVED',
      entity: 'CustomerBankAccount',
      entityId: customerId,
      before,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { removed: true };
  }

  /** The key is zeroed the moment the two envelopes exist; it never outlives them. */
  private encryptDetails(
    iban: string,
    cardNumber: string,
  ): { ibanEncrypted: string; cardEncrypted: string } {
    const key = this.config.bankDetailsEncryptionKey();
    try {
      return {
        ibanEncrypted: seal(iban, key, IBAN_AAD),
        cardEncrypted: seal(cardNumber, key, CARD_AAD),
      };
    } finally {
      key.fill(0);
    }
  }

  /**
   * The name the account is held under. A profile without one is not a failure
   * of this request so much as a missing prerequisite, so it says which field to
   * fill in.
   */
  private async holderNameOnFile(customerId: string): Promise<string> {
    const profile = await this.database.customerProfile.findUnique({
      where: { customerId },
      select: { firstName: true, lastName: true },
    });

    const holderName = normalizeHolderName(
      `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`,
    );
    if (!profile?.firstName || !profile.lastName || holderName.length < 3) {
      throw DomainErrors.validation([
        {
          path: 'holderName',
          message: 'ابتدا نام و نام خانوادگی خود را در همین صفحه کامل کنید.',
        },
      ]);
    }
    return holderName;
  }
}
