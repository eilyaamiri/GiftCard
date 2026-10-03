"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, FormMessage } from "@barat/ui";
import type { CreateQuoteRequest } from "@barat/contracts";
import { Loader2 } from "lucide-react";
import { ApiClientError } from "@/lib/api";
import { createQuote } from "@/app/checkout/purchase";
import { getCommerceSessionToken } from "@/lib/commerce-session";
import { isValidSteamLogin, normalizeSteamLogin, parseSteamUsdAmount } from "@/lib/steam";

/**
 * Steam login + typed USD amount → a quote.
 *
 * Nothing here prices anything: the typed amount travels as a decimal string
 * beside the catalogue's template offer id and the login, and the server's
 * quote is the only payable number the flow ever shows. The bounds checked
 * here are a courtesy; the API enforces them again.
 */

const AMOUNT_ERRORS = {
  REQUIRED: "مبلغ شارژ را به دلار وارد کنید",
  FORMAT: "مبلغ را به‌صورت عدد و حداکثر با دو رقم اعشار وارد کنید",
  BELOW_MIN: "حداقل مبلغ شارژ ۰٫۱۵ دلار است",
  ABOVE_MAX: "حداکثر مبلغ شارژ ۱٬۰۰۰ دلار است",
} as const;

const DEFAULT_CURRENCY = "USD";

export function SteamOrderForm({
  accountKey,
  loginLabel,
  loginHint,
  validationRegex,
  offerId,
}: Readonly<{
  accountKey: string;
  loginLabel: string;
  loginHint: string;
  validationRegex: string | null;
  offerId: string;
}>) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [login, setLogin] = useState("");
  const [errors, setErrors] = useState<{ login?: string; amount?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validate(): { login?: string; amount?: string } {
    const next: { login?: string; amount?: string } = {};
    const parsed = parseSteamUsdAmount(amount);
    if (!parsed.ok) next.amount = AMOUNT_ERRORS[parsed.reason];
    if (login.trim() === "") next.login = "شناسهٔ ورود استیم الزامی است";
    else if (!isValidSteamLogin(login)) next.login = "شناسهٔ ورود نباید فاصله داشته باشد";
    else if (validationRegex !== null && !new RegExp(validationRegex, "u").test(normalizeSteamLogin(login))) {
      next.login = "قالب شناسهٔ ورود درست نیست";
    }
    return next;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    const parsed = parseSteamUsdAmount(amount);
    if (Object.keys(next).length > 0 || !parsed.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { quote } = await createQuote({
        topUpOfferId: offerId,
        quantity: 1,
        currency: DEFAULT_CURRENCY,
        requestedAmountForeign: parsed.amount as CreateQuoteRequest["requestedAmountForeign"],
        topUpAccountFields: { [accountKey]: normalizeSteamLogin(login) },
        commerceSessionToken: getCommerceSessionToken(),
      });
      router.push(`/quote/${quote.id}`);
    } catch (error) {
      setSubmitError(error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید.");
      setSubmitting(false);
    }
  }

  return (
    <form className="card pad steam-form" onSubmit={submit} noValidate>
      <div className="steam-form-head">
        <img className="steam-logo" src="/steam/steam-logo.webp" alt="" width={48} height={48} aria-hidden="true" />
        <div>
          <strong>Steam Wallet</strong>
          <span className="steam-badge">قیمت نهایی پیش از پرداخت</span>
        </div>
      </div>

      <div className="field">
        <Label htmlFor={accountKey} required>
          <span className="steam-step">۱</span> {loginLabel}
        </Label>
        <Input
          id={accountKey}
          name={accountKey}
          type="text"
          ltr
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="steam_login"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          invalid={Boolean(errors.login)}
        />
        <FormMessage tone={errors.login ? "error" : "hint"}>{errors.login ?? loginHint}</FormMessage>
      </div>

      <div className="field">
        <Label htmlFor="steam-amount" required>
          <span className="steam-step">۲</span> مبلغ شارژ (دلار)
        </Label>
        <div className="steam-amount-input">
          <span className="steam-amount-prefix" dir="ltr" aria-hidden="true">$</span>
          <Input
            id="steam-amount"
            name="requestedAmountForeign"
            type="text"
            inputMode="decimal"
            ltr
            autoComplete="off"
            placeholder="10"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            invalid={Boolean(errors.amount)}
          />
        </div>
        <FormMessage tone={errors.amount ? "error" : "hint"}>
          {errors.amount ?? "هر مبلغ دلخواه از ۰٫۱۵ تا ۱٬۰۰۰ دلار؛ حداکثر دو رقم اعشار."}
        </FormMessage>
      </div>

      {submitError ? <p className="alert warn tg-form-error">{submitError}</p> : null}

      <button type="submit" className="btn btn-primary tg-submit" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="animate-spin" size={16} aria-hidden="true" /> در حال گرفتن قیمت…
          </>
        ) : (
          "دیدن قیمت و ادامه"
        )}
      </button>
      <p className="tg-submit-note">
        با این دکمه چیزی پرداخت نمی‌شود؛ فقط قیمت نهایی محاسبه و در صفحهٔ بعد نشان داده می‌شود.
      </p>
    </form>
  );
}
