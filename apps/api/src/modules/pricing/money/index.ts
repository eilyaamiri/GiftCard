/**
 * The single implementation of the money helper signatures declared in
 * `@barat/contracts/money/helpers`. Contracts is a vocabulary and holds no
 * financial logic, so the arithmetic lives here, inside the pricing workstream
 * that owns AGENTS.md rules 2, 3 and 13 and carries the unit tests for them.
 */
export {
  applyBps,
  applyBpsToDecimal,
  decimalToIrr,
  decimalToPlainString,
  irrToToman,
  quantizeToScale,
  ratioToBps,
  roundToStep,
  roundUpToStep,
  sumIrr,
  tomanToIrr,
} from './money';
