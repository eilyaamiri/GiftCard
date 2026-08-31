import { getFxRateResponseSchema, type GetFxRateResponse } from "@barat/contracts";
import { ApiClientError, FINANCIAL_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { PricingRuleEditor } from "./pricing-rule-editor";
import { wirePricingRuleListSchema, type WirePricingRule } from "./pricing-rule-schema";

export const metadata = { title: "قواعد قیمت‌گذاری | پنل ادمین برات پی" };

export default async function PricingRulesPage() {
  // Server-side gate. Hiding the sidebar link is not access control, and the
  // API refuses the same call independently.
  await requireRole(FINANCIAL_WRITE_ROLES);

  let rules: readonly WirePricingRule[] = [];
  let loadError: string | null = null;
  try {
    rules = await api.get<WirePricingRule[]>("/api/pricing/rules", wirePricingRuleListSchema);
  } catch (error) {
    loadError = error instanceof ApiClientError ? error.message : "دریافت قواعد قیمت‌گذاری ممکن نشد.";
  }

  const active = rules.filter((rule) => rule.isActive);
  const referenceFxRate = await loadReferenceFxRate();

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">قیمت‌گذاری و ارز</p>
          <h1>قواعد قیمت‌گذاری</h1>
        </div>
        <p className="muted">هر ذخیره یک نسخهٔ جدید می‌سازد؛ نسخهٔ قبلی برای ردیابی باقی می‌ماند</p>
      </div>

      {loadError ? (
        <div className="card panel">
          <p className="warning" style={{ marginBlockStart: 0 }}>{loadError}</p>
        </div>
      ) : null}

      {!loadError && active.length === 0 ? (
        <div className="card panel">
          <p className="empty-hint">هیچ قاعدهٔ فعالی ثبت نشده است.</p>
        </div>
      ) : null}

      {active.map((rule) => (
        <div key={rule.id} style={{ marginBlockEnd: 26 }}>
          <PricingRuleEditor rule={rule} referenceFxRate={referenceFxRate} />
        </div>
      ))}
    </div>
  );
}

/**
 * The live mid rate, used only to prefill the "what would this change cost the
 * customer" preview. A stale or missing rate is not an error here — the preview
 * simply asks the operator for a reference rate instead of inventing one.
 */
async function loadReferenceFxRate(): Promise<string | null> {
  try {
    const current = await api.get<GetFxRateResponse>("/api/fx/current", getFxRateResponseSchema);
    return current.snapshot.midRate;
  } catch {
    return null;
  }
}
