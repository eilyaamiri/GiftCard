"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleUserRound, Headphones, Phone, Search, ShoppingBag } from "lucide-react";
import type { CustomerDto } from "@barat/contracts";
import { CategoryIcon } from "@/components/category-icon";
import { ContactSheet } from "@/components/contact-sheet";
import { BrandMark } from "@/app/gift-cards/_components/catalog-facets";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { NavDropdown } from "@/components/nav-dropdown";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Brand, Category } from "@/lib/catalog";
import { supportPhone, type SupportChannel } from "@/lib/support-channels";

/** Mirrors the shortlist length `catalog-sidebar.tsx` uses for the same flag. */
const TRENDING_BRANDS_SHOWN = 8;

function profileLabel(customer: CustomerDto): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return name || customer.maskedMobile || customer.maskedEmail || customer.customerCode;
}

/**
 * Public storefront chrome with a session-aware identity area.
 *
 * `/account` supplies its own admin-style shell, so rendering the marketing
 * header there would produce two navigation systems. Everywhere else the
 * server-resolved customer decides what is shown: a signed-in customer sees
 * their profile, never the login CTA. This is presentation only; every account
 * page and API request still performs its own server-side authorization.
 *
 * The phone-sized bottom bar is the one piece that survives into `/account`:
 * it is how a customer gets back out of the panel on a phone, so it renders
 * alongside the panel's own shell rather than being replaced by it.
 *
 * Contact has two entry points that open one sheet — the header button from
 * 768px up, the bottom bar's tab below it — so the open state lives here rather
 * than in either of them.
 */
