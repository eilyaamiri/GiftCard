"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Checkbox, FormMessage, Input, Label } from "@barat/ui";
import { api, ApiClientError, type AccountProfile } from "@/lib/api";

export function ProfileForm({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(profile.customer.firstName ?? "");
  const [lastName, setLastName] = useState(profile.customer.lastName ?? "");
  const [marketingOptIn, setMarketingOptIn] = useState(profile.marketingOptIn);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last) {
      setError("نام و نام خانوادگی را کامل وارد کنید.");
      return;
    }

    setSaving(true);
    try {
      await api.updateAccountProfile({ firstName: first, lastName: last, marketingOptIn });
      setSaved(true);
      // The overview reads the same profile, so the server data has to re-render.
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ذخیره تغییرات ممکن نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card pad" onSubmit={submit} noValidate>
      <div className="field">
        <Label htmlFor="firstName" required>نام</Label>
        <Input id="firstName" name="firstName" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} invalid={Boolean(error) && !firstName.trim()} />
      </div>
      <div className="field">
        <Label htmlFor="lastName" required>نام خانوادگی</Label>
        <Input id="lastName" name="lastName" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} invalid={Boolean(error) && !lastName.trim()} />
      </div>
      <div className="field">
        <Checkbox id="marketingOptIn" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} label="اطلاع از تخفیف‌ها و خبرهای برات" />
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      {saved ? <FormMessage tone="hint">تغییرات ذخیره شد.</FormMessage> : null}
      <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginBlockStart: 12 }}>
        {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
      </button>
    </form>
  );
}
