"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { InputSpec } from "@/assistant/types";

const DEBOUNCE_MS = 450;
const MIN_SEARCH = 2;
const LTR: ReadonlySet<InputSpec["type"]> = new Set(["username", "url", "email", "number"]);

/**
 * The one text box. A search types ahead (debounced, so a burst of keystrokes
 * is one request); every other input is a structured answer sent on submit.
 */
export function SearchInput({
  spec,
  disabled,
  onSubmit,
}: Readonly<{ spec: InputSpec; disabled: boolean; onSubmit: (value: string) => void }>) {
  const [value, setValue] = useState("");
  const sent = useRef("");
  const isSearch = spec.action === "SEARCH";

  useEffect(() => {
    if (!isSearch) return;
    const trimmed = value.trim();
    if (trimmed.length < MIN_SEARCH || trimmed === sent.current) return;
    const timer = window.setTimeout(() => {
      sent.current = trimmed;
      onSubmit(trimmed);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value, isSearch, onSubmit]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "" || disabled) return;
    sent.current = trimmed;
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
        <button type="submit" className="asst-send" aria-label="ارسال" disabled={disabled || value.trim() === ""}>
          <Send size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
