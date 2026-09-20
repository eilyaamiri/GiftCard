import type { ComponentType } from "react";
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
  type LucideProps,
} from "lucide-react";
import type { CategoryIconKey } from "@/lib/catalog";

/**
 * The category icons, by `iconKey`.
 *
 * An operator picks the key from an allow-list in the admin panel and the same
 * allow-list is what this map is keyed by, so a category can never name an icon
 * that is not here. They are all lucide, the library the rest of the site
 * already draws with — a second icon set for one feature would be a second
 * visual language.
 */
const ICONS: Record<CategoryIconKey, ComponentType<LucideProps>> = {
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

export function CategoryIcon({
  iconKey,
  size = 18,
}: Readonly<{ iconKey: CategoryIconKey | null; size?: number }>) {
  const Icon = iconKey === null ? Gift : ICONS[iconKey];
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" />;
}
