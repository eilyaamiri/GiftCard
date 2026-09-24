import type { ComponentType } from "react";
import { BookOpen, CreditCard, Gift, LifeBuoy, type LucideProps } from "lucide-react";
import type { KbIconKey } from "@/lib/kb";

/**
 * The knowledge base's own small icon map, keyed by `KbIconKey`.
 *
 * Kept separate from `CategoryIcon` on purpose: that map is tied to
 * `CategoryIconKey`, the catalog admin's icon allow-list, and a KB category is
 * a different kind of thing with a different (much smaller) set of icons.
 */
const ICONS: Record<KbIconKey, ComponentType<LucideProps>> = {
  "book-open": BookOpen,
  "credit-card": CreditCard,
  gift: Gift,
  "life-buoy": LifeBuoy,
};

export function KbIcon({ iconKey, size = 18 }: Readonly<{ iconKey: KbIconKey; size?: number }>) {
  const Icon = ICONS[iconKey];
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" />;
}
