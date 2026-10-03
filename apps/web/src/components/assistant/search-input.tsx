"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import type { InputSpec } from "@/assistant/types";

const MIN_SEARCH = 2;
const LTR: ReadonlySet<InputSpec["type"]> = new Set(["username", "url", "email", "number"]);

/**
 * The one text box. Nothing is sent while the person is still typing: a search
 * runs only when they press send or the keyboard's search key.
 */
export function SearchInput({
  spec,
  disabled,
  onSubmit,
}: Readonly<{ spec: InputSpec; disabled: boolean; onSubmit: (value: string) => void }>) {
  const [value, setValue] = useState("");
  const isSearch = spec.action === "SEARCH";
  const trimmed = value.trim();
  const ready = trimmed.length >= (isSearch ? MIN_SEARCH : 1);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || disabled) return;
    onSubmit(trimmed);
    if (!isSearch) setValue("");
  };

  const ltr = LTR.has(spec.type);
  const label = spec.label ?? spec.placeholder ?? "پیام";
  const change = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value);

  return (
    <form className="asst-input" onSubmit={submit}>
      {spec.hint ? <p className="asst-hint">{spec.hint}</p> : null}
      <div className="asst-input-row">
        {spec.type === "textarea" ? (
          <textarea
            value={value}
            maxLength={spec.maxLength}
            placeholder={spec.placeholder}
            aria-label={label}
            autoComplete="off"
            disabled={disabled}
            rows={3}
            onChange={change}
          />
        ) : (
          <input
            value={value}
            maxLength={spec.maxLength}
            placeholder={spec.placeholder}
            aria-label={label}
            autoComplete="off"
            disabled={disabled}
            dir={ltr ? "ltr" : "rtl"}
            type={spec.type === "search" ? "search" : "text"}
            inputMode={spec.type === "number" ? "decimal" : spec.type === "email" ? "email" : spec.type === "url" ? "url" : undefined}
            enterKeyHint={isSearch ? "search" : "send"}
            onChange={change}
          />
        )}
        <button type="submit" className="asst-send" aria-label="ارسال" disabled={disabled || !ready}>
          <Send size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
