"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Badge, Checkbox, FormMessage, Input, Label, Ltr, formatJalaliDate, toLatinDigits } from "@barat/ui";
import { api, ApiClientError, type AccountProfile } from "@/lib/api";

/** Group a partly-typed IBAN as `IR12 3456 …`, the way a bank statement prints it. */
function formatIban(value: string): string {
  const canonical = toLatinDigits(value).replace(/[\s-]/g, "").toUpperCase().slice(0, 26);
  return canonical.replace(/(.{4})/g, "$1 ").trim();
}

/** Group a partly-typed card as `6037 9900 0000 0121`. */
function formatCard(value: string): string {
  const digits = toLatinDigits(value).replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * The customer's own payout details.
 *
 * The account holder is not an input. It is the name already on the profile,
 * shown read-only, because "the account must be in your own name" is a claim the
 * customer makes about numbers they enter — a name they could also type would
 * add nothing to it. A profile with no name cannot make the claim at all, so the
 * form asks for the name first instead of failing on submit.
 *
 * Only masked values ever come back from the API, so there is nothing here that
 * could re-display a full IBAN or card number, not even right after saving.
 */
export function BankAccountForm({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const stored = profile.bankAccount;
  const holderName = [profile.customer.firstName, profile.customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const canDeclare = !profile.requiresProfileCompletion && holderName.length > 0;

  const [editing, setEditing] = useState(false);
  const [iban, setIban] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ibanError, setIbanError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open() {
    setEditing(true);
    setIban("");
    setCardNumber("");
    setConfirmed(false);
    setError(null);
    setIbanError(null);
    setCardError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIbanError(null);
    setCardError(null);

    if (!confirmed) {
      setError("برای ثبت، باید تأیید کنید که شبا و کارت به نام خودتان است.");
      return;
    }

    setBusy(true);
    try {
      await api.saveBankAccount({
        /* Sent unformatted; the API normalises Persian digits and separators
         * and runs the checksums that actually decide validity. */
        iban: toLatinDigits(iban).replace(/[\s-]/g, "").toUpperCase(),
        cardNumber: toLatinDigits(cardNumber).replace(/[\s-]/g, ""),
        ownershipConfirmed: confirmed,
      });
      setEditing(false);
      setIban("");
      setCardNumber("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setIbanError(err.detailFor("iban") ?? null);
        setCardError(err.detailFor("cardNumber") ?? null);
        const general = err.detailFor("ownershipConfirmed") ?? err.detailFor("holderName");
        setError(general ?? (err.details.length > 0 ? null : err.message));
      } else {
        setError("ثبت اطلاعات بانکی ممکن نشد.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.removeBankAccount();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "حذف اطلاعات بانکی ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad bank-card">
      <header className="bank-card-head">
        <div>
          <h3>حساب بانکی برای بازگشت وجه</h3>
          <p className="muted">
            اگر مبلغی به شما بازگردانده شود، فقط به همین حساب واریز می‌شود. شماره شبا و شماره کارت
            باید هر دو به نام خودتان باشد.
          </p>
        </div>
        {stored ? (
          stored.isVerified ? (
            <Badge tone="ok">تأیید شده</Badge>
          ) : (
            <Badge tone="info">خوداظهاری</Badge>
          )
        ) : null}
      </header>

      {!canDeclare ? (
        <FormMessage tone="error">
          ابتدا نام و نام خانوادگی خود را در همین صفحه کامل کنید؛ حساب بانکی به همان نام ثبت می‌شود.
        </FormMessage>
      ) : null}

      {stored && !editing ? (
        <>
          <div className="summary-line">
            <span>صاحب حساب</span>
            <strong>{stored.holderName}</strong>
          </div>
          <div className="summary-line">
            <span>شماره شبا</span>
            <strong className="profile-identity-value">
              <Ltr>{stored.maskedIban}</Ltr>
              {stored.ibanBankName ? <small className="muted">{stored.ibanBankName}</small> : null}
            </strong>
          </div>
          <div className="summary-line">
            <span>شماره کارت</span>
            <strong className="profile-identity-value">
              <Ltr>{stored.maskedCardNumber}</Ltr>
              {stored.cardBankName ? <small className="muted">{stored.cardBankName}</small> : null}
            </strong>
          </div>
          <div className="summary-line">
            <span>تاریخ تأیید مالکیت</span>
            <strong>{formatJalaliDate(stored.ownershipAttestedAt, "d MMMM yyyy")}</strong>
          </div>
          <FormMessage tone="error">{error}</FormMessage>
          <div className="profile-form-actions">
            <button type="button" className="btn btn-outline" onClick={open} disabled={busy || !canDeclare}>
              ویرایش اطلاعات
            </button>
            <button type="button" className="btn btn-ghost bank-remove-btn" onClick={remove} disabled={busy}>
              {busy ? "در حال حذف..." : "حذف"}
            </button>
          </div>
        </>
      ) : null}

      {!stored && !editing ? (
        <button type="button" className="btn btn-primary" onClick={open} disabled={!canDeclare}>
          ثبت اطلاعات حساب
        </button>
      ) : null}

      {editing ? (
        <form onSubmit={submit} noValidate>
          {stored ? (
            <FormMessage tone="hint">
              برای ویرایش، هر دو شماره را دوباره وارد کنید. مقادیر قبلی رمزنگاری‌شده‌اند و قابل
              نمایش نیستند.
            </FormMessage>
          ) : null}
          <div className="field">
            <Label htmlFor="bankHolderName">صاحب حساب</Label>
            {/* Read-only on purpose: it comes from the profile, not from this form. */}
            <Input id="bankHolderName" value={holderName} readOnly aria-describedby="bankHolderNameHint" />
            <FormMessage tone="hint" id="bankHolderNameHint">
              همان نامی که در بخش بالای این صفحه ثبت کرده‌اید. برای تغییر آن، نام خود را ویرایش کنید.
            </FormMessage>
          </div>

          <div className="field">
            <Label htmlFor="bankIban" required>
              شماره شبا
            </Label>
            <Input
              id="bankIban"
              name="iban"
              inputMode="text"
              autoComplete="off"
              ltr
              placeholder="IR00 0000 0000 0000 0000 0000 00"
              value={iban}
              onChange={(event) => setIban(formatIban(event.target.value))}
              invalid={Boolean(ibanError)}
              aria-describedby={ibanError ? "bankIbanError" : undefined}
            />
            <FormMessage tone="error" id="bankIbanError">
              {ibanError}
            </FormMessage>
          </div>

          <div className="field">
            <Label htmlFor="bankCardNumber" required>
              شماره کارت
            </Label>
            <Input
              id="bankCardNumber"
              name="cardNumber"
              inputMode="numeric"
              autoComplete="off"
              ltr
              placeholder="0000 0000 0000 0000"
              value={cardNumber}
              onChange={(event) => setCardNumber(formatCard(event.target.value))}
              invalid={Boolean(cardError)}
              aria-describedby={cardError ? "bankCardNumberError" : undefined}
            />
            <FormMessage tone="error" id="bankCardNumberError">
              {cardError}
            </FormMessage>
          </div>

          <div className="bank-attestation">
            <Checkbox
              id="ownershipConfirmed"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              aria-describedby="ownershipConfirmedHint"
              className="bank-attestation-checkbox"
              label={
                <span className="bank-attestation-copy">
                  <strong>تأیید می‌کنم این شبا و کارت به نام خودم است.</strong>
                  <small id="ownershipConfirmedHint">
                    واریز به حساب شخص دیگر انجام نمی‌شود و در صورت مغایرت، بازگشت وجه متوقف می‌شود.
                  </small>
                </span>
              }
            />
          </div>

          <FormMessage tone="error">{error}</FormMessage>
          <div className="profile-form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "در حال ذخیره..." : "ذخیره اطلاعات حساب"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(false)} disabled={busy}>
              انصراف
            </button>
          </div>
        </form>
      ) : null}

      <p className="bank-privacy">
        <ShieldCheck aria-hidden="true" />
        شبا و شماره کارت شما رمزنگاری‌شده ذخیره می‌شود و پس از ثبت، فقط به شکل ماسک‌شده نمایش داده
        می‌شود.
      </p>
    </section>
  );
}
