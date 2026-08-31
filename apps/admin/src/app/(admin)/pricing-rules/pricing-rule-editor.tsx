"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SimulateQuoteResponse } from "@barat/contracts";
import { toPersianDigits } from "@barat/ui";
import {
  bpsToPercentText,
  formatBps,
  formatBpsWithPercent,
  formatIrrDelta,
  formatIrrString,
  formatIrrStringAsToman,
  parseBpsText,
  parseDecimalText,
  parseIntegerText,
  parseIrrText,
  parsePercentText,
} from "@/lib/format-bps";
import { simulateQuoteAction } from "../simulator/actions";
import { savePricingRuleAction, deactivatePricingRuleAction } from "./actions";
import {
  BPS_FIELDS,
  IRR_FIELDS,
  PRICING_RULE_SCOPE_LABELS,
  type BpsFieldKey,
  type IrrFieldKey,
  type PutPricingRuleRequest,
  type WirePricingRule,
} from "./pricing-rule-schema";

type BpsUnit = "bps" | "percent";

interface Draft {
  name: string;
  quoteTtlSeconds: string;
  bps: Record<BpsFieldKey, string>;
  percent: Record<BpsFieldKey, string>;
  irr: Record<IrrFieldKey, string>;
}

interface DiffRow {
  label: string;
  before: string;
  after: string;
}

function draftFromRule(rule: WirePricingRule): Draft {
  const bps = {} as Record<BpsFieldKey, string>;
  const percent = {} as Record<BpsFieldKey, string>;
  for (const field of BPS_FIELDS) {
    bps[field.key] = String(rule[field.key]);
    percent[field.key] = bpsToPercentText(rule[field.key]);
  }
  const irr = {} as Record<IrrFieldKey, string>;
  for (const field of IRR_FIELDS) {
    irr[field.key] = rule[field.key];
  }
  return { name: rule.name, quoteTtlSeconds: String(rule.quoteTtlSeconds), bps, percent, irr };
}

interface ValidationSuccess {
  ok: true;
  values: PutPricingRuleRequest;
}
interface ValidationFailure {
  ok: false;
  errors: Record<string, string>;
}

/**
 * A rule is submitted whole or not at all. Every field is parsed before any of
 * them is sent, so a half-typed basis-point value can never reach the API as a
 * silently defaulted zero and reprice the whole catalogue.
 */
function validate(draft: Draft, rule: WirePricingRule): ValidationSuccess | ValidationFailure {
  const errors: Record<string, string> = {};

  const name = draft.name.trim();
  if (name.length === 0) errors["name"] = "نام قاعده الزامی است.";

  const bpsValues = {} as Record<BpsFieldKey, number>;
  for (const field of BPS_FIELDS) {
    const parsed = parseBpsText(draft.bps[field.key]);
    if (parsed === null) errors[field.key] = "مقدار bps باید عددی صحیح بین ۰ و ۱۰۰۰۰۰۰ باشد.";
    else bpsValues[field.key] = parsed;
  }

  const irrValues = {} as Record<IrrFieldKey, string>;
  for (const field of IRR_FIELDS) {
    const parsed = parseIrrText(draft.irr[field.key]);
    if (parsed === null) errors[field.key] = "مبلغ باید عددی صحیح و نامنفی به ریال باشد.";
    else irrValues[field.key] = parsed;
  }

  if (irrValues.roundingStepIrr !== undefined) {
    const step = BigInt(irrValues.roundingStepIrr);
    if (step <= 0n) errors["roundingStepIrr"] = "پلهٔ گرد کردن باید بزرگ‌تر از صفر باشد.";
    else if (step % 10n !== 0n) errors["roundingStepIrr"] = "پلهٔ گرد کردن باید مضربی از ۱۰ ریال باشد.";
  }

  const quoteTtlSeconds = parseIntegerText(draft.quoteTtlSeconds, 30, 3_600);
  if (quoteTtlSeconds === null) errors["quoteTtlSeconds"] = "مدت اعتبار باید بین ۳۰ تا ۳۶۰۰ ثانیه باشد.";

  if (Object.keys(errors).length > 0 || quoteTtlSeconds === null) return { ok: false, errors };

  return {
    ok: true,
    values: {
      name,
      scope: rule.scope,
      targetId: rule.targetId,
      isActive: rule.isActive,
      expectedVersion: rule.version,
      quoteTtlSeconds,
      fxSpreadBps: bpsValues.fxSpreadBps,
      fxRiskBufferBps: bpsValues.fxRiskBufferBps,
      serviceFeeBps: bpsValues.serviceFeeBps,
      paymentFeeBps: bpsValues.paymentFeeBps,
      targetMarginBps: bpsValues.targetMarginBps,
      maxSupplierCostToleranceBps: bpsValues.maxSupplierCostToleranceBps,
      serviceFeeFixedIrr: irrValues.serviceFeeFixedIrr,
      operationalFeeIrr: irrValues.operationalFeeIrr,
      paymentFeeFixedIrr: irrValues.paymentFeeFixedIrr,
      minimumMarginIrr: irrValues.minimumMarginIrr,
      roundingStepIrr: irrValues.roundingStepIrr,
    },
  };
}

