import { OrdersList } from "@/components/orders-list";

export default function OrdersPage() {
  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">پیگیری</div>
      <h1 className="h2">سفارش‌های من</h1>
      <OrdersList />
    </main>
  );
}
