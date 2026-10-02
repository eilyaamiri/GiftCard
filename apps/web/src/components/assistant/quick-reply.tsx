"use client";

import type { AssistantOption } from "@/assistant/types";

/** A short answer the person can tap instead of typing. */
export function QuickReply({
  option,
  disabled,
  onPick,
}: Readonly<{ option: AssistantOption; disabled: boolean; onPick: (option: AssistantOption) => void }>) {
  const className = `asst-chip asst-chip-${option.variant ?? "secondary"}`;
  if (option.href !== undefined) {
    return (
      <a className={className} href={option.href} target={option.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
        {option.label}
      </a>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled} onClick={() => onPick(option)}>
      {option.label}
    </button>
  );
}
