"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, Select, Textarea, FormMessage } from "@barat/ui";
import type { ServiceFieldDefinitionDto } from "@barat/contracts";

/**
 * POC note: `fields` mirrors `ServiceFieldDefinitionDto` from @barat/contracts
 * exactly, so once GET /api/catalog/services/:slug is live this form only
 * needs its data source swapped, not its rendering logic.
 */
const DEMO_FIELDS: Record<string, ServiceFieldDefinitionDto[]> = {
  openai: [
    { id: "f1", key: "accountEmail", label: "Account email", labelFa: "ایمیل حساب OpenAI", fieldType: "EMAIL", isRequired: true, validationRegex: null, helpTextFa: "همان ایمیلی که با آن وارد ChatGPT می‌شوید.", options: null, sortOrder: 0 },
    { id: "f2", key: "plan", label: "Plan", labelFa: "نوع اشتراک", fieldType: "SELECT", isRequired: true, validationRegex: null, helpTextFa: null, options: [{ value: "plus", labelFa: "Plus ماهانه" }, { value: "team", labelFa: "Team ماهانه" }], sortOrder: 1 },
  ],
};
const DEFAULT_FIELDS: ServiceFieldDefinitionDto[] = [
  { id: "g1", key: "accountEmail", label: "Account email", labelFa: "ایمیل حساب", fieldType: "EMAIL", isRequired: true, validationRegex: null, helpTextFa: null, options: null, sortOrder: 0 },
  { id: "g2", key: "amountUsd", label: "Amount", labelFa: "مبلغ به دلار", fieldType: "NUMBER", isRequired: true, validationRegex: null, helpTextFa: null, options: null, sortOrder: 1 },
  { id: "g3", key: "note", label: "Note", labelFa: "توضیحات (اختیاری)", fieldType: "TEXTAREA", isRequired: false, validationRegex: null, helpTextFa: null, options: null, sortOrder: 2 },
];

export default function ServiceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const fields = DEMO_FIELDS[slug] ?? DEFAULT_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.key];
      if (field.isRequired && !value?.trim()) nextErrors[field.key] = "این فیلد الزامی است";
      if (field.validationRegex && value && !new RegExp(field.validationRegex, "u").test(value)) {
        nextErrors[field.key] = "قالب وارد شده صحیح نیست";
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    // POC: would call POST /api/quotes with { serviceId, serviceFields: values }.
    await new Promise((r) => setTimeout(r, 500));
    router.push(`/quote/demo-service-${slug}` as never);
  }

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="eyebrow">درخواست پرداخت</div>
      <h1 className="h2">فرم درخواست</h1>
      <p className="muted">اطلاعات زیر را کامل کنید تا قیمت نهایی محاسبه شود.</p>

      <form className="card pad" style={{ marginTop: 18 }} onSubmit={submit} noValidate>
        {fields.map((field) => (
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
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
          {submitting ? "در حال محاسبه قیمت..." : "دریافت قیمت"}
        </button>
      </form>
    </main>
  );
}
