import { Module } from '@nestjs/common';

import { PricingController } from './pricing.controller';
import { PricingRuleService } from './pricing-rule.service';
import { PricingService } from './pricing.service';
import { SimulatorService } from './simulator.service';

/**
 * Pricing is deliberately a small module: the pure engine has no persistence
 * dependency, while the rule service owns versioned rule/audit writes and the
 * simulator is only an adapter around the same engine.
 */
@Module({
  controllers: [PricingController],
  providers: [PricingService, PricingRuleService, SimulatorService],
  exports: [PricingService, PricingRuleService],
})
export class PricingModule {}
