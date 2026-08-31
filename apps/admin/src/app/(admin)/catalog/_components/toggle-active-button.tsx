"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";

/**
 * Every "delete" in the catalog admin API is actually `DELETE /:id`, which
 * the server implements as a soft archive (`isActive: false`) — nothing is
 * ever hard-deleted here, so the label and confirmation say "deactivate".
 * Service fields are the one true hard delete; `hardDelete` switches the copy.
 */
export function ToggleActiveButton({
  path,
  label,
  confirmMessage,
  hardDelete = false,
}: {
  path: string;
  label?: string;
  confirmMessage: string;
  hardDelete?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm(confirmMessage)) return;
    setPending(true);
    setError(null);
    try {
      await api.del(path);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="secondary-btn" disabled={pending} onClick={onClick}>
        {pending ? "در حال انجام…" : (label ?? (hardDelete ? "حذف" : "غیرفعال‌سازی"))}
      </button>
      {error ? (
        <span className="muted" style={{ color: "var(--red)" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
