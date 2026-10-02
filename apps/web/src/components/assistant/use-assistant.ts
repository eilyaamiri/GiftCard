"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createWebServices } from "@/assistant/adapters/web-services";
import { createEngine, type Engine } from "@/assistant/engine/engine";
import { createBrowserStore } from "@/assistant/persistence/store";
import type { ActionId, AssistantEffect, AssistantResponse, TranscriptEntry } from "@/assistant/types";

const SESSION_KEY = "barat.assistant.sid";

/** States whose truth lives on the server, so reopening re-checks them. */
const RESUMABLE = new Set(["auth.required", "checkout.awaiting", "checkout.verify", "checkout.placing"]);

let engine: Engine | null = null;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getEngine(): Engine {
  engine ??= createEngine({ services: createWebServices(), store: createBrowserStore(storage()) });
  return engine;
}

function sessionId(): string {
  const store = storage();
  const existing = store?.getItem(SESSION_KEY) ?? null;
  if (existing !== null && existing !== "") return existing;
  const id = crypto.randomUUID();
  try {
    store?.setItem(SESSION_KEY, id);
  } catch {
    /* an in-memory id still works for this page view */
  }
  return id;
}

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safePath(path: string): string | null {
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}

export interface AssistantView {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly response: AssistantResponse | null;
  readonly transcript: readonly TranscriptEntry[];
  send(action: ActionId, value?: string): void;
  reset(): void;
}

/**
 * The web channel's only door to the engine. It holds no conversation logic:
 * it forwards what the person pressed, draws what came back and performs the
 * one-shot effect (login, gateway redirect, page change) the engine asked for.
 */
export function useAssistant(returnPath: string): AssistantView {
  const router = useRouter();
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const idRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const returnRef = useRef(returnPath);
  returnRef.current = returnPath;

  const perform = useCallback(
    (effect: AssistantEffect | undefined) => {
      if (effect === undefined) return;
      if (effect.type === "login") {
        router.push(`/login?next=${encodeURIComponent(returnRef.current)}`);
      } else if (effect.type === "redirect") {
        const url = safeUrl(effect.url);
        if (url !== null) window.location.assign(url);
      } else {
        const path = safePath(effect.path);
        if (path !== null) router.push(path);
      }
    },
    [router],
  );

  const run = useCallback(
    async (action: ActionId, value: string | undefined, interactive: boolean) => {
      const id = idRef.current;
      if (id === null) return;
      if (interactive) {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
      }
      const seq = (seqRef.current += 1);
      try {
        const engineRef = getEngine();
        const next = await engineRef.handle({
          sessionId: id,
          action,
          ...(value === undefined ? {} : { value }),
          identity: { channel: "web", channelUserId: id },
        });
        const peeked = await engineRef.peek(id);
        if (seq === seqRef.current) {
          setResponse(next);
          if (peeked !== null) setTranscript(peeked.transcript);
        }
        perform(next.effect);
      } catch {
        /* the engine turns its own failures into a retry view; this only guards the transport */
      } finally {
        if (interactive) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [perform],
  );

  useEffect(() => {
    let alive = true;
    const id = sessionId();
    idRef.current = id;
    void (async () => {
      const stored = await getEngine().peek(id);
      if (!alive) return;
      if (stored === null) {
        await run("HOME", undefined, false);
      } else {
        setResponse(stored.response);
        setTranscript(stored.transcript);
        if (RESUMABLE.has(stored.response.state)) await run("RESUME", undefined, false);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [run]);

  const send = useCallback((action: ActionId, value?: string) => void run(action, value, action !== "SEARCH"), [run]);
  const reset = useCallback(() => void run("RESTART", undefined, true), [run]);

  return { ready, busy, response, transcript, send, reset };
}
