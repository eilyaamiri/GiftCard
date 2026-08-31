"use client";

import { useState, useTransition } from "react";
import type { PricingComponent, SimulateQuoteResponse } from "@barat/contracts";
import { formatJalaliDate, formatUsd, toPersianDigits } from "@barat/ui";
import {
  formatBps,
  formatDecimalString,
  formatIrrStringAsToman,
  parseBpsText,
  parseDecimalText,
  parseIntegerText,
  parseIrrText,
} from "@/lib/format-bps";
import {
  BPS_FIELDS,
  IRR_FIELDS,
  type BpsFieldKey,
  type IrrFieldKey,
  type WirePricingRule,
} from "../pricing-rules/pricing-rule-schema";
import { simulateQuoteAction } from "./actions";

interface Draft {
  quantity: string;
  supplierCostForeign: string;
  marketFxRate: string;
  discountIrr: string;
  quoteTtlSeconds: string;
  bps: Record<BpsFieldKey, string>;
  irr: Record<IrrFieldKey, string>;
}

function draftFrom(rule: WirePricingRule, marketFxRate: string): Draft {
  const bps = {} as Record<BpsFieldKey, string>;
  for (const field of BPS_FIELDS) bps[field.key] = String(rule[field.key]);
  const irr = {} as Record<IrrFieldKey, string>;
  for (const field of IRR_FIELDS) irr[field.key] = rule[field.key];
  return {
    quantity: "1",
    supplierCostForeign: "50.00",
    marketFxRate,
    discountIrr: "0",
    quoteTtlSeconds: String(rule.quoteTtlSeconds),
    bps,
    irr,
  };
}

