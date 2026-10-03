"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, Select, FormMessage } from "@barat/ui";
import { Loader2 } from "lucide-react";
import { ApiClientError } from "@/lib/api";
import { createQuote } from "@/app/checkout/purchase";
import { getCommerceSessionToken } from "@/lib/commerce-session";
import { TELEGRAM_USERNAME_KEY, isValidUsername, normalizeUsername, type TelegramProduct } from "@/lib/telegram";

/**
 * The order form: pick a package, state the account, get a price.
 *
 * Nothing here prices anything. The customer's choice is narrowed to an offer
 * id the catalogue published, the account identifier is sent beside it, and the
 * server answers with a quote — which is the only number this flow ever shows
 * as payable. The catalogue's indicative price is deliberately not rendered:
 * it is not a quote, and showing two different numbers for the same package in
 * one flow is how a customer comes to distrust both.
 */

export interface OrderOffer {
  readonly id: string;
  readonly label: string;
  readonly hint: string | null;
}

export interface OrderField {
  readonly key: string;
  readonly label: string;
  readonly isRequired: boolean;
  readonly options: readonly { readonly label: string; readonly value: string }[] | null;
  readonly validationRegex: string | null;
  readonly helpTextFa: string | null;
}

/** The default the quote contract itself declares for `currency`. */
const DEFAULT_CURRENCY = "USD";

/** Selectors that say «this row is a candidate»; the style hook is the id. */
function offerTestId(product: TelegramProduct, id: string): string {
  return `${product}-offer-${id}`;
}

/**
 * The account key, decided per field rather than assumed.
 *
 * `telegram_username` is the documented key, but the field list comes from the
 * API and the API validates whatever the game declares. When the entry
 * publishes exactly one field — which is what both Telegram products do — that
 * field's own key is used, so a renamed key cannot produce a quote request the
 * server refuses. A second field would be ambiguous, and is surfaced as an
 * error instead of being guessed at.
 */
function accountFieldKey(fields: readonly OrderField[]): string | null {
  if (fields.length === 0) return TELEGRAM_USERNAME_KEY;
  if (fields.length === 1) return fields[0]?.key ?? null;
  return fields.find((field) => field.key === TELEGRAM_USERNAME_KEY)?.key ?? null;
}

