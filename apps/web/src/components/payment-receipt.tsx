/** The customer-safe evidence filed for an international payment. */
export function PaymentReceipt({ orderNumber }: { readonly orderNumber: string }) {
  const source = `/api/orders/${encodeURIComponent(orderNumber)}/payment-receipt`;

  return (
    <div style={{ marginBlockStart: 16 }}>
      <div className="summary-line" style={{ marginBlockEnd: 8 }}>
        <span>رسید پرداخت</span>
        <strong>
          <a href={source} target="_blank" rel="noreferrer noopener">
            مشاهده در اندازهٔ کامل
          </a>
        </strong>
      </div>
      {/* The image endpoint needs the browser's session cookie. Next Image's
          optimizer deliberately does not forward authentication headers. */}
      <img
        src={source}
        alt="تصویر رسید پرداخت این سفارش"
        style={{
          display: "block",
          width: "100%",
          maxHeight: 420,
          objectFit: "contain",
          borderRadius: 12,
          border: "1px solid var(--line, #e2e8f0)",
        }}
      />
      <p className="muted" style={{ fontSize: 12, marginBlockEnd: 0 }}>
        همین تصویر به ایمیل اعلام نتیجه نیز پیوست شده است.
      </p>
    </div>
  );
}