export function SimulatorForm({
  rules,
  initialFxRate,
}: {
  rules: readonly WirePricingRule[];
  initialFxRate: string | null;
}) {
  const first = rules[0];
  const [ruleId, setRuleId] = useState(first?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() =>
    first ? draftFrom(first, initialFxRate ?? "") : emptyDraft(initialFxRate ?? ""),
  );
  const [response, setResponse] = useState<SimulateQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedRule = rules.find((rule) => rule.id === ruleId) ?? null;

  // Switching the base rule reloads its economics but keeps the basket the
  // operator was exploring, so two rules can be compared on the same inputs.
  function selectRule(nextId: string) {
    setRuleId(nextId);
    const rule = rules.find((candidate) => candidate.id === nextId);
    if (rule) {
      setDraft((current) => ({
        ...draftFrom(rule, current.marketFxRate),
        quantity: current.quantity,
        supplierCostForeign: current.supplierCostForeign,
        discountIrr: current.discountIrr,
      }));
    }
    setResponse(null);
  }

  function setField(key: "quantity" | "supplierCostForeign" | "marketFxRate" | "discountIrr" | "quoteTtlSeconds", value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function run() {
    const quantity = parseIntegerText(draft.quantity, 1, 100);
    const supplierCostForeign = parseDecimalText(draft.supplierCostForeign);
    const marketFxRate = parseDecimalText(draft.marketFxRate);
    const discountIrr = parseIrrText(draft.discountIrr);
    const quoteTtlSeconds = parseIntegerText(draft.quoteTtlSeconds, 30, 3_600);

    if (quantity === null || supplierCostForeign === null || marketFxRate === null || discountIrr === null || quoteTtlSeconds === null) {
      setError("تعداد، هزینهٔ تأمین‌کننده، نرخ بازار، تخفیف و مدت اعتبار باید مقادیر معتبری داشته باشند.");
      return;
    }

    const bpsValues: Partial<Record<BpsFieldKey, number>> = {};
    for (const field of BPS_FIELDS) {
      const parsed = parseBpsText(draft.bps[field.key]);
      if (parsed === null) {
        setError(`مقدار «${field.label}» باید عددی صحیح به bps باشد.`);
        return;
      }
      bpsValues[field.key] = parsed;
    }
    const irrValues: Partial<Record<IrrFieldKey, string>> = {};
    for (const field of IRR_FIELDS) {
      const parsed = parseIrrText(draft.irr[field.key]);
      if (parsed === null) {
        setError(`مقدار «${field.label}» باید عددی صحیح به ریال باشد.`);
        return;
      }
      irrValues[field.key] = parsed;
    }

    setError(null);
    startTransition(async () => {
      const result = await simulateQuoteAction({
        skuId: null,
        serviceId: null,
        supplierOfferId: null,
        quantity,
        supplierCostForeign,
        supplierCostCurrency: "USD",
        marketFxRate,
        discountIrr,
        rule: {
          id: selectedRule?.id ?? "admin-simulator",
          name: selectedRule?.name ?? "شبیه‌سازی ادمین",
          version: selectedRule?.version ?? 1,
          quoteTtlSeconds,
          ...bpsValues,
          ...irrValues,
        },
      });
      if (result.ok) {
        setResponse(result.response);
      } else {
        setResponse(null);
        setError(result.message);
      }
    });
  }

  const breakdown = response?.breakdown ?? null;

  return (
    <div className="simulator-grid">
      <div className="card panel">
        <div className="section-label">
          <h3>ورودی‌ها</h3>
          <span>۱۰۰ bps = ۱٪</span>
        </div>

        <div className="form-grid">
          <label style={{ gridColumn: "1 / -1" }}>
            قاعدهٔ پایه
            <select value={ruleId} onChange={(event) => selectRule(event.target.value)}>
              {rules.length === 0 ? <option value="">قاعده‌ای در دسترس نیست</option> : null}
              {rules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name} — نسخهٔ {toPersianDigits(rule.version)}
                </option>
              ))}
            </select>
          </label>
          <label>
            تعداد
            <input className="bp-ltr" inputMode="numeric" value={draft.quantity} onChange={(event) => setField("quantity", event.target.value)} />
          </label>
          <label>
            هزینهٔ واحد تأمین‌کننده (USD)
            <input className="bp-ltr" inputMode="decimal" value={draft.supplierCostForeign} onChange={(event) => setField("supplierCostForeign", event.target.value)} />
          </label>
          <label>
            نرخ بازار USD/IRR
            <input className="bp-ltr" inputMode="decimal" value={draft.marketFxRate} onChange={(event) => setField("marketFxRate", event.target.value)} placeholder="نرخ زنده در دسترس نیست" />
          </label>
          <label>
            تخفیف (ریال)
            <input className="bp-ltr" inputMode="numeric" value={draft.discountIrr} onChange={(event) => setField("discountIrr", event.target.value)} />
          </label>
          <label>
            مدت اعتبار استعلام (ثانیه)
            <input className="bp-ltr" inputMode="numeric" value={draft.quoteTtlSeconds} onChange={(event) => setField("quoteTtlSeconds", event.target.value)} />
          </label>
        </div>

        <div className="section-label" style={{ marginBlockStart: 20 }}>
          <h3>پارامترهای bps</h3>
          <span>فیلد قابل ویرایش، مقدار bps است</span>
        </div>
        <div className="form-grid">
          {BPS_FIELDS.map((field) => {
            const parsed = parseBpsText(draft.bps[field.key]);
            return (
              <label key={field.key}>
                {field.label} (bps)
                <input
                  className="bp-ltr"
                  inputMode="numeric"
                  value={draft.bps[field.key]}
                  onChange={(event) => setDraft((current) => ({ ...current, bps: { ...current.bps, [field.key]: event.target.value } }))}
                />
                <span className="muted" style={{ fontWeight: 400 }}>
                  معادل: {parsed === null ? "—" : formatBps(parsed)}
                </span>
              </label>
            );
          })}
        </div>

        <div className="section-label" style={{ marginBlockStart: 20 }}>
          <h3>مبالغ ثابت (ریال)</h3>
        </div>
        <div className="form-grid">
          {IRR_FIELDS.map((field) => {
            const parsed = parseIrrText(draft.irr[field.key]);
            return (
              <label key={field.key}>
                {field.label}
                <input
                  className="bp-ltr"
                  inputMode="numeric"
                  value={draft.irr[field.key]}
                  onChange={(event) => setDraft((current) => ({ ...current, irr: { ...current.irr, [field.key]: event.target.value } }))}
                />
                <span className="muted" style={{ fontWeight: 400 }}>{parsed === null ? "—" : formatIrrStringAsToman(parsed)}</span>
              </label>
            );
          })}
        </div>

        <div className="save-row">
          <button type="button" className="primary-btn" onClick={run} disabled={pending}>
            {pending ? "در حال محاسبه…" : "اجرای شبیه‌سازی"}
          </button>
        </div>
        {error ? <p className="warning" role="alert">{error}</p> : null}
      </div>

      <div className="card panel">
        <div className="section-label">
          <h3>خروجی موتور قیمت‌گذاری</h3>
          <span>همهٔ مبالغ عیناً از پاسخ سرور</span>
        </div>

        {breakdown ? (
          <>
            <div className="kv-list" style={{ marginBlockEnd: 18 }}>
              <div className="kv-row">
                <span>نرخ بازار</span>
                <span className="bp-ltr">{formatDecimalString(breakdown.marketFxRate)}</span>
              </div>
              <div className="kv-row">
                <span>نرخ مؤثر (پس از اسپرد و بافر)</span>
                <span className="bp-ltr">{formatDecimalString(breakdown.effectiveFxRate)}</span>
              </div>
              <div className="kv-row">
                <span>منبع نرخ</span>
                <span>{breakdown.fxProvider} · {formatJalaliDate(breakdown.fxRateTimestamp)}</span>
              </div>
              <div className="kv-row">
                <span>هزینهٔ تأمین‌کننده</span>
                <span className="bp-ltr">{formatUsd(breakdown.supplierCostForeign)}</span>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>جزء</th>
                    <th>نرخ</th>
                    <th>مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...breakdown.components]
                    .sort((left, right) => left.sortOrder - right.sortOrder)
                    .map((component) => (
                      <ComponentRow key={`${component.kind}-${component.sortOrder}`} component={component} />
                    ))}
                </tbody>
              </table>
            </div>

            <div className="result-row" style={{ marginBlockStart: 14 }}>
              <span>جمع پیش از گرد کردن</span>
              <span>{formatIrrStringAsToman(breakdown.subtotal)}</span>
            </div>
            <div className="result-row">
              <span>تعدیل گرد کردن</span>
              <span>{formatIrrStringAsToman(breakdown.roundingAdjustment)}</span>
            </div>
            <div className="result-row total">
              <span>مبلغ نهایی مشتری</span>
              <strong>{formatIrrStringAsToman(breakdown.finalAmountIrr)}</strong>
            </div>
            <div className="result-row">
              <span>سهم سود (contribution)</span>
              <span>{formatIrrStringAsToman(breakdown.contributionIrr)}</span>
            </div>
            <div className="result-row">
              <span>حاشیهٔ مؤثر</span>
              <span>{toPersianDigits(breakdown.effectiveMarginBps)} bps ({formatBps(breakdown.effectiveMarginBps)})</span>
            </div>
            {breakdown.marginFloorApplied ? (
              <p className="warning">کف حاشیهٔ سود اعمال شد؛ حاشیهٔ درصدی هدف کمتر از کف تعیین‌شده بود.</p>
            ) : null}
            {response?.fx?.isManualOverride ? (
              <p className="warning">
                این محاسبه بر پایهٔ نرخ دستی «{response.fx.provider}» انجام شده است، نه نرخ مشاهده‌شدهٔ بازار.
              </p>
            ) : null}
          </>
        ) : (
          <p className="empty-hint">{error ? "محاسبه انجام نشد." : "برای دیدن تفکیک قیمت، شبیه‌سازی را اجرا کنید."}</p>
        )}
      </div>
    </div>
  );
}

function ComponentRow({ component }: { component: PricingComponent }) {
  return (
    <tr>
      <td>{component.labelFa}</td>
      <td className="bp-ltr">{component.bps === null ? "—" : `${toPersianDigits(component.bps)} bps`}</td>
      <td className="bp-ltr">
        {formatIrrStringAsToman(component.amountIrr)}
        {component.amountForeign !== null && component.currency === "USD" ? ` · ${formatUsd(component.amountForeign)}` : ""}
      </td>
    </tr>
  );
}

function emptyDraft(marketFxRate: string): Draft {
  const bps = {} as Record<BpsFieldKey, string>;
  for (const field of BPS_FIELDS) bps[field.key] = "0";
  const irr = {} as Record<IrrFieldKey, string>;
  for (const field of IRR_FIELDS) irr[field.key] = field.key === "roundingStepIrr" ? "10000" : "0";
  return {
    quantity: "1",
    supplierCostForeign: "50.00",
    marketFxRate,
    discountIrr: "0",
    quoteTtlSeconds: "600",
    bps,
    irr,
  };
}
