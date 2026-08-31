"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FxPair, FxRateSnapshot } from "@barat/contracts";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { formatDecimalString, formatAgeSeconds, parseDecimalText } from "@/lib/format-bps";
import { clearFxOverrideAction, setFxOverrideAction } from "./actions";
import { OVERRIDE_TTL_CHOICES } from "./fx-schema";

interface Props {
  pair: FxPair;
  activeOverride: FxRateSnapshot | null;
  suggestedMidRate: string | null;
  canOverride: boolean;
  actorLabel: string;
}

type Stage = "edit" | "review";

export function FxOverridePanel({ pair, activeOverride, suggestedMidRate, canOverride, actorLabel }: Props) {
  const router = useRouter();
  const [mid, setMid] = useState(suggestedMidRate ?? "");
  const [buy, setBuy] = useState(suggestedMidRate ?? "");
  const [sell, setSell] = useState(suggestedMidRate ?? "");
  const [sidesTouched, setSidesTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState<number>(1_800);
  const [stage, setStage] = useState<Stage>("edit");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = {
    mid: parseDecimalText(mid),
    buy: parseDecimalText(buy),
    sell: parseDecimalText(sell),
  };
  const trimmedReason = reason.trim();
  const complete = parsed.mid !== null && parsed.buy !== null && parsed.sell !== null && trimmedReason.length >= 3;

  function updateMid(value: string) {
    setMid(value);
    // Buy and sell mirror the mid rate until the operator deliberately splits
    // them, so a one-sided override cannot be created by forgetting a field.
    if (!sidesTouched) {
      setBuy(value);
      setSell(value);
    }
    back();
  }

  function back() {
    setStage("edit");
    setConfirmed(false);
    setError(null);
  }

  function review() {
    if (!complete) {
      setError("نرخ خرید، فروش، میانی و دلیل override همگی الزامی‌اند.");
      return;
    }
    setError(null);
    setNotice(null);
    setStage("review");
  }

  function submit() {
    if (!complete || !confirmed) return;
    startTransition(async () => {
      const result = await setFxOverrideAction({
        pair,
        buyRate: parsed.buy,
        sellRate: parsed.sell,
        midRate: parsed.mid,
        reason: trimmedReason,
        ttlSeconds,
      });
      if (result.ok) {
        setNotice(
          `override با نرخ میانی ${formatDecimalString(result.snapshot.midRate)} ثبت شد و تا ${
            result.snapshot.expiresAt ? formatJalaliDate(result.snapshot.expiresAt) : "زمان لغو دستی"
          } فعال است.`,
        );
        setReason("");
        setStage("edit");
        setConfirmed(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="card panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">override دستی نرخ</h2>
          <p className="panel-caption">مداخلهٔ انسانی روی قیمت زنده — هر ثبت و هر لغو در گزارش رخدادها ثبت می‌شود</p>
        </div>
      </div>

      {activeOverride ? (
        <ActiveOverrideCard
          snapshot={activeOverride}
          pair={pair}
          canOverride={canOverride}
          pending={pending}
          onCleared={(text) => {
            setNotice(text);
            router.refresh();
          }}
          onError={setError}
        />
      ) : (
        <p className="muted" style={{ marginBlockEnd: 16 }}>
          در حال حاضر هیچ override فعالی وجود ندارد؛ نرخ از Provider خودکار خوانده می‌شود.
        </p>
      )}

      {!canOverride ? (
        <p className="warning">
          نقش شما اجازهٔ تغییر نرخ ارز را ندارد. ثبت یا لغو override تنها با نقش «مدیر سیستم» یا «مالی» ممکن است.
        </p>
      ) : (
        <>
          <div className="form-grid" style={{ marginBlockStart: 8 }}>
            <label style={{ gridColumn: "1 / -1" }}>
              نرخ میانی (ریال به ازای هر دلار)
              <input className="bp-ltr" inputMode="decimal" value={mid} onChange={(event) => updateMid(event.target.value)} />
              <span className="muted" style={{ fontWeight: 400 }}>
                {parsed.mid === null ? "عدد معتبر وارد کنید" : `${formatDecimalString(parsed.mid)} ریال`}
              </span>
            </label>
            <label>
              نرخ خرید
              <input
                className="bp-ltr"
                inputMode="decimal"
                value={buy}
                onChange={(event) => {
                  setSidesTouched(true);
                  setBuy(event.target.value);
                  back();
                }}
              />
            </label>
            <label>
              نرخ فروش
              <input
                className="bp-ltr"
                inputMode="decimal"
                value={sell}
                onChange={(event) => {
                  setSidesTouched(true);
                  setSell(event.target.value);
                  back();
                }}
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              دلیل override (الزامی، در گزارش رخدادها ثبت می‌شود)
              <textarea
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  back();
                }}
                maxLength={500}
                placeholder="مثلاً: قطع اتصال به هر دو Provider از ساعت ۱۰:۳۰"
              />
              <span className="muted" style={{ fontWeight: 400 }}>
                {toPersianDigits(trimmedReason.length)} از ۵۰۰ نویسه — حداقل ۳ نویسه
              </span>
            </label>
            <label>
              مدت اعتبار override
              <select
                value={String(ttlSeconds)}
                onChange={(event) => {
                  setTtlSeconds(Number(event.target.value));
                  back();
                }}
              >
                {OVERRIDE_TTL_CHOICES.map((choice) => (
                  <option key={choice.seconds} value={choice.seconds}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {stage === "edit" ? (
            <div className="save-row">
              <button type="button" className="primary-btn" onClick={review} disabled={pending}>
                بازبینی override
              </button>
            </div>
          ) : (
            <>
              <div className="kv-list" style={{ marginBlockStart: 16 }}>
                <div className="kv-row">
                  <span>نرخ میانی جدید</span>
                  <span className="bp-ltr">{parsed.mid === null ? "—" : formatDecimalString(parsed.mid)}</span>
                </div>
                <div className="kv-row">
                  <span>خرید / فروش</span>
                  <span className="bp-ltr">
                    {parsed.buy === null ? "—" : formatDecimalString(parsed.buy)} /{" "}
                    {parsed.sell === null ? "—" : formatDecimalString(parsed.sell)}
                  </span>
                </div>
                <div className="kv-row">
                  <span>مدت اعتبار</span>
                  <span>{OVERRIDE_TTL_CHOICES.find((choice) => choice.seconds === ttlSeconds)?.label ?? "—"}</span>
                </div>
                <div className="kv-row">
                  <span>ثبت‌کننده</span>
                  <span>{actorLabel}</span>
                </div>
                <div className="kv-row">
                  <span>دلیل</span>
                  <span>{trimmedReason}</span>
                </div>
              </div>

              <p className="warning">
                تا پایان مدت اعتبار، همهٔ استعلام‌های جدید با این نرخ دستی قیمت‌گذاری می‌شوند و نرخ Provider نادیده گرفته
                می‌شود.
              </p>

              <label style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 9, marginBlockStart: 14, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  style={{ width: 18, minHeight: 18, marginBlockStart: 2, flex: "0 0 auto" }}
                />
                <span>مسئولیت این مداخلهٔ دستی روی قیمت زنده را می‌پذیرم.</span>
              </label>

              <div className="save-row">
                <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={back} disabled={pending}>
                  بازگشت
                </button>
                <button type="button" className="primary-btn" onClick={submit} disabled={!confirmed || pending}>
                  {pending ? "در حال ثبت…" : "ثبت override"}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {error ? <p className="warning" role="alert">{error}</p> : null}
      {notice ? <p className="muted" style={{ marginBlockStart: 12 }} role="status">{notice}</p> : null}
    </div>
  );
}

function ActiveOverrideCard({
  snapshot,
  pair,
  canOverride,
  pending,
  onCleared,
  onError,
}: {
  snapshot: FxRateSnapshot;
  pair: FxPair;
  canOverride: boolean;
  pending: boolean;
  onCleared: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [clearing, startClearing] = useTransition();

  function clear() {
    startClearing(async () => {
      const result = await clearFxOverrideAction(pair);
      if (result.ok) {
        setArmed(false);
        onCleared(
          `${toPersianDigits(result.cleared.expired)} override منقضی شد. قیمت‌گذاری به نرخ خودکار Provider بازگشت.`,
        );
      } else {
        onError(result.message);
      }
    });
  }

  return (
    <div style={{ padding: 14, background: "var(--soft)", borderRadius: 12, marginBlockEnd: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBlockEnd: 10 }}>
        <span className="badge badge-danger">override فعال است</span>
        <span className="muted">سن نرخ: {formatAgeSeconds(snapshot.ageSeconds)}</span>
      </div>
      <div className="kv-list">
        <div className="kv-row">
          <span>نرخ میانی</span>
          <span className="bp-ltr">{formatDecimalString(snapshot.midRate)}</span>
        </div>
        <div className="kv-row">
          <span>از تاریخ</span>
          <span>{formatJalaliDate(snapshot.effectiveAt)}</span>
        </div>
        <div className="kv-row">
          <span>انقضا</span>
          <span>{snapshot.expiresAt ? formatJalaliDate(snapshot.expiresAt) : "بدون انقضا"}</span>
        </div>
        <div className="kv-row">
          <span>دلیل ثبت‌شده</span>
          <span>{snapshot.overrideReason ?? "—"}</span>
        </div>
      </div>
      <p className="muted" style={{ marginBlockStart: 10 }}>
        نام کارشناس ثبت‌کننده در پاسخ این سرویس بازگردانده نمی‌شود؛ برای دیدن آن به گزارش رخدادها با کنش
        FX_RATE_OVERRIDE_CREATED مراجعه کنید.
      </p>

      {canOverride ? (
        armed ? (
          <>
            <p className="warning">
              با لغو override، قیمت‌گذاری بلافاصله به نرخ Provider خودکار برمی‌گردد. اگر Provider در دسترس نباشد، صدور
              استعلام جدید متوقف می‌شود.
            </p>
            <div className="save-row">
              <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={() => setArmed(false)} disabled={clearing || pending}>
                انصراف
              </button>
              <button type="button" className="primary-btn" onClick={clear} disabled={clearing || pending}>
                {clearing ? "در حال لغو…" : "تأیید لغو override"}
              </button>
            </div>
          </>
        ) : (
          <div className="save-row">
            <button type="button" className="secondary-btn" onClick={() => setArmed(true)} disabled={pending}>
              لغو override فعال
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
