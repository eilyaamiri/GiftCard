"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OtpInput, FormMessage, Ltr, CountdownTimer, toPersianDigits } from "@barat/ui";
import { ShieldCheck } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { clearChallenge, readChallenge, saveChallenge, type OtpChallenge } from "../login/otp-challenge";

/**
 * A single generic failure message for every rejected code.
 *
 * The API already answers "wrong", "expired" and "no such challenge" with one
 * indistinguishable response so that nobody can probe which phone numbers are
 * registered; restating a more specific message here would undo that.
 */
const GENERIC_FAILURE = "کد واردشده معتبر نیست یا مهلت آن تمام شده است.";

function secondsUntil(timestamp: number): number {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

export default function OtpPage() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expired, setExpired] = useState(false);
  /* onComplete fires on every keystroke once the boxes are full; without this
   * a corrected digit would spend a verify attempt on the same wrong code. */
  const lastSubmitted = useRef<string | null>(null);

  useEffect(() => {
    const stored = readChallenge();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setChallenge(stored);
    setCooldown(secondsUntil(stored.resendAvailableAt));
    setExpired(new Date(stored.expiresAt).getTime() <= Date.now());
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const verify = useCallback(
    async (value: string) => {
      if (!challenge) return;
      const digits = value.replace(/\s/g, "");
      if (digits.length !== challenge.codeLength || verifying) return;
      if (lastSubmitted.current === digits) return;
      lastSubmitted.current = digits;

      setError(null);
      setVerifying(true);
      try {
        await api.verifyOtp({ challengeId: challenge.challengeId, code: digits });
        clearChallenge();
        setCode("");
        const destination = challenge.next;
        // refresh() so the server components re-render with the new session cookie.
        router.replace(destination as never);
        router.refresh();
      } catch (err) {
        setCode("");
        lastSubmitted.current = null;
        if (err instanceof ApiClientError && err.isRateLimited) {
          setError(err.message);
        } else {
          setError(GENERIC_FAILURE);
        }
      } finally {
        setVerifying(false);
      }
    },
    [challenge, router, verifying],
  );

  async function resend() {
    if (!challenge || cooldown > 0 || resending) return;
    setError(null);
    setResending(true);
    try {
      const next = await api.requestOtp({ identityType: challenge.identityType, identifier: challenge.identifier, purpose: "LOGIN" });
      const updated: OtpChallenge = {
        ...challenge,
        challengeId: next.challengeId,
        maskedTarget: next.maskedTarget,
        codeLength: next.codeLength,
        expiresAt: next.expiresAt,
        resendAvailableAt: Date.now() + next.resendAvailableInSeconds * 1000,
      };
      saveChallenge(updated);
      setChallenge(updated);
      setCooldown(next.resendAvailableInSeconds);
      setExpired(false);
      setCode("");
      lastSubmitted.current = null;
    } catch (err) {
      // The server owns the cooldown; its message carries the remaining seconds.
      setError(err instanceof ApiClientError ? err.message : "ارسال مجدد کد ممکن نشد.");
    } finally {
      setResending(false);
    }
  }

  if (!ready || !challenge) {
    return <main className="page container">در حال بارگذاری...</main>;
  }

  const canResend = cooldown === 0 && !resending;

  return (
    <main className="auth-page">
      <div className="auth-card-wrap auth-card-wrap-single container">
        <section className="auth-card otp-card">
          <div className="otp-brand-mark">ب</div>
          <div className="eyebrow">SECURITY CHECK · برات</div>
          <h1 className="h2">کد ورود را وارد کنید</h1>
          <p className="muted">کد {toPersianDigits(challenge.codeLength)} رقمی برای <Ltr>{challenge.maskedTarget}</Ltr> ارسال شد.</p>

          <div className="otp-box">
            <OtpInput
              length={challenge.codeLength}
              value={code}
              onChange={setCode}
              onComplete={verify}
              disabled={verifying || expired}
              invalid={Boolean(error)}
              autoFocus
            />
            <FormMessage tone="error">{error}</FormMessage>

            {expired ? (
              <p className="muted auth-expiry">مهلت این کد به پایان رسید. کد تازه‌ای بگیرید.</p>
            ) : (
              <p className="muted auth-expiry">اعتبار کد: <CountdownTimer expiresAt={challenge.expiresAt} onExpire={() => setExpired(true)} /></p>
            )}

            <button type="button" className="btn btn-primary auth-submit" onClick={() => verify(code)} disabled={verifying || expired || code.replace(/\s/g, "").length < challenge.codeLength}>
              {verifying ? "در حال بررسی..." : "تأیید و ورود"}
            </button>
            <button type="button" className="btn btn-ghost auth-submit" onClick={resend} disabled={!canResend}>
              {cooldown > 0 ? `ارسال مجدد کد (${toPersianDigits(cooldown)} ثانیه)` : resending ? "در حال ارسال..." : "ارسال مجدد کد"}
            </button>
          </div>
          <p className="auth-note"><ShieldCheck size={16} /> این کد را با هیچ‌کس، حتی پشتیبانی برات، در میان نگذارید.</p>
        </section>
      </div>
    </main>
  );
}
