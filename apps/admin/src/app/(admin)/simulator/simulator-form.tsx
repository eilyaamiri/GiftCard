"use client";

import { useEffect, useState } from "react";
import type { SimulateQuoteResponse } from "@barat/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * The simulator is deliberately a thin API client. Pricing is never calculated
 * in the browser: `/api/pricing/simulate` invokes the same pure engine used by
 * customer quotes, and returns the auditable breakdown as exact wire strings.
 */
export function SimulatorForm() {
  const [supplierCostUsd, setSupplierCostUsd] = useState("50");
  const [usdRate, setUsdRate] = useState("1920000");
  const [spreadBps, setSpreadBps] = useState("150");
  const [riskBufferBps, setRiskBufferBps] = useState("50");
  const [gatewayFeeBps, setGatewayFeeBps] = useState("145");
  const [serviceFeeBps, setServiceFeeBps] = useState("200");
  const [marginBps, setMarginBps] = useState("800");
  const [response, setResponse] = useState<SimulateQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const request = {
      skuId: null,
      serviceId: null,
      supplierOfferId: null,
      quantity: 1,
      supplierCostForeign: supplierCostUsd,
      supplierCostCurrency: "USD",
      marketFxRate: usdRate,
      rule: {
        id: "simulator-rule",
        name: "Admin simulator",
        version: 1,
        fxSpreadBps: parseBps(spreadBps),
        fxRiskBufferBps: parseBps(riskBufferBps),
        serviceFeeBps: parseBps(serviceFeeBps),
        serviceFeeFixedIrr: "0",
        operationalFeeIrr: "0",
        targetMarginBps: parseBps(marginBps),
        minimumMarginIrr: "0",
        paymentFeeBps: parseBps(gatewayFeeBps),
        paymentFeeFixedIrr: "0",
        quoteTtlSeconds: 600,
        roundingStepIrr: "10000",
        maxSupplierCostToleranceBps: 500,
      },
    };

    void fetch(`${API_URL}/api/pricing/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) throw new Error("SIMULATOR_REQUEST_FAILED");
        return (await result.json()) as SimulateQuoteResponse;
      })
      .then((nextResponse) => {
        setResponse(nextResponse);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setResponse(null);
        setError("برای دریافت محاسبهٔ معتبر، اتصال به API ادمین برقرار نشد.");
      });

    return () => controller.abort();
  }, [supplierCostUsd, usdRate, spreadBps, riskBufferBps, gatewayFeeBps, serviceFeeBps, marginBps]);

  const breakdown = response?.breakdown;

  return (
    <div className="simulator-grid">
      <div className="card panel">
        <div className="section-label">
          <h3>ورودی‌ها</h3>
        </div>
        <div className="form-grid">
          <label>
            SKU
            <select defaultValue="apple-50-us">
              <option value="apple-50-us">Apple Gift Card 50 USD (US)</option>
              <option value="google-25-tr">Google Play 25 USD (TR)</option>
              <option value="ps-50-us">PlayStation 50 USD (US)</option>
            </select>
          </label>
          <label>
            تأمین‌کننده
            <select defaultValue="tillo">
              <option value="tillo">Tillo</option>
              <option value="reloadly">Reloadly</option>
            </select>
          </label>
          <label>
            هزینهٔ تأمین‌کننده (USD)
            <input className="bp-ltr" value={supplierCostUsd} onChange={(event) => setSupplierCostUsd(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            نرخ USD/IRR
            <input className="bp-ltr" value={usdRate} onChange={(event) => setUsdRate(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            اسپرد (bps)
            <input className="bp-ltr" value={spreadBps} onChange={(event) => setSpreadBps(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            بافر ریسک (bps)
            <input className="bp-ltr" value={riskBufferBps} onChange={(event) => setRiskBufferBps(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            کارمزد درگاه (bps)
            <input className="bp-ltr" value={gatewayFeeBps} onChange={(event) => setGatewayFeeBps(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            کارمزد سرویس (bps)
            <input className="bp-ltr" value={serviceFeeBps} onChange={(event) => setServiceFeeBps(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            حاشیهٔ سود هدف (bps)
            <input className="bp-ltr" value={marginBps} onChange={(event) => setMarginBps(event.target.value)} inputMode="numeric" />
          </label>
        </div>
      </div>

      <div className="card panel">
        <div className="section-label">
          <h3>خروجی</h3>
          <span>محاسبهٔ معتبر از موتور قیمت‌گذاری API</span>
        </div>
        {breakdown ? (
          <>
            <div className="result-row"><span>هزینهٔ تأمین‌کننده</span><span>{toman(breakdown.supplierCostIrr)}</span></div>
            <div className="result-row"><span>هزینهٔ ارز (اسپرد + بافر)</span><span>{toman(addIrr(breakdown.fxSpreadAmount, breakdown.fxRiskBufferAmount))}</span></div>
            <div className="result-row"><span>کارمزدها (درگاه + سرویس)</span><span>{toman(addIrr(breakdown.paymentFee, breakdown.serviceFee, breakdown.operationalFee))}</span></div>
            <div className="result-row"><span>حاشیهٔ سود</span><span>{toman(breakdown.marginAmount)}</span></div>
            <div className="result-row total"><span>قیمت نهایی مشتری</span><strong>{toman(breakdown.finalAmountIrr)}</strong></div>
            <div className="result-row"><span>حاشیهٔ سود (٪)</span><span>{formatBpsPercent(breakdown.effectiveMarginBps)}٪</span></div>
            <div className="result-row"><span>Contribution</span><span>{toman(breakdown.contributionIrr)}</span></div>
          </>
        ) : (
          <p className="muted">{error ?? "در حال دریافت محاسبه…"}</p>
        )}
      </div>
    </div>
  );
}

function parseBps(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function addIrr(...values: readonly string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function toman(irr: string): string {
  return `${(BigInt(irr) / 10n).toLocaleString("fa-IR")} تومان`;
}

function formatBpsPercent(value: number): string {
  const bps = BigInt(String(value));
  const sign = bps < 0n ? "-" : "";
  const absolute = bps < 0n ? -bps : bps;
  const fraction = absolute % 100n;
  const fractionText = fraction.toString().padStart(2, "0").replace(/0+$/u, "");
  return `${sign}${(absolute / 100n).toString()}${fractionText ? `.${fractionText}` : ""}`;
}
