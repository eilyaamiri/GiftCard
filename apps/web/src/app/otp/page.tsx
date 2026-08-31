"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthOtpStep } from "@/components/auth-otp-step";
import { readChallenge, type OtpChallenge } from "../login/otp-challenge";

export default function OtpPage() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readChallenge();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setChallenge(stored);
    setReady(true);
  }, [router]);

  if (!ready || !challenge) {
    return <main className="page container">در حال بارگذاری...</main>;
  }

  return (
    <main className="auth-page">
      <div className="auth-card-wrap container">
        <section className="auth-card otp-card">
          <AuthOtpStep challenge={challenge} onBack={() => router.replace("/login")} />
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
