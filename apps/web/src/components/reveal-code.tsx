"use client";
import { useCallback, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Ltr } from "@barat/ui";
import { api, ApiClientError, type RevealedDelivery } from "@/lib/api";

/**
 * Monospace and widely tracked: a redemption code is transcribed character by
 * character, and the body face renders `0`/`O` and `1`/`l` too much alike for
 * that. `Ltr` keeps it out of the page's right-to-left flow.
 */
const CODE_STYLE = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  letterSpacing: "0.06em",
} as const;

/**
 * The customer's own «نمایش کد».
 *
 * The plaintext lives in this component's state and nowhere else. It is never
 * written to storage, never put in the URL, and it disappears from memory the
 * moment the customer hides it or navigates away — hiding clears the state, so
 * showing it again is a fresh, separately audited request to the server.
 *
 * Nothing here decides whether the code may be seen. The button always asks;
 * the server checks that the order belongs to this session and that the card
 * was actually delivered, and answers with an error the customer can read.
 */
export function RevealCode({ orderNumber }: { readonly orderNumber: string }) {
  const [revealed, setRevealed] = useState<RevealedDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setRevealed(await api.revealOrderDelivery(orderNumber));
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : "نمایش کد ممکن نشد. کمی بعد دوباره تلاش کنید.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, orderNumber]);

  const hide = useCallback(() => {
    setRevealed(null);
    setError(null);
  }, []);

  if (revealed === null) {
    return (
      <>
        {error !== null ? (
          <div className="alert warn" style={{ marginBlockStart: 12 }} role="alert">
            {error}
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginBlockStart: 12 }}
          onClick={() => void reveal()}
          disabled={busy}
        >
          <Eye size={16} aria-hidden="true" /> {busy ? "در حال دریافت..." : "نمایش کد"}
        </button>
      </>
    );
  }

  return (
    <div style={{ marginBlockStart: 12 }}>
      {/* `aria-live` so a screen reader announces the code when it arrives; the
        * button that produced it keeps focus, so nothing is stolen. */}
      <div className="card pad" style={{ background: "var(--soft)" }} aria-live="polite">
        {revealed.code !== null ? (
          <div className="summary-line">
            <span>کد کارت</span>
            <strong style={CODE_STYLE}>
              <Ltr>{revealed.code}</Ltr>
            </strong>
          </div>
        ) : null}
        {revealed.pin !== null ? (
          <div className="summary-line">
            <span>پین</span>
            <strong style={CODE_STYLE}>
              <Ltr>{revealed.pin}</Ltr>
            </strong>
          </div>
        ) : null}
        {revealed.deliveryUrl !== null ? (
          <div className="summary-line">
            <span>لینک دریافت</span>
            <strong>
              <a href={revealed.deliveryUrl} target="_blank" rel="noreferrer noopener">
                باز کردن لینک
              </a>
            </strong>
          </div>
        ) : null}
        {revealed.code === null && revealed.deliveryUrl === null ? (
          <p className="muted" style={{ margin: 0 }}>
            این سفارش کدی برای نمایش ندارد؛ کارت مستقیماً به ایمیل شما ارسال شده است.
          </p>
        ) : null}
      </div>
      <button type="button" className="btn btn-outline" style={{ marginBlockStart: 12 }} onClick={hide}>
        <EyeOff size={16} aria-hidden="true" /> پنهان کردن
      </button>
    </div>
  );
}
