import type { OrderDetailDto } from "@barat/contracts";
import { Ltr, formatJalaliDate } from "@barat/ui";
import { RevealCode } from "@/components/reveal-code";
import { PaymentReceipt } from "@/components/payment-receipt";

/**
 * What may be shown about a delivered asset.
 *
 * This card is server-rendered and holds nothing but the mask. The plaintext is
 * never part of the order response and never reaches the HTML: it arrives, if
 * at all, inside `RevealCode`, which asks the server for it from the browser
 * and leaves an audit record behind. So a page that is cached or logged holds
 * only `ABCD-XXXX-XXXX-8271`, even though the customer sees the whole code.
 *
 * Shared by the order page and the account order page: the customer looks for
 * their code in whichever of the two they happened to open, and a delivery
 * section that exists in only one of them is a delivery they cannot find.
 */
export function DeliveryCard({
  delivery,
  orderNumber,
  paymentReceiptAvailable = false,
  purpose = "GIFT_CARD",
}: {
  readonly delivery: NonNullable<OrderDetailDto["delivery"]>;
  readonly orderNumber: string;
  readonly paymentReceiptAvailable?: boolean;
  readonly purpose?: "GIFT_CARD" | "INTERNATIONAL_PAYMENT";
}) {
  const sent = delivery.status === "SENT";
  const isPayment = purpose === "INTERNATIONAL_PAYMENT";

  return (
    <div className="card pad" style={{ marginBlockStart: 16 }}>
      <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 0 }}>
        تحویل
      </h2>
      {/* Once the card is sent the full code is right below, so the mask would
        * only be the same code said worse. It stays while delivery is still in
        * progress, as proof that a card is on file. */}
      {!sent && delivery.maskedCode !== null ? (
        <div className="summary-line">
          <span>کد تحویل‌شده</span>
          <strong>
            <Ltr>{delivery.maskedCode}</Ltr>
          </strong>
        </div>
      ) : null}
      {delivery.recipientEmailMasked !== null ? (
        <div className="summary-line">
          <span>ارسال به</span>
          <strong>
            <Ltr>{delivery.recipientEmailMasked}</Ltr>
          </strong>
        </div>
      ) : null}
      {delivery.sentAt !== null ? (
        <div className="summary-line">
          <span>زمان ارسال</span>
          <strong>{formatJalaliDate(delivery.sentAt)}</strong>
        </div>
      ) : null}
      {delivery.expiryDate !== null ? (
        <div className="summary-line">
          <span>اعتبار تا</span>
          <strong>{formatJalaliDate(delivery.expiryDate, "d MMMM yyyy")}</strong>
        </div>
      ) : null}
      {/* The server exposes a receipt only after delivery has reached SENT, and
        * only for an international payment. */}
      {sent ? (
        <>
          <p className="muted" style={{ fontSize: 12, marginBlockEnd: 0 }}>
            {isPayment
              ? "نتیجهٔ پرداخت شما ثبت شده است. جزئیات آن را از همین بخش ببینید."
              : "نمایش کد کامل ثبت می‌شود. آن را در جای امن نگه دارید و برای کسی نفرستید."}
          </p>
          <RevealCode orderNumber={orderNumber} variant={purpose} />
          {paymentReceiptAvailable ? <PaymentReceipt orderNumber={orderNumber} /> : null}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 12, marginBlockEnd: 0 }}>
          {isPayment
            ? "نتیجهٔ پرداخت پس از تکمیل تحویل، در همین صفحه نمایش داده می‌شود."
            : "کد کامل پس از تکمیل تحویل، در همین صفحه قابل نمایش خواهد بود."}
        </p>
      )}
    </div>
  );
}