export function TelegramOrderForm({
  product,
  offerId,
  offers,
  fields,
}: Readonly<{
  product: TelegramProduct;
  offerId: string;
  offers: readonly OrderOffer[];
  fields: readonly OrderField[];
}>) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(offers[0]?.id ?? null);
  const [username, setUsername] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const key = accountFieldKey(fields);
  const accountKey = key ?? TELEGRAM_USERNAME_KEY;

  /**
   * The identifier, shaped the way the supplier documents it.
   *
   * Both products deliver to a Telegram username, so it is normalized (a typed
   * `@` is not an error, and Persian digits are the same number) and checked
   * against Telegram's own published format. Nothing else is accepted here —
   * the API remains the authority, and this only avoids sending a request that
   * cannot be fulfilled.
   */
  function accountValue(): string {
    if (product === "premium" || product === "stars") {
      return fields.length <= 1 ? normalizeUsername(username) : username.trim();
    }
    return username.trim();
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (selected === null) next.offer = "یک بسته را انتخاب کنید";
    if (product === "stars" || product === "premium") {
      if (username.trim() === "") next.username = "نام کاربری تلگرام الزامی است";
      else if (fields.length <= 1 && !isValidUsername(username)) {
        next.username = "نام کاربری تلگرام را درست وارد کنید، مثل @cento_store";
      }
    }
    for (const field of fields) {
      const value = field.key === accountKey ? username : (values[field.key] ?? "");
      if (field.isRequired && value.trim() === "") next[field.key] = "این فیلد الزامی است";
      if (field.validationRegex !== null && value !== "" && !new RegExp(field.validationRegex, "u").test(value)) {
        next[field.key] = "قالب وارد شده درست نیست";
      }
    }
    return next;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (selected === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      /* One request, one target: `topUpOfferId` is the offer the customer
       * clicked, and the account it must be credited to travels in
       * `topUpAccountFields`. The server prices it; no amount is sent.
       *
       * `currency` is the contract's default input, not an assumption: an
       * international payment states what it owes in a foreign currency, while
       * a top-up's price is the supplier's cost converted to Rial. Nothing here
       * reads this field, and the quote that comes back carries the currency
       * the server actually priced in.
       *
       * `commerceSessionToken` is what lets a customer who has not signed in
       * get a price at all — the API refuses an anonymous quote without one —
       * and it is the same browser handle the quote page reads the quote back
       * with. */
      const { quote } = await createQuote({
        topUpOfferId: selected,
        quantity: 1,
        currency: DEFAULT_CURRENCY,
        topUpAccountFields: { [accountKey]: accountValue() },
        commerceSessionToken: getCommerceSessionToken(),
      });
      router.push(`/quote/${quote.id}`);
    } catch (error) {
      setSubmitError(error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید.");
      setSubmitting(false);
    }
  }

  return (
    <form className="card pad tg-order-form" onSubmit={submit} noValidate>
      <fieldset className="tg-offer-fieldset">
        <legend className="tg-offer-legend">۱. بسته را انتخاب کنید</legend>
        <div className="tg-offer-grid" role="radiogroup" aria-label="انتخاب بسته">
          {offers.map((offer) => (
            <label
              key={offer.id}
              className="tg-offer"
              data-testid={offerTestId(product, offer.id)}
              data-selected={selected === offer.id ? "true" : undefined}
              data-offer-id={offer.id}
            >
              <input
                type="radio"
                name="topUpOfferId"
                value={offer.id}
                checked={selected === offer.id}
                onChange={() => setSelected(offer.id)}
              />
              <span className="tg-offer-label">{offer.label}</span>
              {/* The catalogue's own name, kept as the hint so the choice is
                  verifiable against whatever the customer saw elsewhere. */}
              {offer.hint !== null && offer.hint !== offer.label ? (
                <span className="tg-offer-hint" dir="auto">{offer.hint}</span>
              ) : null}
            </label>
          ))}
        </div>
        {errors["offer"] ? <FormMessage tone="error">{errors["offer"]}</FormMessage> : null}
      </fieldset>

      <fieldset className="tg-account-fieldset">
        <legend className="tg-offer-legend">۲. حساب مقصد</legend>

        <div className="field">
          <Label htmlFor={accountKey} required>
            {fields.find((field) => field.key === accountKey)?.label ?? "نام کاربری تلگرام"}
          </Label>
          <Input
            id={accountKey}
            name={accountKey}
            type="text"
            ltr
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="@username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            invalid={Boolean(errors["username"] ?? errors[accountKey])}
          />
          <FormMessage tone={errors["username"] ?? errors[accountKey] ? "error" : "hint"}>
            {errors["username"] ?? errors[accountKey] ?? fields.find((field) => field.key === accountKey)?.helpTextFa ??
              "استارز و پرمیوم به همین حساب می‌نشیند. رمز عبور یا کد ورود لازم نیست."}
          </FormMessage>
        </div>

        {/* Anything beyond the account field the entry declares. Neither
            Telegram product publishes one today; rendering them means a future
            catalogue change asks the customer instead of silently dropping the
            identifier the supplier needs. */}
        {fields
          .filter((field) => field.key !== accountKey)
          .map((field) => (
            <div className="field" key={field.key}>
              <Label htmlFor={field.key} required={field.isRequired}>{field.label}</Label>
              {field.options !== null && field.options.length > 0 ? (
                <Select
                  id={field.key}
                  options={field.options}
                  placeholder="انتخاب کنید"
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  invalid={Boolean(errors[field.key])}
                />
              ) : (
                <Input
                  id={field.key}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  invalid={Boolean(errors[field.key])}
                />
              )}
              <FormMessage tone={errors[field.key] ? "error" : "hint"}>
                {errors[field.key] ?? field.helpTextFa}
              </FormMessage>
            </div>
          ))}

        {fields.length > 1 && key === null ? (
          <p className="alert warn">
            این محصول چند فیلد حساب دارد و صفحهٔ فعلی فقط یکی را می‌شناسد. لطفاً با پشتیبانی تماس بگیرید.
          </p>
        ) : null}
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

      {/* Read by the server on the next request, and kept off the wire until
          then: the id is the customer's own pick, not a value this page made. */}
      <input type="hidden" name="catalogOfferId" value={offerId} readOnly />
    </form>
  );
}

export { accountFieldKey };
