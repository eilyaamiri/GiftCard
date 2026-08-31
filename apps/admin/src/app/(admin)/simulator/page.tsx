import { getFxRateResponseSchema, type GetFxRateResponse } from "@barat/contracts";
import { ApiClientError, FINANCIAL_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { wirePricingRuleListSchema, type WirePricingRule } from "../pricing-rules/pricing-rule-schema";
import { SimulatorForm } from "./simulator-form";

export const metadata = { title: "شبیه‌ساز استعلام | پنل ادمین برات پی" };

export default async function SimulatorPage() {
  await requireRole(FINANCIAL_WRITE_ROLES);

  const [rules, loadError] = await loadRules();
  const initialFxRate = await loadLiveMidRate();

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">قیمت‌گذاری و ارز</p>
          <h1>شبیه‌ساز استعلام</h1>
        </div>
        <p className="muted">همان تابع هستهٔ قیمت‌گذاری مشتری را صدا می‌زند؛ هیچ مبلغی در مرورگر محاسبه نمی‌شود</p>
      </div>

      {loadError ? (
        <div className="card panel" style={{ marginBlockEnd: 18 }}>
          <p className="warning" style={{ marginBlockStart: 0 }}>{loadError}</p>
        </div>
      ) : null}

      <SimulatorForm rules={rules.filter((rule) => rule.isActive)} initialFxRate={initialFxRate} />
    </div>
  );
}

async function loadRules(): Promise<[readonly WirePricingRule[], string | null]> {
  try {
    return [await api.get<WirePricingRule[]>("/api/pricing/rules", wirePricingRuleListSchema), null];
  } catch (error) {
    const message = error instanceof ApiClientError ? error.message : "دریافت قواعد قیمت‌گذاری ممکن نشد.";
    return [[], message];
  }
}

/** Prefills the market rate. A missing rate leaves the field empty rather than inventing one. */
async function loadLiveMidRate(): Promise<string | null> {
  try {
    const current = await api.get<GetFxRateResponse>("/api/fx/current", getFxRateResponseSchema);
    return current.snapshot.midRate;
  } catch {
    return null;
  }
}
