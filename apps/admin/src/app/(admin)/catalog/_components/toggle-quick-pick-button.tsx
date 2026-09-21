"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";

/**
 * `isQuickPick` decides whether a product is offered in the homepage
 * quick-pick rail. Unlike `ToggleActiveButton`, flipping it archives nothing —
 * so this toggles in place with no confirm dialog.
 */
export function ToggleQuickPickButton({
  productId,
  isQuickPick,
}: {
  productId: string;
  isQuickPick: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      await api.put(`/api/admin/catalog/products/${productId}`, { isQuickPick: !isQuickPick });
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
        {pending ? "در حال انجام…" : isQuickPick ? "حذف از صفحهٔ اول" : "نمایش در صفحهٔ اول"}
      </button>
      {error ? (
        <span className="muted" style={{ color: "var(--red)" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
