"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, Select, Textarea, FormMessage, Ltr } from "@barat/ui";
import { Info } from "lucide-react";
import type { InternationalServiceDto, CreateQuoteResponse } from "@barat/contracts";
import { createQuoteResponseSchema } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { getCommerceSessionToken } from "@/lib/commerce-session";

const DECIMAL_PATTERN = /^\d{1,12}(\.\d{1,6})?$/u;

/**
 * The account keys every international payment carries, on top of whatever
 * fields the service itself configures. The operator needs to know where to pay
 * and — only when the payment happens inside the customer's own account — how to
 * sign in, so the credentials are optional and the address is not.
 *
 * These strings are the contract with the API: it reserves the same three keys
 * inside `serviceFields`, seals the password before storing it, and keeps all
 * three out of the customer-facing quote response.
 */
const ACCOUNT_KEYS = { siteUrl: "siteUrl", username: "accountUsername", password: "accountPassword" } as const;

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function ServiceForm({ service }: { readonly service: InternationalServiceDto }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): Record<string, string> {
    const nextErrors: Record<string, string> = {};
    if (!amount.trim()) {
      nextErrors.amount = "این فیلد الزامی است";
    } else if (!DECIMAL_PATTERN.test(amount.trim())) {
      nextErrors.amount = "مبلغ را به‌صورت عددی صحیح وارد کنید";
    } else {
      const numeric = Number(amount);
      if (service.minAmount && numeric < Number(service.minAmount)) nextErrors.amount = `حداقل مبلغ ${service.minAmount} ${service.currency} است`;
      if (service.maxAmount && numeric > Number(service.maxAmount)) nextErrors.amount = `حداکثر مبلغ ${service.maxAmount} ${service.currency} است`;
    }
    const siteUrl = values[ACCOUNT_KEYS.siteUrl]?.trim() ?? "";
    if (!siteUrl) {
      nextErrors[ACCOUNT_KEYS.siteUrl] = "این فیلد الزامی است";
    } else if (!isHttpUrl(siteUrl)) {
      nextErrors[ACCOUNT_KEYS.siteUrl] = "آدرس را کامل و با https:// وارد کنید";
    }
    if (values[ACCOUNT_KEYS.password] && !values[ACCOUNT_KEYS.username]?.trim()) {
      nextErrors[ACCOUNT_KEYS.username] = "برای ثبت رمز عبور، نام کاربری هم لازم است";
    }

    for (const field of service.fields) {
      const value = values[field.key];
      if (field.isRequired && !value?.trim()) nextErrors[field.key] = "این فیلد الزامی است";
      if (field.validationRegex && value && !new RegExp(field.validationRegex, "u").test(value)) {
        nextErrors[field.key] = "قالب وارد شده صحیح نیست";
      }
    }
    return nextErrors;
  }

  /** Drops the fields the customer left blank so no empty credential is sent. */
  function submittedFields(): Record<string, string> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ""));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const commerceSessionToken = getCommerceSessionToken();
      const { quote } = await api.post<CreateQuoteResponse>(
        "/api/quotes",
        {
          serviceId: service.id,
          quantity: 1,
          currency: service.currency,
          requestedAmountForeign: amount.trim(),
          serviceFields: submittedFields(),
          commerceSessionToken,
        },
        createQuoteResponseSchema,
      );
      router.push(`/quote/${quote.id}` as never);
    } catch (error) {
      setSubmitError(error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="eyebrow">درخواست پرداخت</div>
      <h1 className="h2">{service.nameFa}</h1>
      <p className="muted">اطلاعات زیر را کامل کنید تا قیمت نهایی محاسبه شود.</p>
      {service.requiresManualReview ? (
        <div className="alert" style={{ marginTop: 10 }}>
          <Info size={14} style={{ verticalAlign: "-2px" }} /> این سرویس نیازمند بررسی دستی است؛ قیمت نهایی ممکن است کمی بیشتر طول بکشد.
        </div>
      ) : null}

      <form className="card pad" style={{ marginTop: 18 }} onSubmit={submit} noValidate>
        <div className="field">
          <Label htmlFor="amount" required>{`مبلغ به ${service.currency}`}</Label>
          <Input id="amount" type="text" inputMode="decimal" ltr value={amount} onChange={(e) => setAmount(e.target.value)} invalid={Boolean(errors.amount)} />
          <FormMessage tone={errors.amount ? "error" : "hint"}>
            {errors.amount ?? (service.minAmount || service.maxAmount ? <Ltr>{`${service.minAmount ?? "0"} - ${service.maxAmount ?? "∞"} ${service.currency}`}</Ltr> : null)}
          </FormMessage>
        </div>
        <div className="field">
          <Label htmlFor={ACCOUNT_KEYS.siteUrl} required>
            آدرس سایتی که باید پرداخت شود
          </Label>
          <Input
            id={ACCOUNT_KEYS.siteUrl}
            type="url"
            inputMode="url"
            ltr
            placeholder="https://example.com/pricing"
            value={values[ACCOUNT_KEYS.siteUrl] ?? ""}
            onChange={(e) => setValue(ACCOUNT_KEYS.siteUrl, e.target.value)}
            invalid={Boolean(errors[ACCOUNT_KEYS.siteUrl])}
          />
          <FormMessage tone={errors[ACCOUNT_KEYS.siteUrl] ? "error" : "hint"}>
            {errors[ACCOUNT_KEYS.siteUrl] ?? "نشانی صفحه‌ای که پرداخت در آن انجام می‌شود."}
          </FormMessage>
        </div>

        <div className="field">
          <Label htmlFor={ACCOUNT_KEYS.username}>نام کاربری حساب (اختیاری)</Label>
          <Input
            id={ACCOUNT_KEYS.username}
            type="text"
            ltr
            autoComplete="off"
            value={values[ACCOUNT_KEYS.username] ?? ""}
            onChange={(e) => setValue(ACCOUNT_KEYS.username, e.target.value)}
            invalid={Boolean(errors[ACCOUNT_KEYS.username])}
          />
          <FormMessage tone={errors[ACCOUNT_KEYS.username] ? "error" : "hint"}>
            {errors[ACCOUNT_KEYS.username] ??
              "اگر پرداخت باید داخل حساب خودتان انجام شود، اطلاعات ورود را وارد کنید."}
          </FormMessage>
        </div>

        <div className="field">
          <Label htmlFor={ACCOUNT_KEYS.password}>رمز عبور حساب (اختیاری)</Label>
          <Input
            id={ACCOUNT_KEYS.password}
            type="password"
            ltr
            autoComplete="new-password"
            value={values[ACCOUNT_KEYS.password] ?? ""}
            onChange={(e) => setValue(ACCOUNT_KEYS.password, e.target.value)}
            invalid={Boolean(errors[ACCOUNT_KEYS.password])}
          />
          <FormMessage tone={errors[ACCOUNT_KEYS.password] ? "error" : "hint"}>
            {errors[ACCOUNT_KEYS.password] ??
              "رمز عبور رمزنگاری‌شده ذخیره می‌شود و فقط اپراتور مسئول سفارش، با ثبت دلیل، آن را می‌بیند."}
          </FormMessage>
        </div>

        {service.fields.map((field) => (
          <div className="field" key={field.id}>
            <Label htmlFor={field.key} required={field.isRequired}>{field.labelFa}</Label>
            {field.fieldType === "SELECT" && field.options ? (
              <Select id={field.key} options={field.options.map((o) => ({ value: o.value, label: o.labelFa }))} placeholder="انتخاب کنید" value={values[field.key] ?? ""} onChange={(e) => setValue(field.key, e.target.value)} invalid={Boolean(errors[field.key])} />
            ) : field.fieldType === "TEXTAREA" ? (
              <Textarea id={field.key} value={values[field.key] ?? ""} onChange={(e) => setValue(field.key, e.target.value)} invalid={Boolean(errors[field.key])} />
            ) : (
              <Input id={field.key} type={field.fieldType === "EMAIL" ? "email" : field.fieldType === "NUMBER" ? "number" : field.fieldType === "URL" ? "url" : "text"} value={values[field.key] ?? ""} onChange={(e) => setValue(field.key, e.target.value)} invalid={Boolean(errors[field.key])} />
            )}
            <FormMessage tone={errors[field.key] ? "error" : "hint"}>{errors[field.key] ?? field.helpTextFa}</FormMessage>
          </div>
        ))}
        {submitError ? <div className="alert warn" style={{ marginBottom: 16 }}>{submitError}</div> : null}
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
          {submitting ? "در حال محاسبه قیمت..." : "دریافت قیمت"}
        </button>
      </form>
    </main>
  );
}
