import { Badge, Ltr } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";

const payments = [
  { id: "p1", orderNumber: "ORD-4F82AC19", amount: "۲٬۹۲۰٬۰۰۰ تومان", providerRefId: "ZP-9081234", status: "موفق" as const },
  { id: "p2", orderNumber: "ORD-11A0C902", amount: "۶٬۴۸۰٬۰۰۰ تومان", providerRefId: null, status: "در انتظار" as const },
];

export default function AccountPaymentsPage() {
  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">پرداخت‌ها</h1>
      <AccountNav />
      <div className="grid" style={{ gap: 12 }}>
        {payments.map((payment) => (
          <div key={payment.id} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 800 }}><Ltr>{payment.orderNumber}</Ltr></p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                {payment.providerRefId ? <>شماره پیگیری بانک: <Ltr>{payment.providerRefId}</Ltr></> : "در انتظار تأیید"}
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Ltr className="price">{payment.amount}</Ltr>
              <Badge tone={payment.status === "موفق" ? "ok" : "wait"}>{payment.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
