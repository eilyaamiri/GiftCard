"use client";

import { useState } from "react";
import { SERVICE_FIELD_TYPE_LABELS, type AdminServiceField } from "../../catalog/_lib/catalog-contracts";
import { formatCount } from "../../catalog/_lib/format";
import { ToggleActiveButton } from "../../catalog/_components/toggle-active-button";
import { ServiceFieldForm } from "./service-field-form";

export function ServiceFieldPanel({ serviceId, fields }: { serviceId: string; fields: AdminServiceField[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="card list-card" style={{ marginTop: 16 }}>
      <div className="section-label" style={{ marginTop: 15 }}>
        <h3>فیلدهای فرم این سرویس</h3>
        <span>{formatCount(fields.length)} مورد</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>کلید</th>
              <th>برچسب فارسی</th>
              <th>نوع</th>
              <th>الزامی</th>
              <th>ترتیب</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.id}>
                <td className="bp-ltr">{field.key}</td>
                <td>{field.labelFa}</td>
                <td>{SERVICE_FIELD_TYPE_LABELS[field.fieldType]}</td>
                <td>
                  <span className={`badge ${field.isRequired ? "badge-info" : "badge-wait"}`}>
                    {field.isRequired ? "بله" : "خیر"}
                  </span>
                </td>
                <td>{formatCount(field.sortOrder)}</td>
                <td>
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <button type="button" className="secondary-btn" onClick={() => setEditingId(field.id)}>
                      ویرایش
                    </button>
                    <ToggleActiveButton
                      path={`/api/admin/catalog/service-fields/${field.id}`}
                      confirmMessage={`فیلد «${field.labelFa}» برای همیشه حذف شود؟`}
                      hardDelete
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {fields.length === 0 ? <p className="empty-hint">هنوز فیلدی برای این سرویس ثبت نشده است.</p> : null}
      </div>

      {editingId
        ? (() => {
            const editing = fields.find((field) => field.id === editingId);
            return editing ? (
              <ServiceFieldForm serviceId={serviceId} field={editing} onDone={() => setEditingId(null)} />
            ) : null;
          })()
        : null}

      {creating ? (
        <ServiceFieldForm serviceId={serviceId} onDone={() => setCreating(false)} />
      ) : (
        <div className="save-row" style={{ justifyContent: "flex-start", marginTop: 14 }}>
          <button type="button" className="secondary-btn" onClick={() => setCreating(true)}>
            + افزودن فیلد
          </button>
        </div>
      )}
    </div>
  );
}
