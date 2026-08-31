"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, FormMessage, Input, Label, Ltr } from "@barat/ui";
import { api, ApiClientError, type AccountProfile } from "@/lib/api";

/**
 * The e-mail row of the identity card, in place.
 *
 * It renders the masked address the API returns — the raw one is never sent to
 * the browser — and only turns into an input when the customer asks to change
 * it. A new address always comes back unverified, and the copy says so rather
 * than letting the missing badge speak for itself.
 */
export function EmailForm({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const { customer } = profile;

  function open() {
    setEditing(true);
    setError(null);
    setSaved(false);
    setEmail("");
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setEmail("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("ایمیل معتبر وارد کنید.");
      return;
    }

    setSaving(true);
    try {
      await api.updateAccountEmail({ email: value });
      setSaved(true);
      setEditing(false);
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? (err.detailFor("email") ?? err.message)
          : "ثبت ایمیل ممکن نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <>
        <div className="summary-line">
          <span>ایمیل</span>
          <span className="profile-identity-value">
            <Ltr>{customer.maskedEmail ?? "—"}</Ltr>
            {customer.maskedEmail ? (
              customer.isEmailVerified ? (
                <Badge tone="ok">تأیید شده</Badge>
              ) : (
                <Badge tone="wait">تأیید نشده</Badge>
              )
            ) : null}
            <button type="button" className="btn btn-ghost profile-inline-btn" onClick={open}>
              {customer.maskedEmail ? "تغییر" : "افزودن"}
            </button>
          </span>
        </div>
        {saved ? (
          <FormMessage tone="hint">
            ایمیل جدید ثبت شد. تا زمانی که تأیید نشده، برای ورود به حساب کاربرد ندارد.
          </FormMessage>
        ) : null}
      </>
    );
  }

  return (
    <form className="profile-inline-form" onSubmit={submit} noValidate>
      <div className="field">
        <Label htmlFor="accountEmail" required>
          ایمیل جدید
        </Label>
        <Input
          id="accountEmail"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          ltr
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          invalid={Boolean(error)}
        />
        <FormMessage tone="hint">
          ورود به حساب همچنان با شماره موبایل انجام می‌شود؛ ایمیل تا زمان تأیید، فقط برای اطلاع‌رسانی
          است.
        </FormMessage>
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      <div className="profile-form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "در حال ثبت..." : "ثبت ایمیل"}
        </button>
        <button type="button" className="btn btn-outline" onClick={cancel} disabled={saving}>
          انصراف
        </button>
      </div>
    </form>
  );
}
