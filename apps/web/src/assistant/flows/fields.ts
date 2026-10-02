import { go, opt, stay, type Context, type Move, type StateDef } from "../engine/machine";
import type { FieldSpec, SessionData } from "../types";
import { isCredentialField } from "../validators";

export const SKIP = "__skip";

/** The fields we are willing to ask for: credential-looking ones are never collected. */
export function askable(fields: readonly FieldSpec[]): { fields: FieldSpec[]; blocked: boolean } {
  const kept: FieldSpec[] = [];
  let blocked = false;
  for (const f of fields) {
    if (isCredentialField(f)) {
      if (f.required) blocked = true;
      continue;
    }
    kept.push(f);
  }
  return { fields: kept, blocked };
}

export const CREDENTIAL_REFUSAL = "این سرویس به اطلاعات ورود حساب نیاز داره و من هیچ‌وقت رمز یا کد ورود نمی‌گیرم. از صفحهٔ خود سایت ادامه بدید.";

type Target = "gameAccountFields" | "serviceFields";

const INPUT_TYPE = { text: "text", number: "number", email: "email", url: "url" } as const;

function isKnown(spec: FieldSpec | undefined, known: Record<string, string>): boolean {
  return spec !== undefined && known[spec.key] !== undefined;
}

/**
 * One dynamic question per declared field, in order. Answers go to `target`;
 * after the last one the flow continues at `next`. A field the caller already
 * answered (`prefilled`) is skipped.
 */
export function fieldLoop(id: string, flow: StateDef["flow"], target: Target, next: string, prefilled: (d: SessionData) => Record<string, string> = () => ({})): StateDef {
  const current = (ctx: Context): FieldSpec | undefined => ctx.data.fieldSpecs?.[ctx.data.fieldIndex ?? 0];

  const advance = (ctx: Context, answers: Record<string, string>): Move => {
    const specs = ctx.data.fieldSpecs ?? [];
    let index = (ctx.data.fieldIndex ?? 0) + 1;
    const known = { ...prefilled(ctx.data), ...answers };
    while (index < specs.length && isKnown(specs[index], known)) index += 1;
    const patch: Partial<SessionData> = { [target]: answers, fieldIndex: index };
    return index < specs.length ? go(id, { patch }) : go(next, { patch });
  };

  return {
    id,
    flow,
    guard: async (ctx) => {
      const specs = ctx.data.fieldSpecs ?? [];
      let index = ctx.data.fieldIndex ?? 0;
      const known = { ...prefilled(ctx.data), ...(ctx.data[target] ?? {}) };
      while (index < specs.length && isKnown(specs[index], known)) index += 1;
      if (index >= specs.length) return go(next, { patch: { fieldIndex: index } });
      return index === (ctx.data.fieldIndex ?? 0) ? null : go(id, { patch: { fieldIndex: index } });
    },
    on: {
      SUBMIT: async (ctx, raw) => answer(ctx, raw),
      SELECT: async (ctx, raw) => answer(ctx, raw),
    },
    render: async (ctx) => {
      const spec = current(ctx);
      if (spec === undefined) return { message: "" };
      const skip = spec.required ? [] : [opt("skip", "رد کردن", "SELECT", SKIP, { variant: "ghost" })];
      if (spec.kind === "select" && spec.options !== undefined) {
        return {
          message: spec.label,
          options: [...spec.options.map((o) => opt(o.value, o.label, "SELECT", o.value)), ...skip],
        };
      }
      return {
        message: spec.label,
        input: {
          type: INPUT_TYPE[spec.kind === "select" ? "text" : spec.kind],
          action: "SUBMIT",
          label: spec.label,
          ...(spec.hint === undefined ? {} : { hint: spec.hint }),
          maxLength: 200,
        },
        options: skip,
      };
    },
  };

  async function answer(ctx: Context, raw: string | undefined) {
    const spec = current(ctx);
    if (spec === undefined) return stay("این مرحله تموم شده.");
    const answers = { ...(ctx.data[target] ?? {}) };
    if (raw === SKIP && !spec.required) return advance(ctx, answers);
    const checked = ctx.services.validate.field(spec, raw ?? "");
    if ("error" in checked) return stay(checked.error);
    answers[spec.key] = checked.value;
    return advance(ctx, answers);
  }
}
