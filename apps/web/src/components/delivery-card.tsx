import type { OrderDetailDto } from "@barat/contracts";
import { Ltr, formatJalaliDate } from "@barat/ui";
import { RevealCode } from "@/components/reveal-code";

/**
 * What may be shown about a delivered asset.
 *
 * The card itself renders only `maskedCode`. The plaintext is never part of the
 * order response — it arrives, if at all, through `RevealCode`, which asks the
 * server for it on an explicit click and leaves an audit record behind. So a
 * page that is screenshotted, cached or left open still holds nothing but the
 * mask.
 *
 * Shared by the order page and the account order page: the customer looks for
 * their code in whichever of the two they happened to open, and a delivery
 * section that exists in only one of them is a delivery they cannot find.
 */
export function DeliveryCard({
  delivery,
  orderNumber,
}: {
  readonly delivery: NonNullable<OrderDetailDto["delivery"]>;
  readonly orderNumber: string;
}) {
  return (
    <div className="card pad" style={{ marginBlockStart: 16 }}>
      <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 0 }}>
        تحویل
      </h2>
      {delivery.maskedCode !== null ? (
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
      {/* The button appears only once the server says the card was sent. Any
        * earlier and it would offer something the reveal endpoint refuses — the
        * asset may still be under an operator's verification. */}
      {delivery.status === "SENT" ? (
        <>
          <p className="muted" style={{ fontSize: 12, marginBlockEnd: 0 }}>
            نمایش کد کامل ثبت می‌شود. آن را در جای امن نگه دارید و برای کسی نفرستید.
          </p>
          <RevealCode orderNumber={orderNumber} />
        </>
      ) : (
        <p className="muted" style={{ fontSize: 12, marginBlockEnd: 0 }}>
          کد کامل پس از تکمیل تحویل، در همین صفحه قابل نمایش خواهد بود.
        </p>
      )}
    </div>
  );
}
