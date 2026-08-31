"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import { INTEGRATION_MODE_LABELS, type AdminSupplier, type IntegrationMode } from "../../catalog/_lib/catalog-contracts";
import { FormError } from "../../catalog/_components/form-error";

const INTEGRATION_MODES = Object.keys(INTEGRATION_MODE_LABELS) as IntegrationMode[];

/**
 * No credential field exists here on purpose: `AdminSupplier` has no secret
 * property to bind to, and the API never returns one — this form cannot leak
 * what it never receives.
 */
export function SupplierForm({ supplier }: { supplier?: AdminSupplier }) {
  const router = useRouter();
  const isEdit = Boolean(supplier);
  const [code, setCode] = useState(supplier?.code ?? "");
  const [name, setName] = useState(supplier?.name ?? "");
  const [integrationMode, setIntegrationMode] = useState<IntegrationMode>(supplier?.integrationMode ?? "MANUAL");
  const [supportsRawCode, setSupportsRawCode] = useState(supplier?.supportsRawCode ?? false);
  const [defaultCurrency, setDefaultCurrency] = useState(supplier?.defaultCurrency ?? "USD");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      code: code.trim(),
      name: name.trim(),
      integrationMode,
      supportsRawCode,
      defaultCurrency: defaultCurrency.trim().toUpperCase(),
      notes: notes.trim() || null,
      isActive,
    };
    try {
      if (isEdit && supplier) {
        await api.put(`/api/admin/catalog/suppliers/${supplier.id}`, payload);
        router.refresh();
      } else {
        const created = await api.post<{ id: string }>("/api/admin/catalog/suppliers", payload);
        router.push(`/suppliers/${created.id}`);
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel">
      <FormError message={error} />
      <div className="form-grid">
        <label>
          کد (code)
          <input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={120} dir="ltr" />
        </label>
        <label>
          نام تأمین‌کننده
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={240} />
        </label>
        <label>
          نوع اتصال
          <select value={integrationMode} onChange={(event) => setIntegrationMode(event.target.value as IntegrationMode)}>
            {INTEGRATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {INTEGRATION_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <label>
          ارز پیش‌فرض
          <input value={defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value)} required maxLength={3} className="bp-ltr" />
        </label>
        <label>
          پشتیبانی از کد خام؟
          <select value={supportsRawCode ? "true" : "false"} onChange={(event) => setSupportsRawCode(event.target.value === "true")}>
            <option value="true">بله</option>
            <option value="false">خیر</option>
          </select>
        </label>
        <label>
          وضعیت
          <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </label>
      </div>
      <div className="form-grid" style={{ marginTop: 13 }}>
        <label>
          یادداشت (اختیاری)
          <textarea value={notes ?? ""} onChange={(event) => setNotes(event.target.value)} maxLength={4000} />
        </label>
      </div>
      <div className="save-row">
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ تغییرات" : "افزودن تأمین‌کننده"}
        </button>
      </div>
    </form>
  );
}
