import Link from "next/link";
import { Ltr } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";

export default function AccountPage() {
  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">سلام</h1>
      <AccountNav />
      <div className="grid" style={{ gridTemplateColumns: "repeat(2,1fr)", gap: 14 }}>
        <div className="card pad">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>سفارش‌های فعال</p>
          <p style={{ fontSize: 28, fontWeight: 900, margin: "6px 0 0", color: "var(--navy)" }}>۲</p>
        </div>
        <div className="card pad">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>مجموع خرید</p>
          <p style={{ fontSize: 22, fontWeight: 900, margin: "6px 0 0", color: "var(--navy)" }}><Ltr>۱۰٬۶۸۰٬۰۰۰ تومان</Ltr></p>
        </div>
      </div>
      <div className="card pad" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>دسترسی سریع</h3>
        <div className="hero-actions" style={{ marginTop: 0 }}>
          <Link className="btn btn-outline" href="/account/orders">سفارش‌های من</Link>
          <Link className="btn btn-outline" href="/account/profile">ویرایش اطلاعات</Link>
          <Link className="btn btn-outline" href="/account/support">تماس با پشتیبانی</Link>
        </div>
      </div>
    </main>
  );
}
