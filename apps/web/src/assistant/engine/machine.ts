import type { AssistantServices } from "../services";
import type {
  ActionId,
  AssistantBlock,
  AssistantEffect,
  AssistantOption,
  AssistantSession,
  FlowId,
  InputSpec,
  SessionData,
} from "../types";

export interface Notice {
  readonly text: string;
  readonly tone: "info" | "error";
}

export interface Context {
  readonly session: AssistantSession;
  readonly data: SessionData;
  readonly services: AssistantServices;
  /** Server truth, memoized for the request. `null` = signed out. */
  userId(): Promise<string | null>;
  /** Per-request memo, so a render and its handler read the catalogue once. */
  memo<T>(key: string, load: () => Promise<T>): Promise<T>;
}

export interface Move {
  readonly to: string;
  readonly patch?: Partial<SessionData>;
  readonly notice?: Notice;
  readonly effect?: AssistantEffect;
  /** `push` (default for handlers) lets BACK return to the state being left. Guard moves never push. */
  readonly history?: "push" | "none";
  /** Wipe the data first — a fresh start (home, restart). */
  readonly reset?: boolean;
}

/** The input was refused; show the same state again with a reason. */
export interface Stay {
  readonly stay: true;
  readonly notice: Notice;
}

export type Outcome = Move | Stay;

export interface View {
  readonly message: string;
  readonly input?: InputSpec;
  readonly options?: readonly AssistantOption[];
  readonly tone?: "info" | "error";
  readonly blocks?: readonly AssistantBlock[];
}

export type Handler = (ctx: Context, value: string | undefined) => Promise<Outcome>;

export interface StateDef {
  readonly id: string;
  readonly flow: FlowId;
  /** The actions this state accepts, besides the global ones the engine owns. */
  readonly on: Partial<Record<ActionId, Handler>>;
  /** Runs when the state is entered; a returned `Move` replaces the arrival. */
  readonly guard?: (ctx: Context) => Promise<Move | null>;
  /** Absent for pure route states, which never reach the screen. */
  readonly render?: (ctx: Context) => Promise<View>;
  /** Terminal screens carry their own «منوی اصلی» option. */
  /** Shown instead of the generic one when a service call fails in this state. */
  readonly failMessage?: string;
  /** Funnel event emitted on arrival. */
  readonly track?: string;
  readonly nav?: { readonly back?: boolean; readonly home?: boolean };
}

export const err = (text: string): Notice => ({ text, tone: "error" });
export const info = (text: string): Notice => ({ text, tone: "info" });
export const stay = (text: string): Stay => ({ stay: true, notice: err(text) });
export const go = (to: string, extra: Omit<Move, "to"> = {}): Move => ({ to, ...extra });

export function opt(
  id: string,
  label: string,
  action: ActionId,
  value?: string,
  extra: Partial<Omit<AssistantOption, "id" | "label" | "action" | "value">> = {},
): AssistantOption {
  return { id, label, action, ...(value === undefined ? {} : { value }), ...extra };
}
