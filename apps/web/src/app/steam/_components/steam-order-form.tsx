"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, FormMessage } from "@barat/ui";
import { Loader2 } from "lucide-react";
import { ApiClientError } from "@/lib/api";
import { createQuote } from "@/app/checkout/purchase";
import { getCommerceSessionToken } from "@/lib/commerce-session";
import { isValidSteamLogin, normalizeSteamLogin } from "@/lib/steam";

/**
 * Steam login + USD amount → a quote.
 *
 * Nothing here prices anything: the customer's choice is narrowed to an offer
 * id the catalogue published, the login travels beside it, and the server's
 * quote is the only payable number the flow ever shows.
 */

export interface SteamAmount {
  readonly id: string;
  readonly label: string;
  readonly usd: number;
}

const DEFAULT_CURRENCY = "USD";

export function SteamOrderForm({
  accountKey,
  loginLabel,
  loginHint,
  validationRegex,
  offers,
}: Readonly<{
  accountKey: string;
  loginLabel: string;
  loginHint: string;
  validationRegex: string | null;
  offers: readonly SteamAmount[];
}>) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(offers[0]?.id ?? null);
  const [login, setLogin] = useState("");
  const [errors, setErrors] = useState<{ login?: string; offer?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validate(): { login?: string; offer?: string } {
    const next: { login?: string; offer?: string } = {};
    if (selected === null) next.offer = "یک مبلغ را انتخاب کنید";
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
    if (Object.keys(next).length > 0 || selected === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { quote } = await createQuote({
        topUpOfferId: selected,
        quantity: 1,
        currency: DEFAULT_CURRENCY,
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

      <fieldset className="tg-offer-fieldset">
        <legend className="tg-offer-legend">
          <span className="steam-step">۲</span> مبلغ شارژ (دلار)
        </legend>
        <div className="steam-amount-grid" role="radiogroup" aria-label="مبلغ شارژ">
          {offers.map((offer) => (
            <label key={offer.id} className="tg-offer steam-amount" data-offer-id={offer.id}>
              <input
                type="radio"
                name="topUpOfferId"
                value={offer.id}
                checked={selected === offer.id}
                onChange={() => setSelected(offer.id)}
              />
              <span className="tg-offer-label steam-amount-label" dir="ltr">{offer.label}</span>
            </label>
          ))}
        </div>
        {errors.offer ? <FormMessage tone="error">{errors.offer}</FormMessage> : null}
      </fieldset>

      {submitError ? <p className="alert warn tg-form-error">{submitError}</p> : null}

      <button type="submit" className="btn btn-primary tg-submit" disabled={submitting || selected === null}>
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
