"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleUserRound, Headphones, Phone, Search, ShoppingBag } from "lucide-react";
import type { CustomerDto } from "@barat/contracts";
import { CategoryIcon } from "@/components/category-icon";
import { ContactSheet } from "@/components/contact-sheet";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { NavDropdown } from "@/components/nav-dropdown";
import type { Brand, Category } from "@/lib/catalog";
import { supportPhone, type SupportChannel } from "@/lib/support-channels";

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

  return (
    <>
      <header className="header">
        <div className="container header-topbar">
          <Link href="/" className="logo" aria-label="برات، صفحه اصلی">
            <span className="logo-mark">ب</span>
            <span>برات</span>
          </Link>

          {/* A plain GET form: the query lives in the URL like every other
              catalog filter, so it works before any JavaScript has loaded. */}
          <form action="/gift-cards" method="get" className="header-search" role="search" aria-label="جست‌وجوی سریع">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              name="q"
              maxLength={120}
              placeholder="جست‌وجوی گیفت‌کارت یا برند"
              aria-label="جست‌وجوی گیفت‌کارت یا برند"
            />
            <button type="submit" className="btn btn-teal header-search-submit">جست‌وجو</button>
          </form>

          <div className="header-end">
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
                items={brands.map((brand) => ({
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

      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <div className="logo"><span className="logo-mark">ب</span>برات</div>
            <p>ارزش جهانی، به زبان ریال.</p>
          </div>
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
          ) : (
            <div className="footer-support"><Headphones size={16} /> پشتیبانی همه‌روزه · پاسخ‌گویی سریع</div>
          )}
          <nav className="footer-sitemap" aria-label="نقشه سایت">
            <Link href="/orders">پیگیری سفارش</Link>
            <Link href="/help">راهنما</Link>
          </nav>
          <div>© ۱۴۰۵ برات</div>
        </div>
      </footer>

      {contact}
    </>
  );
}
