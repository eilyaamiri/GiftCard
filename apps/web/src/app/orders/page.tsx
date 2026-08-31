import Link from "next/link";
import { Badge, EmptyState, Ltr, formatJalaliDate, toPersianDigits } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { orderStatusView } from "@/lib/status";
import { tomanFromIrr } from "@/app/checkout/purchase";
import { listOrdersResponseSchema, type ListOrdersResponse } from "@barat/contracts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function pageFrom(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * The customer's own orders. No customer id is sent — the API scopes the list
 * to the session it authenticated, so there is no parameter here to tamper with.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession("/orders");
  const page = pageFrom((await searchParams)["page"]);
  const orders = await api.get<ListOrdersResponse>(`/api/orders?page=${page}&pageSize=${PAGE_SIZE}`, listOrdersResponseSchema);

  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">پیگیری</div>
      <h1 className="h2">سفارش‌های من</h1>

      {orders.items.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="هنوز سفارشی ثبت نشده"
          description="پس از خرید، سفارش‌های شما اینجا نمایش داده می‌شود."
          action={
            <Link className="btn btn-primary" href="/gift-cards">
              شروع خرید
            </Link>
          }
        />
      ) : (
        <div className="grid" style={{ marginBlockStart: 18, gap: 12 }}>
          {orders.items.map((order) => {
            const view = orderStatusView(order.status);
            return (
              <Link key={order.id} href={`/orders/${order.orderNumber}`} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 800 }}>{order.itemTitleFa}</p>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                    <Ltr>{order.orderNumber}</Ltr> · {formatJalaliDate(order.createdAt, "d MMMM yyyy")}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Ltr className="price">{tomanFromIrr(order.totalAmountIrr)}</Ltr>
                  <Badge tone={view.tone}>{view.label}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {orders.meta.totalPages > 1 ? (
        <nav className="filterbar" aria-label="صفحه‌بندی سفارش‌ها" style={{ justifyContent: "space-between" }}>
          {page > 1 ? (
            <Link className="btn btn-outline" href={`/orders?page=${page - 1}`}>
              صفحهٔ قبل
            </Link>
          ) : (
            <span />
          )}
          <span className="muted" style={{ fontSize: 13 }}>
            صفحهٔ {toPersianDigits(orders.meta.page)} از {toPersianDigits(orders.meta.totalPages)}
          </span>
          {page < orders.meta.totalPages ? (
            <Link className="btn btn-outline" href={`/orders?page=${page + 1}`}>
              صفحهٔ بعد
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
