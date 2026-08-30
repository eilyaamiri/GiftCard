"use client";

import { useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { toLatinDigits } from "../lib/digits";

export interface OtpInputProps {
  readonly length?: number;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly onComplete?: (value: string) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly autoFocus?: boolean;
  readonly "aria-label"?: string;
}

/** A row of forced-LTR OTP boxes with auto-advance, backspace-back and paste-fill. */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  "aria-label": ariaLabel = "کد تایید",
}: OtpInputProps) {
  const [internal, setInternal] = useState<string>(value ?? "");
  const digits = (value ?? internal).padEnd(length, " ").slice(0, length);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function commit(next: string) {
    const trimmed = next.slice(0, length);
    setInternal(trimmed);
    onChange?.(trimmed);
    if (trimmed.replace(/\s/g, "").length === length) onComplete?.(trimmed);
  }

  function setDigitAt(index: number, digit: string) {
    const current = (value ?? internal).padEnd(length, " ").split("");
    current[index] = digit;
    commit(current.join("").replace(/\s+$/, ""));
  }

  function handleChange(index: number, raw: string) {
    const clean = toLatinDigits(raw).replace(/\D/g, "");
    if (!clean) {
      setDigitAt(index, " ");
      return;
    }
    const chars = clean.split("");
    let cursor = index;
    for (const char of chars) {
      if (cursor >= length) break;
      setDigitAt(cursor, char);
      cursor += 1;
    }
    const target = refs.current[Math.min(cursor, length - 1)];
    target?.focus();
    target?.select();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      if (digits[index] && digits[index] !== " ") {
        setDigitAt(index, " ");
        return;
      }
      const prev = refs.current[index - 1];
      if (prev) {
        event.preventDefault();
        prev.focus();
        prev.select();
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      refs.current[Math.min(index + 1, length - 1)]?.focus();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      refs.current[Math.max(index - 1, 0)]?.focus();
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = toLatinDigits(event.clipboardData.getData("text")).replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    handleChange(index, pasted);
  }

  return (
    <div className="bp-ltr flex justify-end gap-2" dir="ltr" role="group" aria-label={ariaLabel}>
      {Array.from({ length }, (_, index) => {
        const char = digits[index];
        return (
          <input
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            aria-invalid={invalid || undefined}
            value={char === " " ? "" : char}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => handlePaste(index, event)}
            className={cn(
              "size-11 min-w-11 rounded-md border bg-paper text-center text-lg font-semibold text-ink outline-none transition-colors sm:size-12",
              "focus:outline focus:outline-3 focus:outline-[rgba(33,180,176,.45)] focus:outline-offset-2",
              invalid ? "border-status-red" : "border-line",
              disabled && "opacity-55",
            )}
          />
        );
      })}
    </div>
  );
}
