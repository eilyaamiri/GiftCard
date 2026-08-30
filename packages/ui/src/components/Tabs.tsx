"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TabItem {
  readonly value: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly className?: string;
}

export function Tabs({ items, value, defaultValue, onChange, className }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.value);
  const active = value ?? internal;

  function select(next: string) {
    setInternal(next);
    onChange?.(next);
  }

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
        {items.map((item) => {
          const selected = item.value === active;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-controls={`${baseId}-panel-${item.value}`}
              aria-selected={selected}
              disabled={item.disabled}
              onClick={() => select(item.value)}
              className={cn(
                "bp-focus min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3.5 text-sm font-semibold transition-colors",
                selected ? "border-teal text-ink" : "border-transparent text-slate hover:text-ink",
                item.disabled && "opacity-50",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          id={`${baseId}-panel-${item.value}`}
          aria-labelledby={`${baseId}-tab-${item.value}`}
          hidden={item.value !== active}
          className="pt-4"
        >
          {item.value === active ? item.content : null}
        </div>
      ))}
    </div>
  );
}
