"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@barat/ui";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { InlineError, messageFor } from "../../../_components/error-notice";
import {
  DELIVERY_ASSET_TYPE_LABEL,
  DELIVERY_STATUS_LABEL,
  fulfillment,
  hasRevealableSecret,
  type GiftCardAssetView,
  type RevealedSecret,
} from "../../../_lib/fulfillment";

/** The plaintext disappears on its own, so an unattended screen stops showing it. */
const REVEAL_VISIBLE_MS = 45_000;

export function AssetPanel({
  workItemId,
  assets,
  canOperate,
}: {
  workItemId: string;
  assets: readonly GiftCardAssetView[];
  canOperate: boolean;
}) {
  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>دارایی تحویل</h3>
        <span>{toPersianDigits(assets.length)} مورد</span>
      </div>

      {assets.length === 0 ? (
        <p className="empty-hint">هنوز دارایی تحویلی برای این سفارش ثبت نشده است.</p>
      ) : (
        assets.map((asset) => (
          <AssetRow key={asset.id} workItemId={workItemId} asset={asset} canOperate={canOperate} />
        ))
      )}
    </div>
  );
}

function AssetRow({
  workItemId,
  asset,
  canOperate,
}: {
  workItemId: string;
  asset: GiftCardAssetView;
  canOperate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forget = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setSecret(null);
    setReason("");
    setError(null);
  }, []);

  // The plaintext must not survive navigation away from the task either.
  useEffect(() => forget, [forget]);

  async function handleReveal() {
    setError(null);
    setRevealing(true);
    try {
      const revealed = await fulfillment.revealAsset(workItemId, asset.id, reason.trim());
      setSecret(revealed);
      timer.current = setTimeout(forget, REVEAL_VISIBLE_MS);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setRevealing(false);
    }
  }

  const revealable = hasRevealableSecret(asset.assetType);

  return (
    <div className="kv-list" style={{ marginBlockEnd: 14 }}>
      <div className="kv-row">
        <span>نوع</span>
        <span>{DELIVERY_ASSET_TYPE_LABEL[asset.assetType]}</span>
      </div>
      <div className="kv-row">
        <span>وضعیت تحویل</span>
        <span>{DELIVERY_STATUS_LABEL[asset.status]}</span>
      </div>
      {asset.maskedCode ? (
        <div className="kv-row">
          <span>کد (پوشیده)</span>
          <span className="bp-ltr">{asset.maskedCode}</span>
        </div>
      ) : null}
      {asset.serialNumber ? (
        <div className="kv-row">
          <span>شمارهٔ سریال</span>
          <span className="bp-ltr">{asset.serialNumber}</span>
        </div>
      ) : null}
      {asset.supplierReference ? (
        <div className="kv-row">
          <span>کد پیگیری تأمین‌کننده</span>
          <span className="bp-ltr">{asset.supplierReference}</span>
        </div>
      ) : null}
      {asset.recipientEmailMasked ? (
        <div className="kv-row">
          <span>گیرنده</span>
          <span className="bp-ltr">{asset.recipientEmailMasked}</span>
        </div>
      ) : null}
      {asset.expiryDate ? (
        <div className="kv-row">
          <span>انقضا</span>
          <span className="bp-ltr">{formatJalaliDate(asset.expiryDate)}</span>
        </div>
      ) : null}
      <div className="kv-row">
        <span>دفعات مشاهدهٔ کد</span>
        <span>{toPersianDigits(asset.accessCount)}</span>
      </div>
      {asset.sentAt ? (
        <div className="kv-row">
          <span>زمان ارسال</span>
          <span className="bp-ltr">{formatJalaliDate(asset.sentAt)}</span>
        </div>
      ) : null}

      {asset.assetType === "PROVIDER_DIRECT_EMAIL" ? (
        <p className="muted">
          تأمین‌کننده کد را مستقیماً برای مشتری ایمیل کرده است. هیچ کدی نزد ما ذخیره نشده و چیزی برای نمایش وجود ندارد.
        </p>
      ) : null}

      {asset.assetType === "URL" ? (
        <p className="muted">
          تحویل این سفارش با لینک بازخرید انجام می‌شود. لینک هنگام ارسال برای مشتری فرستاده می‌شود و کدی برای نمایش وجود
          ندارد.
        </p>
      ) : null}

      {revealable ? (
        <>
          <p className="warning" style={{ marginBlockStart: 12 }}>
            نمایش کد یک رخداد ثبت‌شده است: با هر بار مشاهده، یک ردیف GIFT_CARD_CODE_VIEWED به نام شما در گزارش رخدادها
            نوشته می‌شود. فقط زمانی کد را ببینید که برای بررسی سفارش لازم است.
          </p>
          <div className="save-row">
            <button
              type="button"
              className="secondary-btn"
              disabled={!canOperate}
              title={canOperate ? undefined : "برای مشاهدهٔ کد باید این کار روی میز شما باشد."}
              onClick={() => setOpen(true)}
            >
              نمایش کد (ثبت در گزارش رخدادها)
            </button>
          </div>
        </>
      ) : null}

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          forget();
        }}
        title="نمایش کد گیفت‌کارت"
        description="این اقدام در گزارش رخدادها به نام شما ثبت می‌شود و قابل حذف نیست."
      >
        {secret ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="warning" style={{ marginBlockStart: 0 }}>
              کد پس از {toPersianDigits(REVEAL_VISIBLE_MS / 1000)} ثانیه به‌طور خودکار پنهان می‌شود. آن را در هیچ
              یادداشت، پیام یا فایلی کپی نکنید.
            </p>
            {secret.code ? (
              <div>
                <p className="detail-label">کد</p>
                <p className="detail-value bp-ltr" style={{ fontSize: 18, letterSpacing: 1 }}>
                  {secret.code}
                </p>
              </div>
            ) : null}
            {secret.pin ? (
              <div>
                <p className="detail-label">پین</p>
                <p className="detail-value bp-ltr" style={{ fontSize: 18, letterSpacing: 1 }}>
                  {secret.pin}
                </p>
              </div>
            ) : null}
            <button type="button" className="primary-btn" onClick={forget}>
              پنهان کردن
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
              دلیل مشاهده (الزامی)
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="مثلاً بررسی شکایت مشتری دربارهٔ نامعتبر بودن کد"
              />
            </label>
            <InlineError message={error} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setOpen(false);
                  forget();
                }}
              >
                انصراف
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={reason.trim().length < 3 || revealing}
                onClick={() => void handleReveal()}
              >
                {revealing ? "در حال نمایش…" : "ثبت در گزارش و نمایش کد"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
