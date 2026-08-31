"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

/**
 * Lives beside the login route because sign-in and sign-out are one concern.
 * Floats over the topbar so neither panel shell has to be restructured.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setPending(true);
    try {
      await api.staffLogout();
    } finally {
      // Even a failed logout must drop the operator back to the login screen.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={pending}
      style={{
        position: "fixed",
        insetBlockStart: "17px",
        insetInlineStart: "34px",
        zIndex: 20,
        minHeight: "40px",
        padding: "0 14px",
        color: "#6b7c93",
        background: "#ffffff",
        border: "1px solid #e6ebf0",
        borderRadius: "10px",
        fontFamily: "inherit",
        fontSize: "12px",
        fontWeight: 700,
        cursor: pending ? "progress" : "pointer",
      }}
    >
      {pending ? "در حال خروج…" : "خروج"}
    </button>
  );
}
