"use client";

import { ChevronLeft } from "lucide-react";
import type { AssistantOption } from "@/assistant/types";

interface CardProps {
  readonly option: AssistantOption;
  readonly disabled: boolean;
  readonly onPick: (option: AssistantOption) => void;
}

/** A catalogue hit — gift card, game or package — with its artwork when it has one. */
export function ProductCard({ option, disabled, onPick }: CardProps) {
  const body = (
    <>
      {option.imageUrl === undefined ? null : (
        <span className="asst-card-art" aria-hidden="true">
          <img src={option.imageUrl} alt="" loading="lazy" width={44} height={44} />
        </span>
      )}
      <span className="asst-card-copy">
        <strong>{option.label}</strong>
        {option.description === undefined ? null : <small>{option.description}</small>}
      </span>
      <ChevronLeft size={17} aria-hidden="true" />
    </>
  );
  if (option.href !== undefined) {
    return (
      <a className="asst-card" href={option.href}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" className="asst-card" disabled={disabled} onClick={() => onPick(option)}>
      {body}
    </button>
  );
}

/** One order: its number up front, the status badge and the price and date beneath. */
export function OrderCard({ option, disabled, onPick }: CardProps) {
  const [status = "", ...rest] = (option.description ?? "").split(" · ");
  return (
    <button type="button" className="asst-card asst-order" disabled={disabled} onClick={() => onPick(option)}>
      <span className="asst-card-copy">
        <strong>{option.label}</strong>
        <small>{rest.join(" · ")}</small>
      </span>
      {status === "" ? null : <span className="asst-badge">{status}</span>}
      <ChevronLeft size={17} aria-hidden="true" />
    </button>
  );
}
