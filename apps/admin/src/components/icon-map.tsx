import {
  LayoutDashboard,
  ShoppingBag,
  ReceiptText,
  CreditCard,
  Package,
  Globe,
  Truck,
  LineChart,
  SlidersHorizontal,
  FlaskConical,
  ListChecks,
  ShieldCheck,
  Settings,
  Search,
  Bell,
  Gift,
  UserCog,
  MessageSquareWarning,
  HelpCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "shopping-bag": ShoppingBag,
  "receipt-text": ReceiptText,
  "credit-card": CreditCard,
  package: Package,
  globe: Globe,
  truck: Truck,
  "line-chart": LineChart,
  "sliders-horizontal": SlidersHorizontal,
  "flask-conical": FlaskConical,
  "list-checks": ListChecks,
  "shield-check": ShieldCheck,
  settings: Settings,
  search: Search,
  bell: Bell,
  gift: Gift,
  "user-cog": UserCog,
  "message-square-warning": MessageSquareWarning,
  "help-circle": HelpCircle,
  "rotate-ccw": RotateCcw,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Cmp = ICONS[name] ?? HelpCircle;
  return <Cmp size={size} strokeWidth={2} aria-hidden="true" />;
}
