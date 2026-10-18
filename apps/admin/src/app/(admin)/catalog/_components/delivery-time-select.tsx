"use client";

import { DELIVERY_TIME_PRESETS } from "@barat/contracts";

/**
 * The delivery-time picker shared by the product, top-up game and service
 * forms. Offers exactly the presets the storefront knows how to word, plus
 * «نمایش داده نشود» for null — the API refuses anything else, so a free-number
 * field here would only produce errors at save time.
 */
export function DeliveryTimeSelect({
  value,
  onChange,
}: {
  readonly value: number | null;
  readonly onChange: (minutes: number | null) => void;
}) {
  return (
    <label>
      زمان تحویل (نمایش در صفحهٔ محصول)
      <select
        value={value === null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      >
        <option value="">نمایش داده نشود</option>
        {DELIVERY_TIME_PRESETS.map((preset) => (
          <option key={preset.minutes} value={String(preset.minutes)}>
            {preset.labelFa}
          </option>
        ))}
      </select>
    </label>
  );
}
