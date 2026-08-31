/**
 * @barat/contracts — the shared vocabulary of Barat Pay.
 *
 * FROZEN after Phase 0. Every other package points at this one; nothing here
 * points back. It contains enums, Zod schemas, DTO types and money primitive
 * TYPES — and deliberately no financial logic.
 *
 * Conventions worth knowing before you use it:
 *   - Rial crosses the wire as a digit STRING (`IrrString`). JSON has no bigint.
 *   - Foreign currency crosses the wire as a fixed-point decimal STRING.
 *   - Percentages are integer basis points. 100 bps = 1%.
 *   - Timestamps are ISO-8601 UTC strings with an offset.
 */

export * from './enums';
export * from './money';
export * from './dto';
