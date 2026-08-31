import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CATALOG_DATABASE } from './catalog.tokens';

/**
 * Catalog.
 *
 * Authorisation comes from the global `RolesGuard`: the public controller is
 * `@Public()`, the admin controller is `@Roles('ADMIN', 'OPS_MANAGER')`. There
 * is no module-local guard, so there is only one place RBAC can be wrong.
 */
@Module({
  controllers: [CatalogController, CatalogAdminController],
  providers: [{ provide: CATALOG_DATABASE, useValue: prisma }, CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
