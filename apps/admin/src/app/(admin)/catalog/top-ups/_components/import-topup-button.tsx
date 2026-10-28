"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ApiClientError, api } from "@/lib/api";
import {
  TOP_UP_IMPORT_SKIP_LABELS,
  topUpImportJobSchema,
  type TopUpImportGame,
  type TopUpImportJob,
  type TopUpImportResult,
} from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";

const jobEnvelopeSchema = z.object({ job: topUpImportJobSchema.nullable() });

/** A venue read takes minutes (one request per game, under the venue's rate limit), so the run is polled. */
const POLL_MS = 4_000;
/** Poll errors in a row before giving up; a single dropped request is not a failed import. */
const MAX_POLL_FAILURES = 5;
/** How long a finished preview is still shown after the page is reopened; the API reuses its read for as long. */
const RESUME_WINDOW_MS = 15 * 60 * 1000;

/**
 * The venues a top-up catalogue can be read from. The API refuses a code it
 * has no reader for (no key configured), and that answer is shown as is.
 */
const TOP_UP_SUPPLIERS = [
  { code: "fazercards-topup", label: "FazerCards" },
  { code: "resellcodes-topup", label: "ReSellCodes" },
] as const;
type TopUpSupplierCode = (typeof TOP_UP_SUPPLIERS)[number]["code"];

type Waited =
  | { readonly kind: "finished"; readonly job: TopUpImportJob }
  | { readonly kind: "lost" }
  | { readonly kind: "left" };

/** Polls the run that started at `startedAt` until it is no longer running. */
async function waitForJob(startedAt: string, isAlive: () => boolean): Promise<Waited> {
  let failures = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (!isAlive()) return { kind: "left" };
    try {
      const { job } = await api.get("/api/operator/suppliers/topup/import/status", jobEnvelopeSchema);
      failures = 0;
      /* Null or another start time: the API restarted, or someone else started a newer run. */
      if (job === null || job.startedAt !== startedAt) return { kind: "lost" };
      if (job.state !== "RUNNING") return { kind: "finished", job };
    } catch (caught) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) throw caught;
    }
  }
}

function isSupplierCode(code: string): code is TopUpSupplierCode {
  return TOP_UP_SUPPLIERS.some((supplier) => supplier.code === code);
}

const STATUS_LABELS: Record<TopUpImportGame["status"], string> = {
  NEW: "جدید",
  EXISTING: "موجود",
  SKIPPED: "رد شد",
};

/**
 * Brings the venue's games into the catalogue, in two deliberate steps.
 *
 * The first press is always a dry run: it reads the venue and shows exactly
 * what would be created — each game's account fields, which games want a
 * password (those are imported flagged and never sold), and what was skipped.
 * Only after reading that does the operator confirm the real run.
 *
 * Nothing the import creates is on sale. New games arrive inactive and each
 * one still needs its own review below; the import never rewrites a game
 * that already exists.
 */
