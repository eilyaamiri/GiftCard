/**
 * Prisma error inspection without relying on `instanceof`.
 *
 * `Prisma.PrismaClientKnownRequestError` is re-exported through a namespace
 * alias, and TypeScript does not narrow `unknown` through it. A structural check
 * is both narrower in intent and immune to the client being loaded twice (which
 * breaks `instanceof` across module instances at runtime).
 */
export function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** P2002 — unique constraint violation. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return prismaErrorCode(error) === 'P2002';
}
