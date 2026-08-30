"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OtpInput, FormMessage, Ltr, toPersianDigits } from "@barat/ui";
import { api, ApiClientError } from "@/lib/api";

const RESEND_SECONDS = 60;

function OtpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const identifier = params.get("identifier") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function verify(value: string) {
    setError(null);
    setVerifying(true);
    try {
      await api.post("/api/auth/otp/verify", { challengeId: identifier, code: value });
      router.push("/account" as never);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "کد وارد شده صحیح نیست.");
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setError(null);
    try {
      const identityType = /^[^@]+@[^@]+$/u.test(identifier) ? "EMAIL" : "MOBILE";
      await api.post("/api/auth/otp/request", { identityType, identifier, purpose: "LOGIN" });
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارسال مجدد کد ممکن نشد.");
    }
  }

  return (
    <main className="page container" style={{ maxWidth: 420 }}>
      <div className="eyebrow">تأیید هویت</div>
      <h1 className="h2">کد تأیید را وارد کنید</h1>
      <p className="muted">کد ۶ رقمی برای <Ltr>{identifier || "شماره شما"}</Ltr> ارسال شد.</p>

      <div className="card pad" style={{ marginTop: 18 }}>
        <OtpInput length={6} value={code} onChange={setCode} onComplete={verify} disabled={verifying} invalid={Boolean(error)} autoFocus />
        <FormMessage tone="error">{error}</FormMessage>
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => verify(code)} disabled={verifying || code.replace(/\s/g, "").length < 6}>
          {verifying ? "در حال بررسی..." : "تأیید و ورود"}
        </button>
        <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `ارسال مجدد کد (${toPersianDigits(cooldown)} ثانیه)` : "ارسال مجدد کد"}
        </button>
      </div>
    </main>
  );
}

export default function OtpPage() {
  return (
    <Suspense fallback={<main className="page container">در حال بارگذاری...</main>}>
      <OtpForm />
    </Suspense>
  );
}
