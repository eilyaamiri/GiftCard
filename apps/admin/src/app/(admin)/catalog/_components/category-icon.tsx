import {
  AppWindow,
  BookOpen,
  Clapperboard,
  Cpu,
  CreditCard,
  Dumbbell,
  Ellipsis,
  Flower2,
  Gamepad2,
  Gift,
  Joystick,
  Plane,
  ShoppingBag,
  Smartphone,
  Sofa,
  Sparkles,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { CategoryIconKey } from "../_lib/catalog-contracts";

/**
 * The category icons, drawn from the same lucide set the sidebar already uses.
 * A separate map from `components/icon-map.tsx` because these are the
 * storefront's vocabulary, not the panel's navigation — but deliberately the
 * same family, so nothing here looks imported from somewhere else.
 */
const CATEGORY_ICONS: Record<CategoryIconKey, LucideIcon> = {
  sparkles: Sparkles,
  "gamepad-2": Gamepad2,
  joystick: Joystick,
  clapperboard: Clapperboard,
  "shopping-bag": ShoppingBag,
  smartphone: Smartphone,
  "app-window": AppWindow,
  "book-open": BookOpen,
  utensils: Utensils,
  plane: Plane,
  dumbbell: Dumbbell,
  cpu: Cpu,
  sofa: Sofa,
  "flower-2": Flower2,
  "credit-card": CreditCard,
  wallet: Wallet,
  ellipsis: Ellipsis,
  gift: Gift,
};

/**
 * `name` is whatever the database holds, which an older build may not know.
 * An unknown key falls back to the gift icon rather than rendering nothing —
 * the same fallback the storefront applies.
 */
export function CategoryIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Cmp = CATEGORY_ICONS[name as CategoryIconKey] ?? Gift;
  return <Cmp size={size} strokeWidth={2} className="taxonomy-icon" aria-hidden="true" />;
}
