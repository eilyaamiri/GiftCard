"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import { SERVICE_FIELD_TYPE_LABELS, type AdminServiceField, type ServiceFieldType } from "../../catalog/_lib/catalog-contracts";
import { FormError } from "../../catalog/_components/form-error";

const FIELD_TYPES = Object.keys(SERVICE_FIELD_TYPE_LABELS) as ServiceFieldType[];

export function ServiceFieldForm({ serviceId, field, onDone }: { serviceId: string; field?: AdminServiceField; onDone: () => void }) {
  const router = useRouter();
  const isEdit = Boolean(field);
  const [key, setKey] = useState(field?.key ?? "");
  const [label, setLabel] = useState(field?.label ?? "");
  const [labelFa, setLabelFa] = useState(field?.labelFa ?? "");
  const [fieldType, setFieldType] = useState<ServiceFieldType>(field?.fieldType ?? "TEXT");
  const [isRequired, setIsRequired] = useState(field?.isRequired ?? true);
  const [helpTextFa, setHelpTextFa] = useState(field?.helpTextFa ?? "");
  const [sortOrder, setSortOrder] = useState(String(field?.sortOrder ?? 0));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      key: key.trim(),
      label: label.trim(),
      labelFa: labelFa.trim(),
      fieldType,
      isRequired,
      helpTextFa: helpTextFa.trim() || null,
      sortOrder: Number(sortOrder) || 0,
    };
    try {
      if (isEdit && field) {
        await api.put(`/api/admin/catalog/service-fields/${field.id}`, payload);
      } else {
        await api.post("/api/admin/catalog/service-fields", { serviceId, ...payload });
      }
      router.refresh();
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel" style={{ marginTop: 12 }}>
      <FormError message={error} />
      <div className="form-grid">
        <label>
          کلید فیلد (key)
          <input value={key} onChange={(event) => setKey(event.target.value)} required maxLength={120} dir="ltr" />
        </label>
        <label>
          برچسب (انگلیسی)
          <input value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={240} dir="ltr" />
        </label>
        <label>
          برچسب فارسی
          <input value={labelFa} onChange={(event) => setLabelFa(event.target.value)} required maxLength={240} />
        </label>
        <label>
          نوع فیلد
          <select value={fieldType} onChange={(event) => setFieldType(event.target.value as ServiceFieldType)}>
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {SERVICE_FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          الزامی؟
          <select value={isRequired ? "true" : "false"} onChange={(event) => setIsRequired(event.target.value === "true")}>
            <option value="true">بله</option>
            <option value="false">خیر</option>
          </select>
        </label>
        <label>
          ترتیب نمایش
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} type="number" className="bp-ltr" />
        </label>
        <label>
          راهنمای فارسی (اختیاری)
          <input value={helpTextFa} onChange={(event) => setHelpTextFa(event.target.value)} maxLength={1000} />
        </label>
      </div>
      <div className="save-row">
        <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={onDone}>
          انصراف
        </button>
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ فیلد" : "افزودن فیلد"}
        </button>
      </div>
    </form>
  );
}
