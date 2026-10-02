import type {
  ActionId,
  AssistantEffect,
  AssistantOption,
  AssistantRequest,
  AssistantResponse,
  AssistantSession,
  InputSpec,
  TranscriptEntry,
} from "../types";
import type { AssistantServices } from "../services";
import type { SessionStore } from "../persistence/store";
import { flowStates } from "../flows";
import { MENU, TEXT } from "../flows/common";
import { go, info, type Context, type Move, type Notice, type Outcome, type Stay, type StateDef } from "./machine";
import { MAX_HISTORY, MAX_TRANSCRIPT, applyPatch, createSession, snapshot } from "./session";

export interface Engine {
  /** The one entry point every channel uses. */
  handle(request: AssistantRequest): Promise<AssistantResponse>;
  /** What to draw when a channel reopens: the last response and the conversation. */
  peek(sessionId: string): Promise<{ response: AssistantResponse; transcript: readonly TranscriptEntry[] } | null>;
}

export interface EngineDeps {
  readonly services: AssistantServices;
  readonly store: SessionStore;
  readonly states?: Readonly<Record<string, StateDef>>;
}

const MAX_HOPS = 10;
const MAX_VALUE = 2000;
const NO_INPUT: InputSpec = { type: "none", action: "SUBMIT" };

const STALE_OPTION = "این گزینه دیگه معتبر نیست؛ لطفاً از گزینه‌های پایین انتخاب کنید.";
const BAD_REQUEST = "درخواست نامعتبر بود.";

const ACTION_LABEL: Partial<Record<ActionId, string>> = {
  BACK: "← بازگشت",
  HOME: "⌂ منوی اصلی",
  CANCEL: "لغو",
  RESTART: "شروع دوباره",
  LOGIN: "ورود به حساب",
  RETRY: "تلاش مجدد",
  RESUME: "ادامه",
};

interface Arrival {
  notice?: Notice;
  effect?: AssistantEffect;
}

