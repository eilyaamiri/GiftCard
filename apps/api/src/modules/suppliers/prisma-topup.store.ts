import { Injectable } from '@nestjs/common';
import { prisma, type Prisma } from '@barat/database';

import type { TopUpCatalogStore, TopUpSyncableSupplier } from './suppliers.types';
import {
  isStalePurchasingClaim,
  TOP_UP_PURCHASE_RECOVERY_GRACE_MS,
  type DueTopUp,
  type TopUpFulfillmentStatus,
  type TopUpStore,
  type TopUpTarget,
} from './suppliers.types';

/**
 * Persistence for the automated top-up path.
 *
 * Split from `PrismaSupplierStore` because the two answer different questions:
 * that one resolves SKUs and offers for gift cards, this one reads the trace of
 * a single order. Keeping them apart also keeps `SupplierStore`'s port — which
 * every existing caller already implements in tests — unchanged.
 */
@Injectable()
export class PrismaTopUpStore implements TopUpStore {
  private readonly db: typeof prisma;

  constructor() {
    this.db = prisma;
  }

  async ensureFulfillmentForPaidOrder(orderId: string): Promise<TopUpTarget | null> {
    const existing = await this.findTargetByOrderId(orderId);
    if (existing !== null) {
      return existing;
    }

    try {
      await this.db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            customerId: true,
            status: true,
            quote: { select: { topUpOfferId: true, snapshot: true } },
          },
        });
        if (
          order === null ||
          !['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'].includes(order.status) ||
          order.quote.topUpOfferId === null
        ) {
          return;
        }

        const snapshot = readSnapshotTopUp(order.quote.snapshot);
        if (snapshot === null || snapshot.supplierId === null) {
          throw new Error('paid top-up quote snapshot is incomplete');
        }

        const fulfillment = await tx.topUpFulfillment.create({
          data: {
            orderId: order.id,
            topUpOfferId: order.quote.topUpOfferId,
            supplierId: snapshot.supplierId,
            providerSku: snapshot.providerSku,
            accountFields: snapshot.accountFields as Prisma.InputJsonObject,
            idempotencyKey: `topup:${order.id}`,
          },
        });
        await tx.topUpEvent.create({
          data: {
            topUpFulfillmentId: fulfillment.id,
            orderId: order.id,
            type: 'QUEUED',
            status: 'QUEUED',
            actorType: 'SYSTEM',
          },
        });
      });
    } catch (error) {
      /* A concurrent payment callback may have won the unique order claim.
       * Only that expected race is recovered; malformed snapshots and database
       * failures are propagated so the caller/sweep can retry visibly. */
      if (!isUniqueConstraint(error)) {
        throw error;
      }
    }
    return this.findTargetByOrderId(orderId);
  }

  async listDue(): Promise<readonly DueTopUp[]> {
    const now = new Date();
    const purchasingRecoveryBefore = new Date(now.getTime() - TOP_UP_PURCHASE_RECOVERY_GRACE_MS);
    const [missing, due] = await Promise.all([
      this.db.order.findMany({
        where: {
          status: { in: ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'] },
          quote: { topUpOfferId: { not: null } },
          topUpFulfillments: { none: {} },
        },
        select: { id: true },
      }),
      this.db.topUpFulfillment.findMany({
        where: {
          OR: [
            {
              status: { in: ['WAITING_FUNDS', 'AWAITING_PROVIDER'] },
              OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
            },
            /* Only recover a claim after the request's maximum lifetime plus a
             * safety margin. A fresh claim may have a live provider POST in a
             * different process and must never be marked ambiguous beneath it. */
            { status: 'PURCHASING', startedAt: { lte: purchasingRecoveryBefore } },
          ],
        },
        select: { orderId: true, status: true, startedAt: true },
      }),
    ]);
    return [
      ...missing.map(({ id }) => ({ orderId: id, action: 'START' as const })),
      ...due
        .filter(({ status, startedAt }) =>
          status === 'PURCHASING' ? isStalePurchasingClaim(startedAt, now) : true,
        )
        .map(({ orderId, status }) => ({
          orderId,
          action:
            status === 'AWAITING_PROVIDER' || status === 'PURCHASING'
              ? ('POLL' as const)
              : ('START' as const),
        })),
    ];
  }

  async countConsecutiveUnreachablePolls(fulfillmentId: string): Promise<number> {
    const events = await this.db.topUpEvent.findMany({
      where: { topUpFulfillmentId: fulfillmentId },
      orderBy: { createdAt: 'desc' },
      select: { type: true, detail: true },
    });
    let count = 0;
    for (const event of events) {
      if (event.type !== 'STATUS_POLLED') {
        break;
      }
      const detail = readJsonRecord(event.detail);
      if (detail?.reachable !== false) {
        break;
      }
      count += 1;
    }
    return count;
  }

  /**
   * Resolve everything needed to buy, from the order id alone.
   *
   * The account fields and the provider SKU are read from the FULFILLMENT row,
   * which was frozen from the quote snapshot when the order was paid — not from
   * the quote. That is deliberate: the fulfillment is what the purchase must
   * match, and reading the same values the trace will later be compared against
   * removes any chance of the two drifting.
   */
  async findTargetByOrderId(orderId: string): Promise<TopUpTarget | null> {
    const row = await this.db.topUpFulfillment.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        providerSku: true,
        accountFields: true,
        providerOrderNumber: true,
        purchaseAttempts: true,
        supplier: { select: { id: true, code: true } },
        offer: { select: { costAmount: true, costCurrency: true } },
        order: {
          select: {
            id: true,
            customerId: true,
            status: true,
            quote: { select: { snapshot: true } },
          },
        },
      },
    });
    if (row === null) {
      return null;
    }

    const snapshot = readSnapshotTopUp(row.order.quote.snapshot);
    if (snapshot === null) {
      throw new Error('top-up fulfillment quote snapshot is incomplete');
    }

    return {
      orderId: row.order.id,
      customerId: row.order.customerId,
      orderStatus: row.order.status,
      fulfillmentId: row.id,
      status: row.status as TopUpFulfillmentStatus,
      providerSku: snapshot.providerSku,
      costAmount: snapshot.costAmount,
      costCurrency: snapshot.costCurrency,
      supplierCode: snapshot.supplierCode,
      supplierId: row.supplier.id,
      accountFields: snapshot.accountFields,
      providerOrderNumber: row.providerOrderNumber,
      purchaseAttempts: row.purchaseAttempts,
    };
  }

  /**
   * Move the fulfillment and append the step that explains it, atomically.
   *
   * The conditional `updateMany` is the claim: it only matches when the row is
   * still in one of `from`, so two workers racing to purchase the same top-up
   * cannot both proceed. The loser sees `count === 0` and stands down. A read
   * followed by a write would let both believe they won, which for a top-up
   * means buying the same thing twice.
   */
  async transition(input: {
    fulfillmentId: string;
    from: readonly TopUpFulfillmentStatus[];
    to: TopUpFulfillmentStatus;
    event: Parameters<TopUpStore['transition']>[0]['event'];
    providerOrderNumber?: string | null;
    providerStatus?: string | null;
    failureCode?: string | null;
    chargedAmount?: string | null;
    chargedCurrency?: string | null;
    nextCheckAt?: Date | null;
    incrementPurchaseAttempts?: boolean;
    completedAt?: Date | null;
  }): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.topUpFulfillment.updateMany({
        where: { id: input.fulfillmentId, status: { in: [...input.from] } },
        data: {
          status: input.to,
          ...(input.providerOrderNumber === undefined
            ? {}
            : { providerOrderNumber: input.providerOrderNumber }),
          ...(input.providerStatus === undefined ? {} : { providerStatus: input.providerStatus }),
          ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
          ...(input.chargedAmount === undefined
            ? {}
            : { chargedAmount: input.chargedAmount }),
          ...(input.chargedCurrency === undefined
            ? {}
            : { chargedCurrency: input.chargedCurrency }),
          ...(input.nextCheckAt === undefined ? {} : { nextCheckAt: input.nextCheckAt }),
          ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
          ...(input.incrementPurchaseAttempts === true
            ? { purchaseAttempts: { increment: 1 } }
            : {}),
          ...(input.to === 'PURCHASING' ? { startedAt: now } : {}),
        },
      });

      if (result.count !== 1) {
        /* Lost the claim. Nothing is written: an event that describes a
         * transition which did not happen would be a lie in the trace, which is
         * the one artefact this whole design exists to keep trustworthy. */
        return false;
      }

      const row = await tx.topUpFulfillment.findUniqueOrThrow({
        where: { id: input.fulfillmentId },
        select: { orderId: true },
      });
      await tx.topUpEvent.create({
        data: {
          topUpFulfillmentId: input.fulfillmentId,
          orderId: row.orderId,
          type: input.event.type,
          status: input.to,
          providerStatus: input.event.providerStatus ?? null,
          failureCode: input.event.failureCode ?? null,
          detail: (input.event.detail ?? undefined) as Prisma.InputJsonValue | undefined,
          actorType: 'SYSTEM',
        },
      });
      return true;
    });
  }

  /** Append a step without moving the status. The trace is append-only. */
  async recordEvent(input: {
    fulfillmentId: string;
    orderId: string;
    status: TopUpFulfillmentStatus;
    event: Parameters<TopUpStore['recordEvent']>[0]['event'];
  }): Promise<void> {
    await this.db.topUpEvent.create({
      data: {
        topUpFulfillmentId: input.fulfillmentId,
        orderId: input.orderId,
        type: input.event.type,
        status: input.status,
        providerStatus: input.event.providerStatus ?? null,
        failureCode: input.event.failureCode ?? null,
        detail: (input.event.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        actorType: 'SYSTEM',
      },
    });
  }

  /**
   * Move the order, conditionally on its current status.
   *
   * Written as a guarded `updateMany` rather than through the state machine so
   * this module keeps its single narrow database dependency. The statuses passed
   * in `from` are the same ones `ALLOWED_TRANSITIONS` permits, and the caller
   * only ever asks for a legal successor — so this is the same guarantee, minus
   * the audit row, which `TopUpEvent` already provides for this flow.
   */
  async transitionOrder(input: {
    orderId: string;
    from: readonly string[];
    to: string;
    failureReason?: string | null;
  }): Promise<boolean> {
    const result = await this.db.order.updateMany({
      where: {
        id: input.orderId,
        status: { in: input.from as Prisma.EnumOrderStatusFilter['in'] },
      },
      data: {
        status: input.to as Prisma.OrderUpdateManyMutationInput['status'],
        ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason }),
        ...(input.to === 'FULFILLED' ? { fulfilledAt: new Date() } : {}),
      },
    });
    return result.count === 1;
  }
}

function readJsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readSnapshotTopUp(value: Prisma.JsonValue): {
  providerSku: string;
  supplierId: string | null;
  supplierCode: string;
  costAmount: string;
  costCurrency: string;
  accountFields: Record<string, string>;
} | null {
  const snapshot = readJsonRecord(value);
  const target = readJsonRecord(snapshot?.['target'] ?? null);
  const topUp = readJsonRecord(target?.['topUp'] ?? null);
  const supplier = readJsonRecord(snapshot?.['supplier'] ?? null);
  const providerSku = topUp?.['providerSku'];
  const supplierId = supplier?.['id'];
  const supplierCode = supplier?.['code'];
  const costAmount = topUp?.['costAmount'];
  const costCurrency = topUp?.['costCurrency'];
  const accountFields = readJsonRecord(snapshot?.['topUpAccountFields'] ?? null);
  if (
    typeof providerSku !== 'string' ||
    typeof supplierId !== 'string' ||
    typeof supplierCode !== 'string' ||
    typeof costAmount !== 'string' ||
    typeof costCurrency !== 'string' ||
    accountFields === null
  ) {
    return null;
  }
  const strings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(accountFields)) {
    if (typeof entry !== 'string') {
      return null;
    }
    strings[key] = entry;
  }
  return {
    providerSku,
    supplierId,
    supplierCode,
    costAmount,
    costCurrency,
    accountFields: strings,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Catalogue shape for top-ups, kept apart from {@link PrismaTopUpStore}.
 *
 * Two reasons, and the second is the load-bearing one:
 *
 *   - The two answer different questions. `PrismaTopUpStore` reads the trace of
 *     a single order; this reads and writes the catalogue as a whole. Merging
 *     them would hand every fulfillment caller a write path to the storefront.
 *   - `isActive` must never be written by a sync. Keeping the write in one small
 *     class with one narrow method makes that auditable by reading one file
 *     rather than by trusting every caller.
 */
@Injectable()
export class PrismaTopUpCatalogStore implements TopUpCatalogStore {
  private readonly db: typeof prisma;

  constructor() {
    this.db = prisma;
  }

  async listSyncableSuppliers(): Promise<readonly TopUpSyncableSupplier[]> {
    const suppliers = await this.db.supplier.findMany({
      where: { isActive: true, topUpGames: { some: {} } },
      select: {
        id: true,
        code: true,
        topUpGames: {
          select: {
            id: true,
            providerCategoryId: true,
            offers: { select: { id: true, providerOfferId: true } },
          },
        },
      },
    });

    return suppliers.map((supplier) => ({
      id: supplier.id,
      code: supplier.code,
      games: supplier.topUpGames.map((game) => ({
        id: game.id,
        providerCategoryId: game.providerCategoryId,
        providerOfferIds: game.offers.map((offer) => offer.providerOfferId),
      })),
      /* Flattened, but each offer keeps its game's category: the venue's SKU is
       * composed from both, and offer ids repeat across games. */
      offers: supplier.topUpGames.flatMap((game) =>
        game.offers.map((offer) => ({
          id: offer.id,
          providerOfferId: offer.providerOfferId,
          providerCategoryId: game.providerCategoryId,
        })),
      ),
    }));
  }

  async applyAvailability(input: {
    readonly supplierId: string;
    readonly listedGameIds: readonly string[];
    readonly delistedGameIds: readonly string[];
    readonly listedOfferIds: readonly string[];
    readonly delistedOfferIds: readonly string[];
    readonly syncedAt: Date;
    readonly listingEnabled?: boolean;
  }): Promise<void> {
    const listed = input.listingEnabled ?? true;

    await this.db.$transaction(async (tx) => {
      /*
       * Delisting runs first and unconditionally: a row the venue no longer
       * offers must leave the storefront even if the run that would relist it
       * fails afterwards. The reverse order would leave a sold-out product on
       * sale for as long as the second write took.
       *
       * `isActive` is absent from every update below, on purpose. A delisted
       * row keeps whatever the operator chose, so relisting does not silently
       * put a product back on sale — an operator still decides that.
       */
      if (input.delistedGameIds.length > 0) {
        await tx.topUpGame.updateMany({
          where: { id: { in: [...input.delistedGameIds] }, supplierId: input.supplierId },
          data: { isListed: false, lastSyncedAt: input.syncedAt },
        });
      }
      if (input.delistedOfferIds.length > 0) {
        await tx.topUpOffer.updateMany({
          where: {
            id: { in: [...input.delistedOfferIds] },
            game: { supplierId: input.supplierId },
          },
          data: { isListed: false, lastSyncedAt: input.syncedAt },
        });
      }
      if (input.listedGameIds.length > 0) {
        await tx.topUpGame.updateMany({
          where: { id: { in: [...input.listedGameIds] }, supplierId: input.supplierId },
          data: { isListed: listed, lastSyncedAt: input.syncedAt },
        });
      }
      if (input.listedOfferIds.length > 0) {
        await tx.topUpOffer.updateMany({
          where: {
            id: { in: [...input.listedOfferIds] },
            game: { supplierId: input.supplierId },
          },
          data: { isListed: listed, lastSyncedAt: input.syncedAt },
        });
      }
    });
  }
}
