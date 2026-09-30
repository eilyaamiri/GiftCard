"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { ApiClientError, api } from "@/lib/api";
import {
  TOP_UP_IMPORT_SKIP_LABELS,
  topUpImportResultSchema,
  type TopUpImportGame,
  type TopUpImportResult,
} from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";

const importEnvelopeSchema = z.object({ result: topUpImportResultSchema });

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
  const [pending, setPending] = useState<"preview" | "import" | null>(null);
  const [result, setResult] = useState<TopUpImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setPending(dryRun ? "preview" : "import");
    setError(null);
    try {
      const response = await api.post<{ result: TopUpImportResult }>(
        "/api/operator/suppliers/topup/import",
        { dryRun },
        importEnvelopeSchema,
      );
      setResult(response.result);
      if (!dryRun) router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(null);
    }
  }

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
        نمی‌شود. بازی‌های موجود تغییر نمی‌کنند. خواندن کاتالوگ کامل ممکن است تا یک دقیقه طول بکشد.
      </p>

      <div className="save-row" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="secondary-btn"
          disabled={pending !== null}
          onClick={() => run(true)}
        >
          {pending === "preview" ? "در حال خواندن کاتالوگ…" : "پیش‌نمایش ورود"}
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
