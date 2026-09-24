import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

/* Imported for decorator metadata only. The module reaches the shared Prisma
 * singleton at import time, which would demand a live DATABASE_URL for a test
 * that never touches a database. */
vi.mock('@barat/database', () => ({ prisma: {}, Prisma: { JsonNull: null } }));

import { PUBLIC_METADATA_KEY, ROLES_METADATA_KEY } from '../identity/rbac/roles.decorator';
import { AdminKbController } from './admin-kb.controller';
import { KbController } from './kb.controller';

/**
 * The two halves of the KB surface have opposite access rules, and getting
 * either backwards is the kind of mistake that only shows up in production: a
 * private admin route open to anyone, or a help page that no signed-out
 * visitor can load.
 */
describe('kb route wiring', () => {
  it('leaves the published content readable without a session', () => {
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, KbController.prototype.list)).toBe(true);
  });

  it('never makes the admin controller public', () => {
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController.prototype.createCategory)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController.prototype.updateCategory)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController.prototype.removeCategory)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController.prototype.createArticle)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController.prototype.updateArticle)).not.toBe(true);
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, AdminKbController.prototype.removeArticle)).not.toBe(true);
  });

  it('restricts editing to ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, AdminKbController)).toEqual(['ADMIN']);
  });
});
