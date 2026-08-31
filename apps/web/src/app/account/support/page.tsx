import { Badge, formatJalaliDate } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";
import { api } from "@/lib/api";
import { supportStatusView } from "@/lib/status";
import { SupportForm } from "./support-form";

export const dynamic = "force-dynamic";

export default async function AccountSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const rawOrderId = params["orderId"];
  const defaultOrderId = Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId;

  const [tickets, orders] = await Promise.all([api.supportRequests(), api.accountOrders({ pageSize: 50 })]);
  const orderNumbers = new Map(orders.items.map((order) => [order.id, order.orderNumber]));

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">پشتیبانی</h1>
      <AccountNav />

      <SupportForm orders={orders.items} defaultOrderId={defaultOrderId} />

      {tickets.length > 0 ? (
        <>
          <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 26 }}>درخواست‌های شما</h2>
          <div className="grid" style={{ gap: 12 }}>
            {tickets.map((ticket) => {
              const view = supportStatusView(ticket.status);
              return (
                <div key={ticket.id} className="card pad">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <strong>{ticket.subject}</strong>
                    <Badge tone={view.tone}>{view.label}</Badge>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                    شمارهٔ پیگیری: {ticket.code} · {formatJalaliDate(ticket.createdAt)}
                    {ticket.orderId ? ` · سفارش ${orderNumbers.get(ticket.orderId) ?? ""}` : ""}
                  </p>
                  {ticket.resolutionNote ? <p style={{ margin: "8px 0 0" }}>{ticket.resolutionNote}</p> : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </main>
  );
}
