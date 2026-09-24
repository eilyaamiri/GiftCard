"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Brand, Category } from "@/lib/catalog";
import { SERVICE_CATEGORIES } from "@/lib/service-categories";

/**
 * The header's nav links, collapsed into a slide-in drawer below 768px — the
 * width where `.header-navbar` itself goes `display:none`. Search moves to
 * its own row under the header at this width instead of living in here. A
 * native `<dialog>` for the same reasons as `AccountMobileDrawer`: the focus
 * trap, the inert background and Escape all come for free instead of being
 * hand-rolled.
 */
export function MobileNavDrawer({
  categories,
  brands,
}: Readonly<{
  categories: readonly Category[];
  brands: readonly Brand[];
}>) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /* A picked link navigates away; without this the drawer would still be open
   * on the page it landed on. */
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        className="mobile-nav-drawer-trigger"
        aria-label="باز کردن منو"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu size={21} aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        className="mobile-nav-drawer"
        aria-label="منوی ناوبری"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          /* The dialog element fills the viewport and the panel sits inside it, so
           * a click that lands on the dialog itself is a click on the backdrop. */
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="mobile-nav-drawer-panel">
          <div className="mobile-nav-drawer-head">
            <Link href="/" className="mobile-nav-drawer-brand" aria-label="برات، صفحه اصلی">
              <span className="logo-mark">ب</span>
              <span>برات</span>
            </Link>
            <button autoFocus type="button" className="mobile-nav-drawer-close" aria-label="بستن منو" onClick={() => setOpen(false)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <nav className="mobile-nav-drawer-nav" aria-label="ناوبری اصلی">
            <details className="mobile-nav-drawer-group">
              <summary>
                <span>دسته‌بندی‌ها</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              {categories.length === 0 ? (
                <p className="mobile-nav-drawer-empty">دسته‌بندی‌ای موجود نیست</p>
              ) : (
                <ul>
                  {categories.map((category) => (
                    <li key={category.id}>
                      <Link href={`/gift-cards?category=${encodeURIComponent(category.slug)}`}>
                        <CategoryIcon iconKey={category.iconKey} size={15} />
                        <span>{category.nameFa}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <details className="mobile-nav-drawer-group">
              <summary>
                <span>برندها</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              {brands.length === 0 ? (
                <p className="mobile-nav-drawer-empty">برندی موجود نیست</p>
              ) : (
                <ul>
                  {brands.map((brand) => (
                    <li key={brand.id}>
                      <Link href={`/gift-cards?brand=${encodeURIComponent(brand.slug)}`}>{brand.nameFa}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <details className="mobile-nav-drawer-group">
              <summary>
                <span>پرداخت بین‌المللی</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <ul>
                {SERVICE_CATEGORIES.map((category) => (
                  <li key={category.slug}>
                    <Link href={`/services?category=${encodeURIComponent(category.slug)}`}>
                      <span>{category.labelFa}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>

            <Link href="/gift-cards" className="mobile-nav-drawer-link">گیفت‌کارت‌ها</Link>
            <Link href="/services" className="mobile-nav-drawer-link">پرداخت بین‌المللی</Link>
            <Link href="/help" className="mobile-nav-drawer-link">راهنما</Link>
          </nav>

          {/* The header's theme control is hidden at this width, so the drawer
              is where a phone reaches it — with the labels shown, since there
              is room for them here. */}
          <div className="mobile-nav-drawer-theme">
            <span className="mobile-nav-drawer-theme-title">حالت نمایش</span>
            <ThemeToggle withLabels />
          </div>
        </div>
      </dialog>
    </>
  );
}
