import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CrossRateService } from '../fx/cross-rate.service';
import { FxAggregatorService } from '../fx/fx-aggregator.service';
import { FxModule } from '../fx/fx.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SUPPLIER_PRICE_LOOKUP } from '../suppliers/suppliers.types';
import { PricingRuleService } from '../pricing/pricing-rule.service';
import { PricingService } from '../pricing/pricing.service';
import {
  QUOTES_DATABASE,
  QUOTE_CROSS_RATE_SERVICE,
  QUOTE_FX_AGGREGATOR,
  QUOTE_PRICING_SERVICE,
  QUOTE_SUPPLIER_PRICE_LOOKUP,
} from './quote.ports';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

/**
 * Quotes.
 *
 * `QuotesService` depends on the FX aggregator and the pricing engine through
 * tokens, never on the concrete classes (AGENTS.md rules 5-7). Binding happens
 * here, in the composition root, so a test can substitute a deterministic rate
 * and a stub engine without a database or a provider.
 *
 * `PricingService` and `PricingRuleService` have no constructor dependencies,
 * so they are instantiated locally rather than importing a pricing module this
 * workstream does not own.
 */
@Module({
  imports: [AuditModule, CatalogModule, FxModule, SuppliersModule],
  controllers: [QuotesController],
  providers: [
    { provide: QUOTES_DATABASE, useValue: prisma },
    PricingService,
    PricingRuleService,
    { provide: QUOTE_PRICING_SERVICE, useExisting: PricingService },
    { provide: QUOTE_FX_AGGREGATOR, useExisting: FxAggregatorService },
    { provide: QUOTE_CROSS_RATE_SERVICE, useExisting: CrossRateService },
    { provide: QUOTE_SUPPLIER_PRICE_LOOKUP, useExisting: SUPPLIER_PRICE_LOOKUP },
    QuotesService,
  ],
  exports: [QuotesService],
})
export class QuotesModule {}
