"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api";

/** Revoking is the API's job — the cookie is HttpOnly and JS cannot clear it. */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await api.logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" className="account-profile-logout" onClick={signOut} disabled={pending}>
      <LogOut size={16} aria-hidden="true" />
      {pending ? "در حال خروج…" : "خروج از حساب"}
    </button>
  );
}