export function ImportTopUpButton() {
  const router = useRouter();
  const [supplierCode, setSupplierCode] = useState<TopUpSupplierCode>("fazercards-topup");
  const [pending, setPending] = useState<"preview" | "import" | null>(null);
  const [result, setResult] = useState<TopUpImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  /** Shows how a run ended. */
  function settle(waited: Waited): void {
    if (waited.kind === "left") return;
    if (waited.kind === "lost") {
      setError("اجرای ورود قطع شد (سرور دوباره راه‌اندازی شد یا اجرای دیگری شروع شد). دوباره پیش‌نمایش بگیرید.");
      return;
    }
    const { job } = waited;
    if (job.state === "FAILED" || job.result === undefined) {
      setError(job.error ?? "ورود کاتالوگ ناموفق بود.");
      return;
    }
    setResult(job.result);
    if (!job.dryRun) router.refresh();
  }

  async function run(dryRun: boolean) {
    setPending(dryRun ? "preview" : "import");
    setError(null);
    try {
      const { job } = await api.post<{ job: TopUpImportJob | null }>(
        "/api/operator/suppliers/topup/import/start",
        { supplierCode, dryRun },
        jobEnvelopeSchema,
      );
      if (job === null) throw new ApiClientError(502, "پاسخ سرویس ناقص بود.");
      settle(await waitForJob(job.startedAt, () => alive.current));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      if (alive.current) setPending(null);
    }
  }

  /* Reopening the page while a run is going (or just finished) picks it up instead of starting a second one. */
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const { job } = await api.get("/api/operator/suppliers/topup/import/status", jobEnvelopeSchema);
        if (!alive.current || job === null || !isSupplierCode(job.supplierCode)) return;
        if (job.state === "RUNNING") {
          setSupplierCode(job.supplierCode);
          setPending(job.dryRun ? "preview" : "import");
          try {
            settle(await waitForJob(job.startedAt, () => alive.current));
          } finally {
            if (alive.current) setPending(null);
          }
        } else if (
          job.state === "DONE" &&
          job.dryRun &&
          job.finishedAt !== undefined &&
          Date.now() - Date.parse(job.finishedAt) < RESUME_WINDOW_MS
        ) {
          setSupplierCode(job.supplierCode);
          settle({ kind: "finished", job });
        }
      } catch {
        /* Nothing to resume, or the status could not be read: the buttons still work. */
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  const canConfirm =
    result?.dryRun === true && result.totals.newGames + result.totals.newOffers > 0;

  return (
    <div className="card panel" style={{ marginBottom: 16 }}>
      <div className="section-label">
        <h3>ورود بازی‌ها از تأمین‌کننده</h3>
        <span>ابتدا پیش‌نمایش</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        بازی‌ها و بسته‌هایی را که هنوز در کاتالوگ نیستند اضافه می‌کند. همه غیرفعال ثبت می‌شوند و تا
        بررسی شما فروخته نمی‌شوند. بازی‌ای که رمز عبور حساب می‌خواهد علامت می‌خورد و هرگز فروخته
        نمی‌شود. بازی‌های موجود تغییر نمی‌کنند. خواندن کاتالوگ کامل ممکن است چند دقیقه طول بکشد؛ صفحه را باز نگه دارید یا بعداً برگردید، اجرا ادامه دارد.
      </p>

      <div className="save-row" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          تأمین‌کننده
          <select
            value={supplierCode}
            disabled={pending !== null}
            onChange={(event) => {
              // A preview belongs to the venue it read; confirming must never import another one.
              setSupplierCode(event.target.value as TopUpSupplierCode);
              setResult(null);
              setError(null);
            }}
          >
            {TOP_UP_SUPPLIERS.map((supplier) => (
              <option key={supplier.code} value={supplier.code}>
                {supplier.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-btn"
          disabled={pending !== null}
          onClick={() => run(true)}
        >
          {pending === "preview" ? "در حال خواندن کاتالوگ (چند دقیقه)…" : "پیش‌نمایش ورود"}
        </button>
        {canConfirm ? (
          <button
            type="button"
            className="primary-btn"
            disabled={pending !== null}
            onClick={() => run(false)}
          >
            {pending === "import"
              ? "در حال ثبت…"
              : `ثبت ${formatCount(result.totals.newGames)} بازی و ${formatCount(result.totals.newOffers)} بسته`}
          </button>
        ) : null}
        {error ? (
          <span className="muted" style={{ color: "var(--red)" }}>
            {error}
          </span>
        ) : null}
      </div>

      {result ? <ImportReport result={result} /> : null}
    </div>
  );
}

function ImportReport({ result }: { result: TopUpImportResult }) {
  const { totals } = result;
  const nothingNew = totals.newGames + totals.newOffers === 0;
  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        {result.dryRun ? "پیش‌نمایش — هنوز چیزی ثبت نشده است. " : "ثبت شد. "}
        {nothingNew
          ? "چیز تازه‌ای برای ورود نبود."
          : `${formatCount(totals.newGames)} بازی جدید، ${formatCount(totals.newOffers)} بستهٔ جدید، ` +
            `${formatCount(totals.credentialGames)} بازی نیازمند رمز عبور، ${formatCount(totals.skipped)} مورد رد شد.`}
        {result.supplierCreated
          ? result.dryRun
            ? " تأمین‌کننده هم به‌صورت غیرفعال ساخته می‌شود."
            : " تأمین‌کننده به‌صورت غیرفعال ساخته شد."
          : null}
      </p>
      {!result.dryRun && !nothingNew ? (
        <p className="muted">
          هر بازی جدید را در جدول زیر باز کنید، فیلدها و بسته‌هایش را بررسی کنید و سپس فعال کنید.
        </p>
      ) : null}

      {result.games.length > 0 ? (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>بازی</th>
                <th>وضعیت</th>
                <th>اطلاعات حساب</th>
                <th>بستهٔ جدید</th>
              </tr>
            </thead>
            <tbody>
              {result.games.map((game) => (
                <tr key={game.providerCategoryId}>
                  <td>
                    {game.name}
                    <div className="muted bp-ltr" style={{ fontSize: 11 }}>
                      {game.slug ?? game.providerCategoryId}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        game.status === "SKIPPED" || game.requiresCredentials
                          ? "badge-danger"
                          : game.status === "NEW"
                            ? "badge-success"
                            : "badge-info"
                      }`}
                    >
                      {STATUS_LABELS[game.status]}
                    </span>
                    {game.skipReason ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {TOP_UP_IMPORT_SKIP_LABELS[game.skipReason]}
                        {game.failureCode ? <span className="bp-ltr"> ({game.failureCode})</span> : null}
                      </div>
                    ) : null}
                    {game.requiresCredentials && game.status !== "SKIPPED" ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        رمز عبور می‌خواهد — فروخته نمی‌شود
                      </div>
                    ) : null}
                  </td>
                  <td className="bp-ltr">
                    {game.fields.length === 0
                      ? "—"
                      : game.fields
                          .map((field) => `${field.label}${field.credential ? " 🔒" : ""}`)
                          .join("، ")}
                  </td>
                  <td>{formatCount(game.newOffers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