export function SiteChrome({
  customer,
  supportChannels,
  categories,
  brands,
  children,
}: Readonly<{
  customer: CustomerDto | null;
  supportChannels: readonly SupportChannel[];
  categories: readonly Category[];
  brands: readonly Brand[];
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [contactOpen, setContactOpen] = useState(false);
  const phone = supportPhone(supportChannels);

  /* A ticket link inside the sheet navigates away; without this the sheet would
   * still be open on the page it landed on. */
  useEffect(() => setContactOpen(false), [pathname]);

  const contact = (
    <>
      <MobileBottomNav
        isSignedIn={customer !== null}
        channels={supportChannels}
        contactOpen={contactOpen}
        onOpenContact={() => setContactOpen(true)}
      />
      <ContactSheet
        open={contactOpen}
        channels={supportChannels}
        isSignedIn={customer !== null}
        onClose={() => setContactOpen(false)}
      />
    </>
  );

  if (pathname.startsWith("/account")) return <>{children}{contact}</>;

  const popularBrands = brands.filter((brand) => brand.isPopular).slice(0, TRENDING_BRANDS_SHOWN);
  const popularBrandIds = new Set(popularBrands.map((brand) => brand.id));
  const restBrands = brands.filter((brand) => !popularBrandIds.has(brand.id));

  return (
    <>
      <header className="header">
        <div className="container header-topbar">
          <div className="mobile-brand">
            <MobileNavDrawer categories={categories} brands={brands} />
            <span className="mobile-brand-word" aria-hidden="true">برات</span>
          </div>

          <Link href="/" className="logo" aria-label="برات، صفحه اصلی">
            <span className="logo-mark">ب</span>
            <span className="logo-word">برات</span>
          </Link>

          {/* A plain GET form: the query lives in the URL like every other
              catalog filter, so it works before any JavaScript has loaded. */}
          <form action="/search" method="get" className="header-search" role="search" aria-label="جست‌وجوی سریع">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              name="q"
              maxLength={120}
              placeholder="جست‌وجوی گیفت‌کارت یا سرویس خارجی"
              aria-label="جست‌وجوی گیفت‌کارت یا سرویس خارجی"
            />
            <button type="submit" className="btn btn-accent header-search-submit">جست‌وجو</button>
          </form>

          <div className="header-end">
            <ThemeToggle />

            {supportChannels.length > 0 ? (
              <button
                type="button"
                className="header-support"
                aria-label="تماس با ما"
                aria-haspopup="dialog"
                aria-expanded={contactOpen}
                onClick={() => setContactOpen(true)}
              >
                <Headphones size={19} aria-hidden="true" />
              </button>
            ) : null}

            {customer ? (
              <Link href="/account" className="customer-profile-link" aria-label="مشاهده پنل کاربری">
                <span className="customer-profile-avatar"><CircleUserRound size={20} /></span>
                <span className="customer-profile-copy">
                  <strong>{profileLabel(customer)}</strong>
                  <small>پنل کاربری</small>
                </span>
              </Link>
            ) : (
              <div className="header-actions">
                <Link className="btn btn-outline" href="/login">ورود</Link>
                <Link className="btn btn-primary" href="/gift-cards">
                  <ShoppingBag size={16} />
                  شروع خرید
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="header-navbar">
          <div className="container header-navbar-inner">
            <nav className="nav" aria-label="منوی اصلی">
              <NavDropdown
                label="دسته‌بندی‌ها"
                emptyLabel="دسته‌بندی‌ای موجود نیست"
                items={categories.map((category) => ({
                  key: category.id,
                  label: category.nameFa,
                  href: `/gift-cards?category=${encodeURIComponent(category.slug)}`,
                  icon: <CategoryIcon iconKey={category.iconKey} size={15} />,
                }))}
              />
              <NavDropdown
                label="برندها"
                emptyLabel="برندی موجود نیست"
                trending={
                  popularBrands.length > 0
                    ? {
                        heading: "محبوب‌ترین‌ها",
                        items: popularBrands.map((brand) => ({
                          key: brand.id,
                          label: brand.nameFa,
                          href: `/gift-cards?brand=${encodeURIComponent(brand.slug)}`,
                          icon: <BrandMark brand={brand} size={26} />,
                        })),
                      }
                    : undefined
                }
                items={restBrands.map((brand) => ({
                  key: brand.id,
                  label: brand.nameFa,
                  href: `/gift-cards?brand=${encodeURIComponent(brand.slug)}`,
                }))}
              />
              <Link href="/gift-cards" aria-current={pathname.startsWith("/gift-cards") ? "page" : undefined}>گیفت‌کارت‌ها</Link>
              <Link href="/services" aria-current={pathname.startsWith("/services") ? "page" : undefined}>پرداخت بین‌المللی</Link>
            </nav>
          </div>
        </div>
      </header>

      {children}

      {/* Three titled columns. The phone used to be a bare peer of the sitemap
        * and the copyright, which put the one number a customer might actually
        * dial in whatever gap the flex line had left — floating mid-footer,
        * under no heading and attached to nothing. It now heads its own
        * «تماس با ما» column, and the copyright drops to its own rule below. */}
      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <div className="logo"><span className="logo-mark">ب</span>برات</div>
            <p>ارزش جهانی، به زبان ریال.</p>
          </div>

          <nav className="footer-col" aria-label="نقشه سایت">
            <div className="footer-col-title">نقشه سایت</div>
            <Link href="/gift-cards">گیفت‌کارت‌ها</Link>
            <Link href="/services">پرداخت بین‌المللی</Link>
            <Link href="/brands">برندها</Link>
            <Link href="/orders">پیگیری سفارش</Link>
            <Link href="/help">راهنما</Link>
            <Link href={customer ? "/account" : "/login"}>{customer ? "پنل کاربری" : "ورود"}</Link>
          </nav>

          <div className="footer-col footer-contact">
            <div className="footer-col-title">تماس با ما</div>
            {/* The number an admin entered, or the generic line when none is
              * published — never an empty "call us" with nothing to call. */}
            {phone ? (
              <a className="footer-phone" href={phone.href}>
                <Phone size={16} aria-hidden="true" />
                <span className="footer-phone-copy">
                  <strong dir="ltr">{phone.number}</strong>
                  {phone.description ? <small>{phone.description}</small> : null}
                </span>
              </a>
            ) : null}
            <div className="footer-support"><Headphones size={16} /> پشتیبانی همه‌روزه · پاسخ‌گویی سریع</div>
          </div>
        </div>
        <div className="container footer-legal">
          <span>© ۱۴۰۵ برات</span>
        </div>
      </footer>

      {contact}
    </>
  );
}
