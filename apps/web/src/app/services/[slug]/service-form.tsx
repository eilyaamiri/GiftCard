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
    for (const field of service.fields) {
      const value = values[field.key];
      if (field.isRequired && !value?.trim()) nextErrors[field.key] = "این فیلد الزامی است";
      if (field.validationRegex && value && !new RegExp(field.validationRegex, "u").test(value)) {
        nextErrors[field.key] = "قالب وارد شده صحیح نیست";
      }
    }
    return nextErrors;
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
          serviceFields: values,
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