export function createEngine({ services, store, states = flowStates }: EngineDeps): Engine {
  const queues = new Map<string, Promise<unknown>>();

  function serialize<T>(id: string, job: () => Promise<T>): Promise<T> {
    const run = (queues.get(id) ?? Promise.resolve()).then(job, job);
    const tail = run.catch(() => undefined);
    queues.set(id, tail);
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return run;
  }

  const defOf = (id: string): StateDef => {
    const def = states[id];
    if (def === undefined) throw new Error(`UNKNOWN_STATE:${id}`);
    return def;
  };

  function contextFor(draft: AssistantSession): Context {
    const memo = new Map<string, Promise<unknown>>();
    let user: Promise<string | null> | undefined;
    return {
      get session() {
        return draft;
      },
      get data() {
        return draft.data;
      },
      services,
      userId() {
        user ??= services.auth.userId().then((id) => {
          draft.userId = id;
          return id;
        });
        return user;
      },
      memo<T>(key: string, load: () => Promise<T>): Promise<T> {
        let hit = memo.get(key) as Promise<T> | undefined;
        if (hit === undefined) {
          hit = load();
          memo.set(key, hit);
        }
        return hit;
      },
    };
  }

  function moveTo(draft: AssistantSession, move: Move, viaGuard: boolean): void {
    if (move.reset === true) {
      draft.data = {};
      draft.stateHistory = [];
    } else if (!viaGuard && (move.history ?? "push") === "push") {
      draft.stateHistory.push({ state: draft.currentState, data: snapshot(draft.data) });
      if (draft.stateHistory.length > MAX_HISTORY) draft.stateHistory.shift();
    }
    if (move.patch !== undefined) draft.data = applyPatch(draft.data, move.patch);
    const next = defOf(move.to);
    draft.currentState = move.to;
    draft.currentFlow = next.flow;
  }

  async function settle(draft: AssistantSession, ctx: Context, arrival: Arrival): Promise<void> {
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const redirect = await defOf(draft.currentState).guard?.(ctx);
      if (redirect === undefined || redirect === null) return;
      moveTo(draft, redirect, true);
      arrival.notice = redirect.notice ?? arrival.notice;
      arrival.effect = redirect.effect ?? arrival.effect;
    }
    throw new Error("GUARD_LOOP");
  }

  async function apply(draft: AssistantSession, ctx: Context, move: Move, arrival: Arrival): Promise<void> {
    moveTo(draft, move, false);
    arrival.notice = move.notice ?? arrival.notice;
    arrival.effect = move.effect ?? arrival.effect;
    await settle(draft, ctx, arrival);
  }

  function isStay(outcome: Outcome): outcome is Stay {
    return "stay" in outcome;
  }

  async function dispatch(
    draft: AssistantSession,
    ctx: Context,
    action: ActionId,
    value: string | undefined,
    arrival: Arrival,
  ): Promise<void> {
    const def = defOf(draft.currentState);
    const own = def.on[action];

    if (own !== undefined) {
      const outcome = await own(ctx, value);
      if (isStay(outcome)) {
        arrival.notice = outcome.notice;
        return;
      }
      await apply(draft, ctx, outcome, arrival);
      return;
    }

    switch (action) {
      case "BACK": {
        const previous = draft.stateHistory.pop();
        if (previous === undefined) {
          arrival.notice = info("جای برگشتی نیست.");
          return;
        }
        draft.currentState = previous.state;
        draft.data = previous.data;
        draft.currentFlow = defOf(previous.state).flow;
        await settle(draft, ctx, arrival);
        return;
      }
      case "HOME":
        await apply(draft, ctx, go(MENU, { reset: true }), arrival);
        return;
      case "CANCEL":
        await apply(draft, ctx, go(MENU, { reset: true, notice: info("فرایند لغو شد.") }), arrival);
        return;
      case "RESTART":
        draft.transcript = [];
        await apply(draft, ctx, go(MENU, { reset: true }), arrival);
        return;
      case "LOGIN":
        arrival.effect = { type: "login" };
        return;
      case "RESUME":
      case "RETRY":
        await settle(draft, ctx, arrival);
        return;
      default:
        arrival.notice = { text: STALE_OPTION, tone: "error" };
    }
  }

  /** Whether the person could have sent this from what they were last shown. */
  function refusal(session: AssistantSession, request: AssistantRequest): string | null {
    const { action, value } = request;
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_VALUE)) return BAD_REQUEST;
    if (action === "HOME" || action === "RESTART" || action === "CANCEL" || action === "RESUME" || action === "RETRY") {
      return null;
    }
    const last = session.lastResponse;
    if (last === null) return STALE_OPTION;
    if (action === "BACK") return session.stateHistory.length > 0 || defOf(session.currentState).on.BACK ? null : STALE_OPTION;
    if (action === "SEARCH" || action === "SUBMIT") {
      return last.input.type !== "none" && last.input.action === action && value !== undefined ? null : STALE_OPTION;
    }
    const match = last.options.some((o) => o.action === action && o.value === value);
    return match ? null : STALE_OPTION;
  }

  function present(
    draft: AssistantSession,
    view: Awaited<ReturnType<NonNullable<StateDef["render"]>>>,
    arrival: Arrival,
    def: StateDef,
  ): AssistantResponse {
    const message = arrival.notice === undefined ? view.message : `${arrival.notice.text}\n\n${view.message}`;
    const flowHome = def.id !== MENU;
    return {
      sessionId: draft.sessionId,
      flow: draft.currentFlow,
      state: draft.currentState,
      message,
      tone: arrival.notice?.tone ?? view.tone ?? "info",
      input: view.input ?? NO_INPUT,
      options: view.options ?? [],
      blocks: view.blocks ?? [],
      navigation: {
        back: (def.nav?.back ?? true) && draft.stateHistory.length > 0,
        home: (def.nav?.home ?? true) && flowHome,
      },
      ...(arrival.effect === undefined ? {} : { effect: arrival.effect }),
    };
  }

  function userLine(session: AssistantSession, request: AssistantRequest): string {
    const { action, value } = request;
    if (action === "SEARCH" || action === "SUBMIT") return (value ?? "").slice(0, 200);
    const option = session.lastResponse?.options.find((o: AssistantOption) => o.action === action && o.value === value);
    return option?.label ?? ACTION_LABEL[action] ?? action;
  }

  function commit(draft: AssistantSession, response: AssistantResponse, user: string | null, replace: boolean): void {
    if (replace) draft.transcript.splice(-2, 2);
    if (user !== null) draft.transcript.push({ role: "user", text: user });
    draft.transcript.push({ role: "bot", text: response.message });
    if (draft.transcript.length > MAX_TRANSCRIPT) draft.transcript.splice(0, draft.transcript.length - MAX_TRANSCRIPT);
    const { effect: _effect, ...stored } = response;
    draft.lastResponse = stored;
  }

  function track(draft: AssistantSession, event: string | undefined): void {
    if (event === undefined) return;
    services.analytics.track(event, {
      flow: draft.currentFlow,
      state: draft.currentState,
      service: draft.data.serviceType ?? "none",
      channel: draft.channel,
    });
  }

  async function run(request: AssistantRequest): Promise<AssistantResponse> {
    const stored = await store.get(request.sessionId);
    const identity = request.identity ?? { channel: "web" as const, channelUserId: request.sessionId };
    const fresh = stored === null;
    const original = stored ?? createSession(request.sessionId, identity, null, services.now());
    const draft: AssistantSession = JSON.parse(JSON.stringify(original)) as AssistantSession;
    draft.retry ??= null;
    const ctx = contextFor(draft);
    const arrival: Arrival = {};

    try {
      let replay: { action: ActionId; value?: string } = request;
      let user: string | null = null;
      let replaceLast = false;

      if (fresh) {
        track(draft, "assistant_opened");
        await settle(draft, ctx, arrival);
      } else {
        if (request.action === "RETRY" && draft.retry !== null) {
          replay = draft.retry;
          draft.retry = null;
        }
        const wrong = replay === request ? refusal(original, request) : null;
        if (wrong !== null) {
          arrival.notice = { text: wrong, tone: "error" };
        } else {
          user = replay === request && request.action !== "RESUME" ? userLine(original, request) : null;
          draft.retry = null;
          await dispatch(draft, ctx, replay.action, replay.value, arrival);
          replaceLast = request.action === "SEARCH" && draft.currentState === original.currentState;
        }
        if (wrong !== null) user = null;
      }

      const def = defOf(draft.currentState);
      if (def.render === undefined) throw new Error(`NO_RENDER:${def.id}`);
      const view = await def.render(ctx);
      const response = present(draft, view, arrival, def);
      if (fresh || draft.currentState !== original.currentState) track(draft, def.track);
      draft.updatedAt = services.now();
      commit(draft, response, user, replaceLast);
      await store.set(draft);
      return response;
    } catch {
      return failed(original, request, draft.currentState);
    }
  }

  async function failed(original: AssistantSession, request: AssistantRequest, where: string): Promise<AssistantResponse> {
    const session: AssistantSession = JSON.parse(JSON.stringify(original)) as AssistantSession;
    const def = states[where] ?? defOf(session.currentState);
    const replay = request.action === "RETRY" && session.retry !== null ? session.retry : request;
    session.retry = { action: replay.action, ...(replay.value === undefined ? {} : { value: replay.value }) };
    const response: AssistantResponse = {
      sessionId: session.sessionId,
      flow: session.currentFlow,
      state: session.currentState,
      message: def.failMessage ?? TEXT.loadFailed,
      tone: "error",
      input: NO_INPUT,
      options: [{ id: "retry", label: "تلاش مجدد", action: "RETRY", variant: "primary" }],
      blocks: [],
      navigation: { back: session.stateHistory.length > 0, home: session.currentState !== MENU },
    };
    services.analytics.track("assistant_error", { flow: session.currentFlow, state: where, channel: session.channel });
    commit(session, response, null, false);
    session.updatedAt = services.now();
    await store.set(session).catch(() => undefined);
    return response;
  }

  return {
    handle: (request) => serialize(request.sessionId, () => run(request)),
    async peek(sessionId) {
      const session = await store.get(sessionId);
      if (session === null || session.lastResponse === null) return null;
      return { response: session.lastResponse, transcript: session.transcript };
    },
  };
}
