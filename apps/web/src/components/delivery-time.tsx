import { deliveryTimeLabelFa } from "@barat/contracts";
import { Clock3 } from "lucide-react";

/**
 * The advertised delivery time, shown beside a product's order button.
 *
 * Renders nothing when the product has no delivery time set, or when the
 * stored value is not one of the presets — a label the storefront cannot word
 * is better left out than guessed at, since the customer reads it as a promise.
 * No hooks, so server and client pages can both use it.
 */
export function DeliveryTime({ minutes }: { readonly minutes: number | null | undefined }) {
  const label = deliveryTimeLabelFa(minutes);
  if (label === null) return null;
  return (
    <p className="delivery-time">
      <Clock3 size={15} aria-hidden="true" />
      <span>زمان تحویل:</span>
      <strong>{label}</strong>
    </p>
  );
}
