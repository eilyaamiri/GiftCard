"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer, FormMessage, Ltr, OtpInput, toPersianDigits } from "@barat/ui";
import { ShieldCheck } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { clearChallenge, saveChallenge, type OtpChallenge } from "../app/login/otp-challenge";

const GENERIC_FAILURE = "کد واردشده معتبر نیست یا مهلت آن تمام شده است.";

function secondsUntil(timestamp: number): number {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

export function AuthOtpStep({ challenge: initialChallenge, onBack }: Readonly<{ challenge: OtpChallenge; onBack?: () => void }>) {
  const router = useRouter();
  const [challenge, setChallenge] = useState(initialChallenge);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(secondsUntil(initialChallenge.resendAvailableAt));
  const [expired, setExpired] = useState(new Date(initialChallenge.expiresAt).getTime() <= Date.now());
  const lastSubmitted = useRef<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const verify = useCallback(async (value: string) => {
    const digits = value.replace(/\s/g, "");
    if (digits.length !== challenge.codeLength || verifying || lastSubmitted.current === digits) return;
    lastSubmitted.current = digits;
    setError(null);
    setVerifying(true);
    try {
      await api.verifyOtp({ challengeId: challenge.challengeId, code: digits });
      clearChallenge();
      router.replace(challenge.next as never);
      router.refresh();
    } catch (err) {
      setCode("");
      lastSubmitted.current = null;
      setError(err instanceof ApiClientError && err.isRateLimited ? err.message : GENERIC_FAILURE);
    } finally {
      setVerifying(false);
    }
  }, [challenge, router, verifying]);

  async function resend() {
    if (cooldown > 0 || resending) return;
    setError(null);
    setResending(true);
    try {
      const next = await api.requestOtp({ identityType: challenge.identityType, identifier: challenge.identifier, purpose: "LOGIN" });
      const updated: OtpChallenge = { ...challenge, challengeId: next.challengeId, maskedTarget: next.maskedTarget, codeLength: next.codeLength, expiresAt: next.expiresAt, resendAvailableAt: Date.now() + next.resendAvailableInSeconds * 1000 };
      saveChallenge(updated);
      setChallenge(updated);
      setCooldown(next.resendAvailableInSeconds);
      setExpired(false);
      setCode("");
      lastSubmitted.current = null;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارسال مجدد کد ممکن نشد.");
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <div className="eyebrow">SECURITY CHECK · برات</div>
      <h1 className="h2">کد ورود را وارد کنید</h1>
      <p className="muted">کد {toPersianDigits(challenge.codeLength)} رقمی برای <Ltr>{challenge.maskedTarget}</Ltr> ارسال شد.</p>
      <div className="auth-form otp-form">
        <OtpInput length={challenge.codeLength} value={code} onChange={setCode} onComplete={verify} disabled={verifying || expired} invalid={Boolean(error)} aria-label="کد یک‌بارمصرف" autoFocus />
        <p className="otp-paste-hint">کد را در خانه اول وارد کنید یا کد کامل را از پیامک یا ایمیل جای‌گذاری کنید.</p>
        <FormMessage tone="error">{error}</FormMessage>
        {expired ? <p className="muted auth-expiry">مهلت این کد به پایان رسید. کد تازه‌ای بگیرید.</p> : <p className="muted auth-expiry">اعتبار کد: <CountdownTimer expiresAt={challenge.expiresAt} onExpire={() => setExpired(true)} /></p>}
        <button type="button" className="btn btn-primary auth-submit" onClick={() => verify(code)} disabled={verifying || expired || code.replace(/\s/g, "").length < challenge.codeLength}>{verifying ? "در حال بررسی..." : "تأیید و ورود"}</button>
        <button type="button" className="btn btn-ghost auth-submit" onClick={resend} disabled={cooldown > 0 || resending}>{cooldown > 0 ? `ارسال مجدد کد (${toPersianDigits(cooldown)} ثانیه)` : resending ? "در حال ارسال..." : "ارسال مجدد کد"}</button>
        {onBack ? <button type="button" className="btn btn-ghost auth-submit" onClick={onBack}>ویرایش شماره یا ایمیل</button> : null}
      </div>
      <p className="auth-note"><ShieldCheck size={16} /> این کد را با هیچ‌کس، حتی پشتیبانی برات، در میان نگذارید.</p>
    </>
  );
}
