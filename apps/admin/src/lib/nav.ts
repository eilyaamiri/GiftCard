import type { StaffRole } from "@barat/contracts";
import {
  AUDIT_ROLES,
  BACK_OFFICE_ROLES,
  CATALOG_WRITE_ROLES,
  CUSTOMER_VIEW_ROLES,
  FINANCIAL_WRITE_ROLES,
  OPERATOR_ROLES,
  QUEUE_VIEW_ROLES,
  REPORT_ROLES,
} from "@/lib/api";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /**
   * Roles that may see this link. Server-side RBAC is the real gate — this only
   * hides. Each entry reuses the same constant its page passes to `requireRole`,
   * so a link can never advertise a page that redirects to `?reason=forbidden`.
   */
  roles: readonly StaffRole[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavSection[] = [
  {
    title: "نمای‌کلی",
    items: [{ href: "/dashboard", label: "داشبورد", icon: "layout-dashboard", roles: BACK_OFFICE_ROLES }],
  },
  {
    title: "عملیات فروش",
    items: [
      { href: "/orders", label: "سفارش‌ها", icon: "shopping-bag", roles: BACK_OFFICE_ROLES },
      { href: "/quotes", label: "استعلام‌ها", icon: "receipt-text", roles: BACK_OFFICE_ROLES },
      { href: "/payments", label: "پرداخت‌ها", icon: "credit-card", roles: BACK_OFFICE_ROLES },
      { href: "/customers", label: "نمای ۳۶۰ مشتری", icon: "user-cog", roles: CUSTOMER_VIEW_ROLES },
    ],
  },
  {
    title: "کاتالوگ و تأمین",
    items: [
      { href: "/catalog", label: "کاتالوگ", icon: "package", roles: CATALOG_WRITE_ROLES },
      { href: "/services", label: "سرویس‌های بین‌المللی", icon: "globe", roles: CATALOG_WRITE_ROLES },
      { href: "/suppliers", label: "تأمین‌کنندگان", icon: "truck", roles: CATALOG_WRITE_ROLES },
    ],
  },
  {
    title: "قیمت‌گذاری و ارز",
    items: [
      { href: "/fx", label: "نرخ ارز", icon: "line-chart", roles: FINANCIAL_WRITE_ROLES },
      { href: "/pricing-rules", label: "قواعد قیمت‌گذاری", icon: "sliders-horizontal", roles: FINANCIAL_WRITE_ROLES },
      { href: "/simulator", label: "شبیه‌ساز استعلام", icon: "flask-conical", roles: FINANCIAL_WRITE_ROLES },
    ],
  },
  {
    title: "عملیات و بازرسی",
    items: [
      { href: "/work-queue", label: "صف کارها", icon: "list-checks", roles: QUEUE_VIEW_ROLES },
      { href: "/sla", label: "SLA و کیفیت", icon: "line-chart", roles: QUEUE_VIEW_ROLES },
      { href: "/reports", label: "گزارش‌ها", icon: "line-chart", roles: REPORT_ROLES },
      { href: "/audit", label: "گزارش رخدادها", icon: "shield-check", roles: AUDIT_ROLES },
      { href: "/settings", label: "تنظیمات", icon: "settings", roles: ["ADMIN"] },
    ],
  },
];

export const OPERATOR_NAV: NavSection[] = [
  {
    title: "میزکار",
    items: [
      { href: "/operator", label: "میز من", icon: "layout-dashboard", roles: OPERATOR_ROLES },
      { href: "/operator/tasks", label: "تسک‌ها", icon: "list-checks", roles: OPERATOR_ROLES },
      { href: "/operator/customers", label: "نمای ۳۶۰ مشتری", icon: "user-cog", roles: OPERATOR_ROLES },
      { href: "/operator/performance", label: "عملکرد و SLA", icon: "line-chart", roles: OPERATOR_ROLES },
    ],
  },
];
