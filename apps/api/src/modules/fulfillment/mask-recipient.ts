/**
 * Mask an e-mail address for storage in `DeliveryAttempt.recipientMasked` and for
 * any operator-facing read model. A full address is personal data and must never
 * be written to the delivery log.
 *
 *   `sara.ahmadi@example.com` -> `sa****@example.com`
 */
export function maskEmail(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return '****';
  }

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}****@${domain}`;
}
