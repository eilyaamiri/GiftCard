/** Produce a display-safe code such as `ABCD-XXXX-XXXX-8271`. */
export function maskGiftCardCode(code: string): string {
  const value = code.trim();
  if (value.length <= 8) {
    return 'X'.repeat(Math.max(value.length, 4));
  }

  const compact = value.replace(/[\s-]/gu, '');
  if (compact.length <= 8) {
    return 'X'.repeat(Math.max(compact.length, 4));
  }

  const prefix = compact.slice(0, 4);
  const suffix = compact.slice(-4);
  const hiddenLength = compact.length - 8;
  const hiddenGroups = Math.max(1, Math.ceil(hiddenLength / 4));
  return [prefix, ...Array.from({ length: hiddenGroups }, () => 'XXXX'), suffix].join('-');
}
