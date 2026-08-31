"use client";

import { useState } from "react";
import { giftCardRequests } from "@/lib/gift-card-requests";
import { InlineError, messageFor } from "../../(operator)/_components/error-notice";

export function FulfillGiftCardRequestForm({ requestId, needsPin }: { requestId: string; needsPin: boolean }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSaving(true);
    try { await giftCardRequests.fulfill(requestId, { code, ...(needsPin ? { pin } : {}) }); window.location.reload(); }
    catch (caught) { setError(messageFor(caught)); setSaving(false); }
  }
  return <form onSubmit={submit} style={{ display: "grid", gap: 8, minWidth: 220 }}>
    <input type="password" value={code} onChange={(event) => setCode(event.target.value)} placeholder="کد گیفت‌کارت" autoComplete="off" required minLength={4} />
    {needsPin ? <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="پین" autoComplete="off" required minLength={3} /> : null}
    <InlineError message={error} />
    <button className="primary-btn" type="submit" disabled={saving || code.trim().length < 4 || (needsPin && pin.trim().length < 3)}>{saving ? "در حال ثبت…" : "ثبت و ارسال برای اپراتور"}</button>
  </form>;
}
