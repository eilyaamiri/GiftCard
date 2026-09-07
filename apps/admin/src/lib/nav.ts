import type { StaffRole } from "@barat/contracts";
import {
  AUDIT_ROLES,
  BACK_OFFICE_ROLES,
  hasRole,
  CATALOG_WRITE_ROLES,
  CUSTOMER_VIEW_ROLES,
  FINANCIAL_WRITE_ROLES,
  OPERATOR_ROLES,
  QUEUE_VIEW_ROLES,
  REPORT_ROLES,
  SUPPORT_TICKET_ROLES,
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
      /**
       * The workspace where a task is actually worked — checklist, supplier
       * result, cost-variance approval, send. It lives under `/operator` because
       * that is one screen serving both desks, not two implementations to keep
       * in sync; a manager opening it gets the same view an operator sees plus
       * the controls their role unlocks. Without this link the only way in was
       * an unassigned row on «صف کارها», so a task already claimed by an
       * operator could not be reached from the back office at all.
       */
      { href: "/operator/tasks", label: "تسک‌ها", icon: "clipboard-list", roles: OPERATOR_ROLES },
      { href: "/work-queue", label: "صف کارها", icon: "list-checks", roles: QUEUE_VIEW_ROLES },
      { href: "/support", label: "تیکت‌های پشتیبانی", icon: "life-buoy", roles: SUPPORT_TICKET_ROLES },
      { href: "/gift-card-requests", label: "درخواست‌های کد گیفت‌کارت", icon: "gift", roles: QUEUE_VIEW_ROLES },
      { href: "/sla", label: "SLA و کیفیت", icon: "line-chart", roles: QUEUE_VIEW_ROLES },
      { href: "/reports", label: "گزارش‌ها", icon: "line-chart", roles: REPORT_ROLES },
      { href: "/audit", label: "گزارش رخدادها", icon: "shield-check", roles: AUDIT_ROLES },
      { href: "/settings", label: "تنظیمات", icon: "settings", roles: ["ADMIN"] },
    ],
  },
];

/**
 * The sidebar this role should see, wherever they are in the app.
 *
 * A manager works a task on the same `/operator/tasks/[id]` screen an operator
 * does, and used to lose the whole admin sidebar the moment they opened one —
 * the task looked like a different product rather than a page of their panel.
 * Both layouts now ask this, so the frame follows the person rather than the URL
 * while the page itself stays single-sourced.
 */
export function navFor(role: StaffRole): { sections: NavSection[]; title: string } {
  const source = hasRole(role, BACK_OFFICE_ROLES) ? ADMIN_NAV : OPERATOR_NAV;
  const sections = source
    .map((section) => ({ ...section, items: section.items.filter((item) => hasRole(role, item.roles)) }))
    .filter((section) => section.items.length > 0);

  return { sections, title: hasRole(role, BACK_OFFICE_ROLES) ? "پنل ادمین" : "میزکار اپراتور" };
}

export const OPERATOR_NAV: NavSection[] = [
  {
    title: "میزکار",
    items: [
      { href: "/operator", label: "میز من", icon: "layout-dashboard", roles: OPERATOR_ROLES },
      { href: "/operator/tasks", label: "تسک‌ها", icon: "list-checks", roles: OPERATOR_ROLES },
      { href: "/operator/support", label: "پشتیبانی و تیکت‌ها", icon: "life-buoy", roles: OPERATOR_ROLES },
      { href: "/operator/gift-card-requests", label: "درخواست‌های کد من", icon: "gift", roles: OPERATOR_ROLES },
      { href: "/operator/customers", label: "نمای ۳۶۰ مشتری", icon: "user-cog", roles: OPERATOR_ROLES },
      { href: "/operator/performance", label: "عملکرد و SLA", icon: "line-chart", roles: OPERATOR_ROLES },
    ],
  },
];
