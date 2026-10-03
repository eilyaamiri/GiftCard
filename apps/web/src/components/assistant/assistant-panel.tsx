"use client";

import { ChevronRight, Home } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { AssistantOption, AssistantResponse } from "@/assistant/types";
import { ConversationShell } from "./conversation-shell";
import { MessageBubble, TypingBubble } from "./message-bubble";
import { OrderCard, ProductCard } from "./option-cards";
import { QuickReply } from "./quick-reply";
import { QuoteCard } from "./quote-card";
import { SearchInput } from "./search-input";
import { useAssistant } from "./use-assistant";

const isCard = (option: AssistantOption) => option.description !== undefined || option.imageUrl !== undefined;

function Choices({
  response,
  busy,
  onPick,
}: Readonly<{ response: AssistantResponse; busy: boolean; onPick: (option: AssistantOption) => void }>) {
  const cards = response.options.filter(isCard);
  const chips = response.options.filter((option) => !isCard(option));
  const Card = response.state === "orders.list" ? OrderCard : ProductCard;
  return (
    <>
      {cards.length === 0 ? null : (
        <div className="asst-cards">
          {cards.map((option) => (
            <Card key={option.id} option={option} disabled={busy} onPick={onPick} />
          ))}
        </div>
      )}
      {chips.length === 0 ? null : (
        <div className="asst-chips">
          {chips.map((option) => (
            <QuickReply key={option.id} option={option} disabled={busy} onPick={onPick} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The conversation itself. The desktop widget and the phone page both render
 * this and nothing else, so what a person sees never depends on the surface.
 */
export function AssistantPanel({
  variant,
  returnPath,
  onClose,
}: Readonly<{ variant: "widget" | "page"; returnPath: string; onClose?: () => void }>) {
  const router = useRouter();
  const { ready, busy, response, transcript, send, reset } = useAssistant(returnPath);

  /* The phone page has nothing to collapse into, so closing it goes back to
   * whatever the person was looking at, or home when they arrived directly. */
  const close = useCallback(() => {
    if (onClose) return onClose();
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [onClose, router]);

  const pick = useCallback((option: AssistantOption) => send(option.action, option.value), [send]);
  const submit = useCallback(
    (value: string) => {
      if (response !== null) send(response.input.action, value);
    },
    [response, send],
  );

  const last = transcript[transcript.length - 1];
  const needsTail = response !== null && (last === undefined || last.role !== "bot" || last.text !== response.message);

  const footer =
    response === null ? null : (
      <>
        {response.input.type === "none" ? null : (
          <SearchInput
            key={`${response.state}|${response.input.type}|${response.input.label ?? ""}|${response.input.placeholder ?? ""}`}
            spec={response.input}
            disabled={busy && response.input.action !== "SEARCH"}
            onSubmit={submit}
          />
        )}
        {response.navigation.back || response.navigation.home ? (
          <div className="asst-nav">
            {response.navigation.back ? (
              <button type="button" className="asst-nav-btn" disabled={busy} onClick={() => send("BACK")}>
                <ChevronRight size={16} aria-hidden="true" />
                بازگشت
              </button>
            ) : null}
            {response.navigation.home ? (
              <button type="button" className="asst-nav-btn" disabled={busy} onClick={() => send("HOME")}>
                <Home size={15} aria-hidden="true" />
                منوی اصلی
              </button>
            ) : null}
          </div>
        ) : null}
      </>
    );

  return (
    <ConversationShell
      variant={variant}
      scrollKey={`${transcript.length}|${response?.state ?? ""}|${busy}`}
      onReset={reset}
      onClose={close}
      footer={footer}
    >
      {!ready && response === null ? <TypingBubble /> : null}
      {transcript.map((entry, index) => {
        const isLastBot = index === transcript.length - 1 && entry.role === "bot";
        return (
          <MessageBubble key={`${index}:${entry.role}`} role={entry.role} tone={isLastBot ? (response?.tone ?? "info") : "info"}>
            {entry.text}
          </MessageBubble>
        );
      })}
      {needsTail ? <MessageBubble role="bot" tone={response.tone}>{response.message}</MessageBubble> : null}
      {response === null ? null : (
        <>
          {response.blocks.map((block, index) => (
            <QuoteCard key={`${response.state}:${index}`} block={block} />
          ))}
          {busy ? <TypingBubble /> : <Choices response={response} busy={busy} onPick={pick} />}
        </>
      )}
    </ConversationShell>
  );
}
