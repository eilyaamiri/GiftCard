import Link from "next/link";
import { customerDisplayName, requireSession } from "@/lib/session";
import { AccountSidebarNav } from "@/components/account-sidebar-nav";
import { AccountTopbarActions } from "@/components/account-topbar-actions";

export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const customer = await requireSession();
  const name = customerDisplayName(customer);
  const initial = name.slice(0, 1);

  return (
    <div className="account-shell">
      <aside className="account-sidebar" aria-label="منوی پنل کاربری">
        <Link href="/" className="account-brand" aria-label="برات، صفحه اصلی">
          <span className="logo-mark">ب</span>
          <span><strong>برات</strong><small>پنل کاربری</small></span>
        </Link>
        <AccountSidebarNav />
        <div className="account-sidebar-footer">
          <div className="account-sidebar-user"><span className="account-avatar">{initial}</span><span><strong>{name}</strong><small>حساب فعال</small></span></div>
        </div>
      </aside>
      <section className="account-main">
        <header className="account-topbar">
          <div><span className="eyebrow">پنل کاربری</span><h1>فضای امن شما در برات</h1></div>
          <AccountTopbarActions name={name} customerCode={customer.customerCode} initial={initial} />
        </header>
        <div className="account-content">{children}</div>
      </section>
    </div>
  );
}
