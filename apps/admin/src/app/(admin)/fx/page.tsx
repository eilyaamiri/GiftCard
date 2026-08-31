import { getFxRateResponseSchema, type FxProviderHealth, type FxRateSnapshot, type GetFxRateResponse } from "@barat/contracts";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { ApiClientError, FINANCIAL_WRITE_ROLES, STAFF_ROLE_LABELS, api, hasRole } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { formatAgeSeconds, formatDecimalString } from "@/lib/format-bps";
import { FxOverridePanel } from "./fx-override-panel";
import {
  FX_SOURCE_LABELS,
  fxHistoryResponseSchema,
  fxProviderHealthResponseSchema,
  type FxHistoryResponse,
  type FxProviderHealthResponse,
} from "./fx-schema";

export const metadata = { title: "نرخ ارز | پنل ادمین برات پی" };

const PAIR = "USD_IRR" as const;

export default async function FxPage() {
  const staff = await requireRole(FINANCIAL_WRITE_ROLES);
  // Narrower than the page gate and identical to the API's FX_OVERRIDE_ROLES.
  const canOverride = hasRole(staff.role, ["ADMIN", "FINANCE"]);

  const [current, history, health] = await Promise.all([loadCurrent(), loadHistory(), loadHealth()]);

  const snapshot = current.value?.snapshot ?? null;
  const activeOverride = snapshot?.isManualOverride ? snapshot : findActiveOverride(history.value?.items ?? []);
  const providers = current.value?.providers ?? health.value?.providers ?? [];
  const suggestedMidRate = snapshot?.midRate ?? history.value?.items[0]?.midRate ?? null;

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">قیمت‌گذاری و ارز</p>
          <h1>نرخ ارز USD/IRR</h1>
        </div>
        <p className="muted">نرخ کهنه، صدور استعلام جدید را متوقف می‌کند</p>
      </div>

      {current.error ? (
        <div className="card panel" style={{ marginBlockEnd: 18 }}>
          <p className="warning" style={{ marginBlockStart: 0 }}>
            نرخ قابل استفاده‌ای در دسترس نیست: {current.error}
          </p>
        </div>
      ) : null}

      <div className="stat-strip">
        <div className="card stat-tile">
          <span>نرخ میانی جاری</span>
          <strong className="bp-ltr">{snapshot ? formatDecimalString(snapshot.midRate) : "—"}</strong>
        </div>
        <div className="card stat-tile">
          <span>نرخ مؤثر (پس از اسپرد و بافر)</span>
          <strong className="bp-ltr">{current.value ? formatDecimalString(current.value.effectiveRate) : "—"}</strong>
        </div>
        <div className="card stat-tile">
          <span>سن نرخ</span>
          <strong className={snapshot?.isStale ? "freshness-bad" : "freshness-good"}>
            {snapshot ? formatAgeSeconds(snapshot.ageSeconds) : "—"}
          </strong>
        </div>
        <div className="card stat-tile">
          <span>حالت</span>
          <strong>{activeOverride ? "override دستی فعال" : "خودکار"}</strong>
        </div>
      </div>

      <div className="two-col">
        <div style={{ display: "grid", gap: 16 }}>
          <div className="card panel">
            <div className="panel-heading">
              <div>
                <h2 className="panel-title">تاریخچهٔ نرخ</h2>
                <p className="panel-caption">
                  {history.value ? `${toPersianDigits(history.value.meta.total)} رکورد ثبت‌شده` : "در دسترس نیست"}
                </p>
              </div>
            </div>
            {history.error ? <p className="warning">{history.error}</p> : null}
            {history.value && history.value.items.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>زمان دریافت</th>
                      <th>میانی</th>
                      <th>خرید</th>
                      <th>فروش</th>
                      <th>منبع</th>
                      <th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.value.items.map((item) => (
                      <tr key={item.id ?? item.receivedAt}>
                        <td>{formatJalaliDate(item.receivedAt)}</td>
                        <td className="bp-ltr">{formatDecimalString(item.midRate)}</td>
                        <td className="bp-ltr">{formatDecimalString(item.buyRate)}</td>
                        <td className="bp-ltr">{formatDecimalString(item.sellRate)}</td>
                        <td>{FX_SOURCE_LABELS[item.source] ?? item.source}</td>
                        <td>
                          {item.isManualOverride ? (
                            <span className="badge badge-danger">override</span>
                          ) : item.isStale ? (
                            <span className="badge badge-wait">کهنه</span>
                          ) : (
                            <span className="badge badge-success">معتبر</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : history.error ? null : (
              <p className="empty-hint">رکوردی ثبت نشده است.</p>
            )}
          </div>

          <div className="card panel">
            <div className="panel-heading">
              <div>
                <h2 className="panel-title">سلامت Providerها</h2>
                <p className="panel-caption">این نما حتی وقتی هیچ نرخ قابل استفاده‌ای نیست هم پاسخ می‌دهد</p>
              </div>
            </div>
            {health.error && providers.length === 0 ? <p className="warning">{health.error}</p> : null}
            <div className="kv-list">
              {providers.map((provider) => (
                <ProviderRow key={provider.provider} provider={provider} />
              ))}
            </div>
          </div>
        </div>

        <FxOverridePanel
          pair={PAIR}
          activeOverride={activeOverride}
          suggestedMidRate={suggestedMidRate}
          canOverride={canOverride}
          actorLabel={`${staff.email} (${STAFF_ROLE_LABELS[staff.role]})`}
        />
      </div>
    </div>
  );
}

function ProviderRow({ provider }: { provider: FxProviderHealth }) {
  return (
    <div className="kv-row">
      <span>{provider.provider}</span>
      <span>
        <span className={provider.isHealthy ? "freshness-good" : "freshness-bad"}>
          {provider.isHealthy ? "سالم" : "ناسالم"}
        </span>
        {provider.lastErrorCode ? ` · ${provider.lastErrorCode}` : ""}
        {provider.consecutiveFailures > 0 ? ` · ${toPersianDigits(provider.consecutiveFailures)} خطای پیاپی` : ""}
        {provider.lastSuccessAt ? ` · آخرین موفقیت ${formatJalaliDate(provider.lastSuccessAt)}` : ""}
      </span>
    </div>
  );
}

/**
 * `/api/fx/current` returns 503 while the rate is stale, which is exactly when
 * an operator most needs this page. The history row is then the only place the
 * active override is visible.
 */
function findActiveOverride(items: readonly FxRateSnapshot[]): FxRateSnapshot | null {
  const now = Date.now();
  return (
    items.find(
      (item) => item.isManualOverride && (item.expiresAt === null || Date.parse(item.expiresAt) > now),
    ) ?? null
  );
}

interface Loaded<T> {
  value: T | null;
  error: string | null;
}

async function load<T>(request: () => Promise<T>, fallback: string): Promise<Loaded<T>> {
  try {
    return { value: await request(), error: null };
  } catch (error) {
    return { value: null, error: error instanceof ApiClientError ? error.message : fallback };
  }
}

function loadCurrent(): Promise<Loaded<GetFxRateResponse>> {
  return load(
    () => api.get<GetFxRateResponse>(`/api/fx/current?pair=${PAIR}`, getFxRateResponseSchema),
    "دریافت نرخ جاری ممکن نشد.",
  );
}

function loadHistory(): Promise<Loaded<FxHistoryResponse>> {
  return load(
    () => api.get<FxHistoryResponse>(`/api/fx/history?pair=${PAIR}&pageSize=20`, fxHistoryResponseSchema),
    "دریافت تاریخچهٔ نرخ ممکن نشد.",
  );
}

function loadHealth(): Promise<Loaded<FxProviderHealthResponse>> {
  return load(
    () => api.get<FxProviderHealthResponse>("/api/fx/health", fxProviderHealthResponseSchema),
    "دریافت وضعیت Providerها ممکن نشد.",
  );
}