function buildDiff(rule: WirePricingRule, values: PutPricingRuleRequest): DiffRow[] {
  const rows: DiffRow[] = [];
  if (values.name !== rule.name) rows.push({ label: "نام قاعده", before: rule.name, after: values.name });
  for (const field of BPS_FIELDS) {
    const after = values[field.key];
    if (after !== rule[field.key]) {
      rows.push({ label: field.label, before: formatBpsWithPercent(rule[field.key]), after: formatBpsWithPercent(after) });
    }
  }
  for (const field of IRR_FIELDS) {
    const after = values[field.key];
    if (BigInt(after) !== BigInt(rule[field.key])) {
      rows.push({ label: field.label, before: formatIrrStringAsToman(rule[field.key]), after: formatIrrStringAsToman(after) });
    }
  }
  if (values.quoteTtlSeconds !== rule.quoteTtlSeconds) {
    rows.push({
      label: "مدت اعتبار استعلام",
      before: `${toPersianDigits(rule.quoteTtlSeconds)} ثانیه`,
      after: `${toPersianDigits(values.quoteTtlSeconds)} ثانیه`,
    });
  }
  return rows;
}

interface ImpactState {
  before: SimulateQuoteResponse;
  after: SimulateQuoteResponse;
}

export function PricingRuleEditor({
  rule,
  referenceFxRate,
}: {
  rule: WirePricingRule;
  referenceFxRate: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFromRule(rule));
  const [unitFocus, setUnitFocus] = useState<Partial<Record<BpsFieldKey, BpsUnit>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<"edit" | "review">("edit");
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [refCostUsd, setRefCostUsd] = useState("50.00");
  const [refFxRate, setRefFxRate] = useState(referenceFxRate ?? "");
  const [impact, setImpact] = useState<ImpactState | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impactPending, setImpactPending] = useState(false);

  const validation = useMemo(() => validate(draft, rule), [draft, rule]);
  const diff = validation.ok ? buildDiff(rule, validation.values) : [];

  function setBpsField(key: BpsFieldKey, raw: string) {
    setUnitFocus((current) => ({ ...current, [key]: "bps" }));
    setDraft((current) => {
      const parsed = parseBpsText(raw);
      return {
        ...current,
        bps: { ...current.bps, [key]: raw },
        percent: { ...current.percent, [key]: parsed === null ? current.percent[key] : bpsToPercentText(parsed) },
      };
    });
    resetReview();
  }

  function setPercentField(key: BpsFieldKey, raw: string) {
    setUnitFocus((current) => ({ ...current, [key]: "percent" }));
    setDraft((current) => {
      const parsed = parsePercentText(raw);
      return {
        ...current,
        percent: { ...current.percent, [key]: raw },
        bps: { ...current.bps, [key]: parsed === null ? current.bps[key] : String(parsed) },
      };
    });
    resetReview();
  }

  function resetReview() {
    setStage("edit");
    setConfirmed(false);
    setImpact(null);
    setImpactError(null);
    setMessage(null);
  }

  function goToReview() {
    if (!validation.ok) {
      setErrors(validation.errors);
      setMessage({ tone: "error", text: "تا وقتی همهٔ فیلدها معتبر نباشند، قاعده ارسال نمی‌شود." });
      return;
    }
    setErrors({});
    setMessage(null);
    setStage("review");
    void loadImpact(validation.values);
  }

  async function loadImpact(values: PutPricingRuleRequest) {
    const marketFxRate = parseDecimalText(refFxRate);
    const supplierCostForeign = parseDecimalText(refCostUsd);
    if (marketFxRate === null || supplierCostForeign === null) {
      setImpact(null);
      setImpactError("برای برآورد اثر قیمتی، نرخ مرجع ارز و هزینهٔ نمونه را وارد کنید.");
      return;
    }
    setImpactPending(true);
    setImpactError(null);
    const base = {
      skuId: null,
      serviceId: null,
      supplierOfferId: null,
      quantity: 1,
      supplierCostForeign,
      supplierCostCurrency: "USD",
      marketFxRate,
    };
    const [before, after] = await Promise.all([
      simulateQuoteAction({ ...base, rule: ruleSnapshotFrom(rule) }),
      simulateQuoteAction({ ...base, rule: { ...ruleSnapshotFrom(rule), ...economicFields(values) } }),
    ]);
    setImpactPending(false);
    if (!before.ok || !after.ok) {
      setImpact(null);
      setImpactError(before.ok ? (after.ok ? null : after.message) : before.message);
      return;
    }
    setImpact({ before: before.response, after: after.response });
  }

  function submit() {
    if (!validation.ok || !confirmed) return;
    const values = validation.values;
    startTransition(async () => {
      const result = await savePricingRuleAction(values);
      if (result.ok) {
        setMessage({
          tone: "ok",
          text: `قاعده با نسخهٔ ${toPersianDigits(result.rule.version)} ثبت شد و از این لحظه بر همهٔ استعلام‌های جدید اعمال می‌شود.`,
        });
        setStage("edit");
        setConfirmed(false);
        setImpact(null);
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  function deactivate() {
    startTransition(async () => {
      const result = await deactivatePricingRuleAction({ id: rule.id, expectedVersion: rule.version });
      setMessage(
        result.ok
          ? { tone: "ok", text: "قاعده غیرفعال شد. نسخهٔ جدید در تاریخچه ثبت است." }
          : { tone: "error", text: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <div>
      <div className="card panel">
        <div className="section-label">
          <h3>{rule.name}</h3>
          <span>
            دامنه: {PRICING_RULE_SCOPE_LABELS[rule.scope]} · نسخهٔ {toPersianDigits(rule.version)} ·{" "}
            {rule.isActive ? "فعال" : "غیرفعال"}
          </span>
        </div>
        <label style={{ maxWidth: 420 }}>
          نام قاعده
          <input
            value={draft.name}
            onChange={(event) => {
              setDraft((current) => ({ ...current, name: event.target.value }));
              resetReview();
            }}
          />
          <FieldError message={errors["name"]} />
        </label>
      </div>

      <div className="card panel" style={{ marginBlockStart: 16 }}>
        <div className="section-label">
          <h3>پارامترهای basis-point</h3>
          <span>۱۰۰ bps = ۱٪ — مقدار ذخیره‌شده همیشه عدد صحیح bps است</span>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {BPS_FIELDS.map((field) => {
            const focus = unitFocus[field.key];
            const parsedBps = parseBpsText(draft.bps[field.key]);
            return (
              <div key={field.key} style={{ paddingBlockEnd: 12, borderBlockEnd: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBlockEnd: 8 }}>
                  <strong style={{ fontSize: 12 }}>{field.label}</strong>
                  <span className="muted">
                    مقدار فعلی: {formatBpsWithPercent(rule[field.key])}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  <label>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      مقدار به bps
                      {focus === "bps" ? <span className="tag-pill">در حال ویرایش</span> : null}
                    </span>
                    <input
                      className="bp-ltr"
                      inputMode="numeric"
                      value={draft.bps[field.key]}
                      onChange={(event) => setBpsField(field.key, event.target.value)}
                      aria-label={`${field.label} به basis point`}
                    />
                  </label>
                  <label>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      معادل به درصد
                      {focus === "percent" ? <span className="tag-pill">در حال ویرایش</span> : null}
                    </span>
                    <input
                      className="bp-ltr"
                      inputMode="decimal"
                      value={draft.percent[field.key]}
                      onChange={(event) => setPercentField(field.key, event.target.value)}
                      aria-label={`${field.label} به درصد`}
                    />
                  </label>
                </div>
                <p className="muted" style={{ marginBlockStart: 6 }}>
                  {parsedBps === null ? "—" : `${toPersianDigits(parsedBps)} bps برابر است با ${formatBps(parsedBps)}`}
                </p>
                <FieldError message={errors[field.key]} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="card panel" style={{ marginBlockStart: 16 }}>
        <div className="section-label">
          <h3>مبالغ ثابت</h3>
          <span>ورودی به ریال — معادل تومان زیر هر فیلد نمایش داده می‌شود</span>
        </div>
        <div className="form-grid">
          {IRR_FIELDS.map((field) => {
            const parsed = parseIrrText(draft.irr[field.key]);
            return (
              <label key={field.key}>
                {field.label} (ریال)
                <input
                  className="bp-ltr"
                  inputMode="numeric"
                  value={draft.irr[field.key]}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, irr: { ...current.irr, [field.key]: event.target.value } }));
                    resetReview();
                  }}
                />
                <span className="muted" style={{ fontWeight: 400 }}>
                  {parsed === null ? "—" : `${formatIrrStringAsToman(parsed)} · فعلی: ${formatIrrStringAsToman(rule[field.key])}`}
                </span>
                <FieldError message={errors[field.key]} />
              </label>
            );
          })}
          <label>
            مدت اعتبار استعلام (ثانیه)
            <input
              className="bp-ltr"
              inputMode="numeric"
              value={draft.quoteTtlSeconds}
              onChange={(event) => {
                setDraft((current) => ({ ...current, quoteTtlSeconds: event.target.value }));
                resetReview();
              }}
            />
            <span className="muted" style={{ fontWeight: 400 }}>فعلی: {toPersianDigits(rule.quoteTtlSeconds)} ثانیه</span>
            <FieldError message={errors["quoteTtlSeconds"]} />
          </label>
        </div>
      </div>

      <div className="card panel" style={{ marginBlockStart: 16 }}>
        <div className="section-label">
          <h3>بازبینی و تأیید</h3>
          <span>{diff.length === 0 ? "تغییری نسبت به نسخهٔ فعلی وجود ندارد" : `${toPersianDigits(diff.length)} فیلد تغییر کرده است`}</span>
        </div>

        <p className="warning">
          هر تغییر در این قاعده، مبلغی را که همهٔ مشتری‌ها در استعلام‌های بعدی می‌پردازند تغییر می‌دهد. استعلام‌های
          صادرشده تحت تأثیر قرار نمی‌گیرند، چون قاعده در لحظهٔ صدور در استعلام ثبت شده است.
        </p>

        {stage === "edit" ? (
          <div className="save-row">
            <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={() => { setDraft(draftFromRule(rule)); setErrors({}); resetReview(); }}>
              بازنشانی به نسخهٔ فعلی
            </button>
            <button type="button" className="primary-btn" onClick={goToReview} disabled={diff.length === 0 && validation.ok}>
              بازبینی تغییرات
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap" style={{ marginBlockStart: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>فیلد</th>
                    <th>مقدار فعلی</th>
                    <th>مقدار جدید</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td style={{ color: "var(--slate)" }}>{row.before}</td>
                      <td style={{ fontWeight: 800 }}>{row.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginBlockStart: 18, paddingBlockStart: 16, borderBlockStart: "1px solid var(--line)" }}>
              <div className="section-label">
                <h3>اثر بر قیمت مشتری</h3>
                <span>محاسبه توسط موتور قیمت‌گذاری سرور — هیچ عددی در مرورگر محاسبه نمی‌شود</span>
              </div>
              <div className="form-grid">
                <label>
                  هزینهٔ نمونهٔ تأمین‌کننده (USD)
                  <input className="bp-ltr" inputMode="decimal" value={refCostUsd} onChange={(event) => setRefCostUsd(event.target.value)} />
                </label>
                <label>
                  نرخ مرجع بازار USD/IRR
                  <input className="bp-ltr" inputMode="decimal" value={refFxRate} onChange={(event) => setRefFxRate(event.target.value)} placeholder="نرخ زنده در دسترس نیست" />
                </label>
              </div>
              <div className="save-row">
                <button type="button" className="secondary-btn" onClick={() => { if (validation.ok) void loadImpact(validation.values); }} disabled={impactPending}>
                  {impactPending ? "در حال محاسبه…" : "محاسبهٔ اثر قیمتی"}
                </button>
              </div>
              {impactError ? <p className="warning">{impactError}</p> : null}
              {impact ? (
                <div className="cost-panel">
                  <div className="cost-item">
                    <span>قیمت فعلی مشتری</span>
                    <strong>{formatIrrStringAsToman(impact.before.breakdown.finalAmountIrr)}</strong>
                  </div>
                  <div className="cost-item">
                    <span>قیمت پس از تغییر</span>
                    <strong>{formatIrrStringAsToman(impact.after.breakdown.finalAmountIrr)}</strong>
                  </div>
                  <div className="cost-item">
                    <span>اختلاف</span>
                    <strong className={BigInt(impact.after.breakdown.finalAmountIrr) > BigInt(impact.before.breakdown.finalAmountIrr) ? "" : "cost-diff"}>
                      {formatIrrDelta(impact.before.breakdown.finalAmountIrr, impact.after.breakdown.finalAmountIrr)}
                    </strong>
                  </div>
                  <div className="cost-item">
                    <span>حاشیهٔ مؤثر</span>
                    <strong>
                      {formatBps(impact.before.breakdown.effectiveMarginBps)} ← {formatBps(impact.after.breakdown.effectiveMarginBps)}
                    </strong>
                  </div>
                </div>
              ) : null}
            </div>

            <label style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 9, marginBlockStart: 18, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                style={{ width: 18, minHeight: 18, marginBlockStart: 2, flex: "0 0 auto" }}
              />
              <span>
                تغییرات بالا را بررسی کرده‌ام و تأیید می‌کنم که از این پس همهٔ استعلام‌های جدید با این قاعده قیمت‌گذاری شوند.
              </span>
            </label>

            <div className="save-row">
              <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={resetReview} disabled={pending}>
                بازگشت به ویرایش
              </button>
              <button type="button" className="primary-btn" onClick={submit} disabled={!confirmed || pending}>
                {pending ? "در حال ثبت…" : `اعمال نسخهٔ ${toPersianDigits(rule.version + 1)}`}
              </button>
            </div>
          </>
        )}

        {message ? (
          <p className={message.tone === "ok" ? "muted" : "warning"} style={{ marginBlockStart: 12 }} role="status">
            {message.text}
          </p>
        ) : null}
      </div>

      {rule.isActive ? (
        <div className="card panel" style={{ marginBlockStart: 16 }}>
          <div className="section-label">
            <h3>غیرفعال‌سازی قاعده</h3>
            <span>حذف فیزیکی انجام نمی‌شود؛ نسخهٔ جدیدی با وضعیت غیرفعال ثبت می‌شود</span>
          </div>
          <DeactivateControl onConfirm={deactivate} pending={pending} scopeLabel={PRICING_RULE_SCOPE_LABELS[rule.scope]} />
        </div>
      ) : null}

      <p className="muted" style={{ marginBlockStart: 16 }}>
        پلهٔ گرد کردن فعلی: {formatIrrString(rule.roundingStepIrr)} · شناسهٔ قاعده:{" "}
        <span className="order-id">{rule.id}</span>
      </p>
    </div>
  );
}

function DeactivateControl({
  onConfirm,
  pending,
  scopeLabel,
}: {
  onConfirm: () => void;
  pending: boolean;
  scopeLabel: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <div className="save-row">
        <button type="button" className="secondary-btn" onClick={() => setArmed(true)}>
          غیرفعال‌سازی این قاعده
        </button>
      </div>
    );
  }
  return (
    <>
      <p className="warning">
        با غیرفعال شدن قاعدهٔ {scopeLabel}، تا زمانی که قاعدهٔ جایگزینی ثبت نشود، استعلام جدیدی برای این دامنه قیمت‌گذاری
        نخواهد شد.
      </p>
      <div className="save-row">
        <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={() => setArmed(false)} disabled={pending}>
          انصراف
        </button>
        <button type="button" className="primary-btn" onClick={onConfirm} disabled={pending}>
          {pending ? "در حال ثبت…" : "تأیید غیرفعال‌سازی"}
        </button>
      </div>
    </>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <span style={{ color: "var(--red)", fontSize: 10, fontWeight: 700 }} role="alert">
      {message}
    </span>
  );
}

/** The identity part of the rule snapshot the simulator needs; economics come from either side of the diff. */
function ruleSnapshotFrom(rule: WirePricingRule) {
  return {
    id: rule.id,
    name: rule.name,
    version: rule.version,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr: rule.serviceFeeFixedIrr,
    operationalFeeIrr: rule.operationalFeeIrr,
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: rule.minimumMarginIrr,
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr: rule.paymentFeeFixedIrr,
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: rule.roundingStepIrr,
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
  };
}

function economicFields(values: PutPricingRuleRequest) {
  return {
    fxSpreadBps: values.fxSpreadBps,
    fxRiskBufferBps: values.fxRiskBufferBps,
    serviceFeeBps: values.serviceFeeBps,
    serviceFeeFixedIrr: values.serviceFeeFixedIrr,
    operationalFeeIrr: values.operationalFeeIrr,
    targetMarginBps: values.targetMarginBps,
    minimumMarginIrr: values.minimumMarginIrr,
    paymentFeeBps: values.paymentFeeBps,
    paymentFeeFixedIrr: values.paymentFeeFixedIrr,
    quoteTtlSeconds: values.quoteTtlSeconds,
    roundingStepIrr: values.roundingStepIrr,
    maxSupplierCostToleranceBps: values.maxSupplierCostToleranceBps,
  };
}
