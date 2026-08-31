import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule, AppConfigService } from './common/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyHeaderInterceptor } from './common/interceptors/idempotency-header.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { buildLoggerOptions } from './common/logger/logger.config';

/* ============================================================================
 * DOMAIN MODULE REGISTRY — FROZEN CONTRACT
 *
 * Each module below is owned by exactly one workstream. The import list is the
 * agreed surface: an agent adds files inside its own module directory, never a
 * new entry here without a coordination pass.
 *
 * Until every workstream has landed, some of these paths do not exist yet and
 * this file will not compile. That is expected during Phase 0/1 — the registry
 * is written first precisely so that parallel agents build against a fixed set
 * of module names and locations.
 *
 *   health        Foundation   implemented here
 *   pricing       B1           money + pricing engine
 *   fx            B2           rate aggregator, stale policy
 *   quotes        B3           quote lifecycle, TTL, immutable snapshot
 *   orders        B3           order state machine
 *   catalog       B3           products, SKUs, services
 *   payments      B4           gateway orchestration, server-side verify
 *   identity      B5           OTP, sessions, RBAC
 *   audit         B5           append-only audit trail
 *   customers     B5           customer 360, notes, flags
 *   workitems     B6           operator queues and task routing
 *   fulfillment   B6           checklists, gift-card assets, delivery
 *   suppliers     B6           supplier offers and purchase records
 * ==========================================================================*/
import { HealthModule } from './modules/health/health.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { FxModule } from './modules/fx/fx.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AuditModule } from './modules/audit/audit.module';
import { CustomersModule } from './modules/customers/customers.module';
import { WorkItemsModule } from './modules/workitems/workitems.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { GiftCardRequestsModule } from './modules/gift-card-requests/gift-card-requests.module';

@Module({
  imports: [
    /* Config first: it validates the environment before anything else boots. */
    AppConfigModule,

    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerOptions({
          isProduction: config.isProduction,
          isTest: config.isTest,
        }),
    }),

    /**
     * Global rate limiting. Two buckets: a burst allowance and a sustained one.
     * Endpoints that hand out secrets (OTP request/verify) narrow this further
     * with their own @Throttle decorator inside the identity module.
     */
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: 1_000, limit: 10 },
        { name: 'medium', ttl: 60_000, limit: 120 },
      ],
    }),

    /* ---- domain modules -------------------------------------------------- */
    HealthModule,
    PricingModule,
    FxModule,
    QuotesModule,
    OrdersModule,
    CatalogModule,
    PaymentsModule,
    IdentityModule,
    AuditModule,
    CustomersModule,
    WorkItemsModule,
    FulfillmentModule,
    SuppliersModule,
    GiftCardRequestsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyHeaderInterceptor },
  ],
})
export class AppModule {}
