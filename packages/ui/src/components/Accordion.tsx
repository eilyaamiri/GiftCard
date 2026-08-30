"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export interface AccordionItem {
  readonly value: string;
  readonly title: ReactNode;
  readonly content: ReactNode;
}

export interface AccordionProps {
  readonly items: readonly AccordionItem[];
  readonly defaultOpen?: readonly string[];
  readonly multiple?: boolean;
  readonly className?: string;
}

export function Accordion({ items, defaultOpen = [], multiple = false, className }: AccordionProps) {
  const baseId = useId();
  const [open, setOpen] = useState<Set<string>>(new Set(defaultOpen));

  function toggle(value: string) {
    setOpen((current) => {
      const next = multiple ? new Set(current) : new Set<string>();
      if (current.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  return (
    <div className={cn("divide-y divide-line rounded-lg border border-line", className)}>
      {items.map((item) => {
        const expanded = open.has(item.value);
        return (
          <div key={item.value}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`${baseId}-${item.value}`}
              onClick={() => toggle(item.value)}
              className="bp-focus flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-start text-sm font-semibold text-ink"
            >
              <span>{item.title}</span>
              <ChevronDown
                className={cn("size-4 shrink-0 text-slate transition-transform", expanded && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {expanded ? (
              <div id={`${baseId}-${item.value}`} className="px-4 pb-4 text-sm text-slate">
                {item.content}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
