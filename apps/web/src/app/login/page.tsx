"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, FormMessage } from "@barat/ui";
import { Phone } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const identityType = /^[^@]+@[^@]+$/u.test(identifier) ? "EMAIL" : "MOBILE";
      await api.requestOtp({ identityType, identifier, purpose: "LOGIN" });
      router.push(`/otp?identifier=${encodeURIComponent(identifier)}` as never);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارسال کد ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page container" style={{ maxWidth: 420 }}>
      <div className="eyebrow">ورود</div>
      <h1 className="h2">ورود به برات</h1>
      <p className="muted">شماره موبایل یا ایمیل خود را وارد کنید تا کد یک‌بار مصرف برایتان ارسال شود.</p>

      <form className="card pad" style={{ marginTop: 18 }} onSubmit={submit}>
        <div className="field">
          <Label htmlFor="identifier" required>موبایل یا ایمیل</Label>
          <Input id="identifier" required startAdornment={<Phone size={16} />} placeholder="۰۹۱۲۱۲۳۴۵۶۷" value={identifier} onChange={(e) => setIdentifier(e.target.value)} invalid={Boolean(error)} />
          <FormMessage tone="error">{error}</FormMessage>
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={loading || !identifier}>
          {loading ? "در حال ارسال کد..." : "دریافت کد ورود"}
        </button>
      </form>
    </main>
  );
}
