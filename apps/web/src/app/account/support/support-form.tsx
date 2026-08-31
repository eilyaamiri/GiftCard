"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, Input, Label, Select, Textarea } from "@barat/ui";
import { api, ApiClientError, createSupportRequestSchema, type AccountOrder } from "@/lib/api";

const TOPICS = [
  { value: "پیگیری سفارش", label: "پیگیری سفارش" },
  { value: "مشکل پرداخت", label: "مشکل پرداخت" },
  { value: "سایر", label: "سایر" },
] as const;

export function SupportForm({ orders, defaultOrderId }: { orders: readonly AccountOrder[]; defaultOrderId?: string }) {
  const router = useRouter();
  // A deep link may quote an order that is not on the first page of the list.
  const [orderId, setOrderId] = useState(orders.some((order) => order.id === defaultOrderId) ? (defaultOrderId ?? "") : "");
  const [subject, setSubject] = useState<string>(TOPICS[0].value);
  const [detail, setDetail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const composedSubject = detail.trim() ? `${subject} — ${detail.trim()}` : subject;
    const parsed = createSupportRequestSchema.safeParse({
      subject: composedSubject,
      message,
      ...(orderId ? { orderId } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "اطلاعات واردشده کامل نیست.");
      return;
    }

    setSending(true);
    try {
      const ticket = await api.createSupportRequest(parsed.data);
      setTicketCode(ticket.code);
      setMessage("");
      setDetail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارسال پیام ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setSending(false);
    }
  }

  if (ticketCode) {
    return (
      <div className="card pad" style={{ textAlign: "center" }}>
        <h3>پیام شما ارسال شد</h3>
        <p className="muted">شمارهٔ پیگیری: {ticketCode}</p>
        <button type="button" className="btn btn-outline" onClick={() => setTicketCode(null)}>ثبت درخواست دیگر</button>
      </div>
    );
  }

  return (
    <form className="card pad" onSubmit={submit} noValidate>
      <div className="field">
        <Label htmlFor="orderId">سفارش مرتبط (اختیاری)</Label>
        {/* Only the caller's own orders are listed, and the API re-checks that
            the id belongs to them before attaching the ticket. */}
        <Select
          id="orderId"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          options={[{ value: "", label: "بدون سفارش" }, ...orders.map((order) => ({ value: order.id, label: order.orderNumber }))]}
        />
      </div>
      <div className="field">
        <Label htmlFor="topic" required>موضوع</Label>
        <Select id="topic" value={subject} onChange={(e) => setSubject(e.target.value)} options={TOPICS.map((topic) => ({ value: topic.value, label: topic.label }))} />
      </div>
      <div className="field">
        <Label htmlFor="detail">توضیح کوتاه موضوع (اختیاری)</Label>
        <Input id="detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={80} />
      </div>
      <div className="field">
        <Label htmlFor="message" required>پیام</Label>
        <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="مشکل خود را شرح دهید..." invalid={Boolean(error)} />
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      <button type="submit" className="btn btn-primary" disabled={sending}>
        {sending ? "در حال ارسال..." : "ارسال پیام"}
      </button>
    </form>
  );
}
