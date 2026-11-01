import 'reflect-metadata';

import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { describe, expect, it, vi } from 'vitest';

/* Imported for decorator metadata only: the module reaches the shared Prisma
 * singleton at import time. */
vi.mock('@barat/database', () => ({ prisma: {}, Prisma: { JsonNull: null } }));

import { ROLES_METADATA_KEY, PUBLIC_METADATA_KEY } from '../identity/rbac/roles.decorator';
import {
  CatalogAdminController,
  GALLERY_THUMBNAILS_PER_MINUTE,
  GALLERY_THUMBNAILS_PER_SECOND,
} from './catalog-admin.controller';
import { adminGalleryListSchema } from './catalog.schemas';

const GLOBAL_PER_SECOND = 10;
const GLOBAL_PER_MINUTE = 120;

/**
 * One gallery page is a list of `<img>` tags, each its own request, sent
 * together. Under the global caps (10 a second) the first ten loaded and the
 * rest came back 429 and showed as broken pictures.
 */
describe('gallery thumbnail route', () => {
  const route = CatalogAdminController.prototype.galleryFile;

  it('allows a whole page of thumbnails at once, above the global cap', () => {
    const { pageSize } = adminGalleryListSchema.parse({ pageSize: '100' });

    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}short`, route)).toBe(GALLERY_THUMBNAILS_PER_SECOND);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}short`, route)).toBe(1_000);
    expect(GALLERY_THUMBNAILS_PER_SECOND).toBeGreaterThanOrEqual(pageSize);
    expect(GALLERY_THUMBNAILS_PER_SECOND).toBeGreaterThan(GLOBAL_PER_SECOND);
  });

  it('allows several pages in a minute', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}medium`, route)).toBe(GALLERY_THUMBNAILS_PER_MINUTE);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}medium`, route)).toBe(60_000);
    expect(GALLERY_THUMBNAILS_PER_MINUTE).toBeGreaterThan(GLOBAL_PER_MINUTE);
  });

  it('is still behind the admin guard, never public', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, CatalogAdminController)).toEqual(['ADMIN', 'OPS_MANAGER']);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, route)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, CatalogAdminController)).not.toBe(true);
  });

  it('leaves the other routes of the controller on the global caps', () => {
    const other = CatalogAdminController.prototype.listGallery;

    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}short`, other)).toBeUndefined();
  });
});
