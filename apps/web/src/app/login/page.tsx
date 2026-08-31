"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input, Label, FormMessage, toLatinDigits } from "@barat/ui";
import { Phone, ShieldCheck } from "lucide-react";
import { emailSchema, mobileSchema } from "@barat/contracts";
import type { IdentityType } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { safeNextPath, saveChallenge } from "./otp-challenge";

/**
 * Persian digits are what an Iranian keyboard produces, and a pasted number
 * often carries spaces or dashes. Normalise before validating so a legitimate
 * number is never rejected for cosmetic reasons.
 */
function normaliseIdentifier(raw: string): string {
  return toLatinDigits(raw).replace(/[\s‌-]/g, "").trim();
}

function classify(identifier: string): { readonly identityType: IdentityType; readonly value: string } | null {
  const mobile = mobileSchema.safeParse(identifier);
  if (mobile.success) return { identityType: "MOBILE", value: mobile.data };
  const email = emailSchema.safeParse(identifier);
  if (email.success) return { identityType: "EMAIL", value: email.data };
  return null;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void api.me().then((result) => {
      if (active && result.isAuthenticated) router.replace(next || "/account");
    }).catch(() => { /* The form will report the next actionable error. */ });
    return () => { active = false; };
  }, [next, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const normalised = normaliseIdentifier(identifier);
    const classified = classify(normalised);
    if (!classified) {
      setError("شماره موبایل یا ایمیل معتبر وارد کنید.");
      return;
    }

    setLoading(true);
    try {
      const challenge = await api.requestOtp({ identityType: classified.identityType, identifier: classified.value, purpose: "LOGIN" });
      saveChallenge({
        challengeId: challenge.challengeId,
        identityType: classified.identityType,
        identifier: classified.value,
        maskedTarget: challenge.maskedTarget,
        codeLength: challenge.codeLength,
        expiresAt: challenge.expiresAt,
        resendAvailableAt: Date.now() + challenge.resendAvailableInSeconds * 1000,
        next,
      });
      router.push("/otp");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارسال کد ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card-wrap container">
        <section className="auth-card">
          <div className="eyebrow">WELCOME BACK · برات</div>
          <h1 className="h2">ورود به حساب شما</h1>
          <p className="muted">شماره موبایل یا ایمیل خود را وارد کنید تا کد یک‌بارمصرف برایتان ارسال شود.</p>

          {params.get("reason") === "expired" ? (
            <div className="alert warn" style={{ marginBlockEnd: 14 }}>نشست شما پایان یافته است. برای ادامه دوباره وارد شوید.</div>
          ) : null}

          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="field">
              <Label htmlFor="identifier" required>شماره موبایل یا ایمیل</Label>
              <Input
                id="identifier"
                name="identifier"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                ltr
                startAdornment={<Phone size={16} />}
                placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                invalid={Boolean(error)}
                aria-describedby="identifier-error"
              />
              <FormMessage tone="error" id="identifier-error">{error}</FormMessage>
            </div>
            <button type="submit" className="btn btn-primary auth-submit" disabled={loading || identifier.trim().length === 0}>
              {loading ? "در حال ارسال کد..." : "ارسال کد ورود"}
            </button>
          </form>
          <p className="auth-note"><ShieldCheck size={16} /> با ادامه، شرایط استفاده و حریم خصوصی برات را می‌پذیرید.</p>
        </section>
        <aside className="auth-visual" aria-label="امنیت برات">
          <span className="auth-visual-kicker">SECURE BY DESIGN</span>
          <strong>ورود ساده،<br />حفاظت جدی.</strong>
          <p>کد ورود فقط برای شماست؛ برات هیچ‌وقت آن را از شما درخواست نمی‌کند.</p>
          <div className="auth-orbit" aria-hidden="true" />
        </aside>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="page container">در حال بارگذاری...</main>}>
      <LoginForm />
    </Suspense>
  );
}
