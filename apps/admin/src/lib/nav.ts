import type { StaffRole } from "@barat/contracts";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Roles that may see this link. Server-side RBAC is the real gate — this only hides. */
  roles: StaffRole[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const ALL_STAFF: StaffRole[] = ["ADMIN", "MANAGEMENT", "OPS_MANAGER", "OPERATOR", "FINANCE", "SUPPORT", "VIEWER"];
const BACK_OFFICE: StaffRole[] = ["ADMIN", "MANAGEMENT", "OPS_MANAGER", "FINANCE", "VIEWER"];
const OPS: StaffRole[] = ["ADMIN", "OPS_MANAGER", "OPERATOR"];

export const ADMIN_NAV: NavSection[] = [
  {
    title: "نمای‌کلی",
    items: [{ href: "/dashboard", label: "داشبورد", icon: "layout-dashboard", roles: BACK_OFFICE }],
  },
  {
    title: "عملیات فروش",
    items: [
      { href: "/orders", label: "سفارش‌ها", icon: "shopping-bag", roles: BACK_OFFICE },
      { href: "/quotes", label: "استعلام‌ها", icon: "receipt-text", roles: BACK_OFFICE },
      { href: "/payments", label: "پرداخت‌ها", icon: "credit-card", roles: [...BACK_OFFICE, "SUPPORT"] },
    ],
  },
  {
    title: "کاتالوگ و تأمین",
    items: [
      { href: "/catalog", label: "کاتالوگ", icon: "package", roles: BACK_OFFICE },
      { href: "/services", label: "سرویس‌های بین‌المللی", icon: "globe", roles: BACK_OFFICE },
      { href: "/suppliers", label: "تأمین‌کنندگان", icon: "truck", roles: BACK_OFFICE },
    ],
  },
  {
    title: "قیمت‌گذاری و ارز",
    items: [
      { href: "/fx", label: "نرخ ارز", icon: "line-chart", roles: BACK_OFFICE },
      { href: "/pricing-rules", label: "قواعد قیمت‌گذاری", icon: "sliders-horizontal", roles: ["ADMIN", "MANAGEMENT", "OPS_MANAGER"] },
      { href: "/simulator", label: "شبیه‌ساز استعلام", icon: "flask-conical", roles: ["ADMIN", "MANAGEMENT", "OPS_MANAGER", "FINANCE"] },
    ],
  },
  {
    title: "عملیات و بازرسی",
    items: [
      { href: "/work-queue", label: "صف کارها", icon: "list-checks", roles: OPS },
      { href: "/audit", label: "گزارش رخدادها", icon: "shield-check", roles: ["ADMIN", "MANAGEMENT"] },
      { href: "/settings", label: "تنظیمات", icon: "settings", roles: ["ADMIN"] },
    ],
  },
];

export const OPERATOR_NAV: NavSection[] = [
  {
    title: "میزکار",
    items: [
      { href: "/operator", label: "میز من", icon: "layout-dashboard", roles: ALL_STAFF },
      { href: "/operator/tasks", label: "تسک‌ها", icon: "list-checks", roles: ALL_STAFF },
    ],
  },
];
