import { Badge, Ltr, formatJalaliDate } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";
import { api } from "@/lib/api";
import { BankAccountForm } from "./bank-account-form";
import { EmailForm } from "./email-form";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function AccountProfilePage() {
  const profile = await api.accountProfile();
  const { customer } = profile;

  return (
    <main className="page container" style={{ maxWidth: 640 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">اطلاعات حساب</h1>
      <AccountNav />

      <ProfileForm profile={profile} />

      {/* The API only ever returns masked identities; there is no raw mobile or
          e-mail to render here even if the page wanted one. */}
      <div className="card pad" style={{ marginBlockStart: 16 }}>
        <h3 style={{ marginTop: 0 }}>هویت حساب</h3>
        <div className="summary-line">
          <span>شماره موبایل</span>
          <strong className="profile-identity-value">
            <Ltr>{customer.maskedMobile ?? "—"}</Ltr>
            {customer.isMobileVerified ? <Badge tone="ok">تأیید شده</Badge> : null}
          </strong>
        </div>
        <EmailForm profile={profile} />
        <div className="summary-line">
          <span>کد مشتری</span>
          <strong><Ltr>{customer.customerCode}</Ltr></strong>
        </div>
        <div className="summary-line">
          <span>عضویت از</span>
          <strong>{formatJalaliDate(customer.createdAt, "d MMMM yyyy")}</strong>
        </div>
      </div>

      <BankAccountForm profile={profile} />
    </main>
  );
}
