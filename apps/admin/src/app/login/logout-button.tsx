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
      className="profile-logout-button"
    >
      {pending ? "در حال خروج…" : "خروج از حساب"}
    </button>
  );
}
