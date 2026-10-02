"use client";

import { useEffect, useState } from "react";
import type { AssistantBlock } from "@/assistant/types";

function remaining(expiresAt: string): number {
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

const two = new Intl.NumberFormat("fa-IR", { minimumIntegerDigits: 2, useGrouping: false });

function Countdown({ expiresAt }: Readonly<{ expiresAt: string }>) {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    setSeconds(remaining(expiresAt));
    const timer = window.setInterval(() => setSeconds(remaining(expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (seconds === null) return null;
  if (seconds === 0) {
    return <p className="asst-quote-note asst-quote-expired">اعتبار این قیمت تموم شده؛ هنگام تأیید، قیمت جدید می‌گیریم.</p>;
  }
  return (
    <p className="asst-quote-note">
      اعتبار قیمت: <span dir="ltr">{two.format(Math.floor(seconds / 60))}:{two.format(seconds % 60)}</span>
    </p>
  );
}

/** «سفارش شما» — the price the server returned, never one the page worked out. */
export function QuoteCard({ block }: Readonly<{ block: AssistantBlock }>) {
  return (
    <div className={`asst-quote${block.kind === "quote" ? " asst-quote-priced" : ""}`}>
      <h3>{block.title}</h3>
      <dl>
        {block.lines.map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
      {block.kind === "quote" ? (
        <>
          <div className="asst-quote-total">
            <span>مبلغ قابل پرداخت</span>
            <strong>{block.totalLabel}</strong>
          </div>
          <Countdown expiresAt={block.expiresAt} />
        </>
      ) : null}
    </div>
  );
}
