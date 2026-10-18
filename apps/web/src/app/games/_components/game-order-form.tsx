"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, Input, Label, Select } from "@barat/ui";
import { Loader2 } from "lucide-react";
import { ApiClientError } from "@/lib/api";
import { createQuote } from "@/app/checkout/purchase";
import { getCommerceSessionToken } from "@/lib/commerce-session";
import { revealStep } from "@/lib/reveal-step";
import { DeliveryTime } from "@/components/delivery-time";
import {
  buildAccountFields,
  inputKindOf,
  validateAccountFields,
  type TopUpField,
} from "@/lib/game-topups";

/**
 * A game's order form: pick a package, describe the account, get a price.
 *
 * Unlike Telegram, a game's account is whatever the venue declares — a player
 * id, a server, a zone — so every input here is drawn from the game's own
 * field list, and the request carries exactly those keys. The server prices
 * the offer and returns a quote, which is the only payable number this flow
 * shows; no amount is sent from here.
 */

export interface GameOffer {
  readonly id: string;
  readonly label: string;
  readonly hint: string | null;
}

/** The default the quote contract itself declares for `currency`. */
const DEFAULT_CURRENCY = "USD";

function fieldLabel(field: TopUpField): string {
  const fa = field.labelFa?.trim();
  return fa !== undefined && fa !== "" ? fa : field.label;
}

export function GameOrderForm({
  offers,
  fields,
  deliveryMinutes = null,
}: Readonly<{ offers: readonly GameOffer[]; fields: readonly TopUpField[]; deliveryMinutes?: number | null | undefined }>) {
  const router = useRouter();
  const ordered = [...fields].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  const [selected, setSelected] = useState<string | null>(offers.length === 1 ? (offers[0]?.id ?? null) : null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const accountStepRef = useRef<HTMLFieldSetElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const hasRevealed = useRef(false);

  /**
   * Picking a package is step 1 of 2; the first pick reveals step 2, later ones
   * leave the page where it is so that packages stay comparable.
   */
  function chooseOffer(id: string) {
    setSelected(id);
    setErrors(({ offer: _removed, ...rest }) => rest);
    if (hasRevealed.current) return;
    hasRevealed.current = true;
    /* After the commit: clearing the offer error above moves everything below
     * it, and the scroll has to measure the layout the customer will land in. */
    requestAnimationFrame(() => revealStep(accountStepRef.current ?? submitRef.current));
  }

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    /* The error for a field goes as soon as the customer starts fixing it;
     * the full check runs again on submit. */
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = { ...validateAccountFields(ordered, values) };
    if (selected === null) next["offer"] = "یک بسته را انتخاب کنید";
    setErrors(next);
    if (Object.keys(next).length > 0 || selected === null) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      /* `commerceSessionToken` lets a customer who has not signed in get a
       * price; the quote page reads the quote back with the same handle. */
      const { quote } = await createQuote({
        topUpOfferId: selected,
        quantity: 1,
        currency: DEFAULT_CURRENCY,
        topUpAccountFields: buildAccountFields(ordered, values),
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
              data-testid={`game-offer-${offer.id}`}
              data-selected={selected === offer.id ? "true" : undefined}
            >
              <input
                type="radio"
                name="topUpOfferId"
                value={offer.id}
                checked={selected === offer.id}
                onChange={() => chooseOffer(offer.id)}
              />
              <span className="tg-offer-label" dir="auto">{offer.label}</span>
              {offer.hint !== null && offer.hint !== offer.label ? (
                <span className="tg-offer-hint" dir="auto">{offer.hint}</span>
              ) : null}
            </label>
          ))}
        </div>
        {errors["offer"] ? <FormMessage tone="error">{errors["offer"]}</FormMessage> : null}
      </fieldset>

      {ordered.length > 0 ? (
        <fieldset className="tg-account-fieldset" ref={accountStepRef}>
          <legend className="tg-offer-legend">۲. حساب بازی</legend>
          {ordered.map((field) => {
            const kind = inputKindOf(field);
            const id = `topup-field-${field.key}`;
            const error = errors[field.key];
            return (
              <div className="field" key={field.key}>
                <Label htmlFor={id} required={field.isRequired}>{fieldLabel(field)}</Label>
                {kind === "select" ? (
                  <Select
                    id={id}
                    name={field.key}
                    options={field.options ?? []}
                    placeholder="انتخاب کنید"
                    value={values[field.key] ?? ""}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    invalid={Boolean(error)}
                  />
                ) : (
                  <Input
                    id={id}
                    name={field.key}
                    /* A player id is digits but not a number: `type=number`
                     * would drop leading zeros and add a spinner, so digits get
                     * the numeric keyboard on a plain text input instead. */
                    type={kind === "email" ? "email" : "text"}
                    inputMode={kind === "number" ? "numeric" : kind === "email" ? "email" : "text"}
                    ltr
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={256}
                    value={values[field.key] ?? ""}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    invalid={Boolean(error)}
                  />
                )}
                <FormMessage tone={error ? "error" : "hint"}>{error ?? field.helpTextFa ?? null}</FormMessage>
              </div>
            );
          })}
          <p className="muted gt-account-note">
            شارژ به همین حساب انجام می‌شود و قابل انتقال نیست؛ پیش از ادامه مشخصات را دوباره بررسی کنید.
            رمز عبور حساب بازی هیچ‌وقت از شما خواسته نمی‌شود.
          </p>
        </fieldset>
      ) : null}

      {submitError ? <p className="alert warn tg-form-error" role="alert">{submitError}</p> : null}

      <DeliveryTime minutes={deliveryMinutes} />
      <button type="submit" className="btn btn-primary tg-submit" disabled={submitting} ref={submitRef}>
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
