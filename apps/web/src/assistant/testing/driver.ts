import { createEngine, type Engine } from "../engine/engine";
import { createMemoryStore, type SessionStore } from "../persistence/store";
import type { ActionId, AssistantResponse } from "../types";
import { createFake, type Fake } from "./fake-services";

export interface Driver {
  readonly engine: Engine;
  readonly fake: Fake;
  readonly store: SessionStore;
  last: AssistantResponse;
  send(action: ActionId, value?: string): Promise<AssistantResponse>;
  /** Picks the visible option by label, the way a person would. */
  pick(label: string): Promise<AssistantResponse>;
  has(label: string): boolean;
  /** Walks the common prefix: menu entry → search → result. */
  giftCardToQuote(): Promise<AssistantResponse>;
}

export async function startDriver(sessionId = "s1"): Promise<Driver> {
  const fake = createFake();
  const store = createMemoryStore();
  const engine = createEngine({ services: fake.services, store });
  const driver: Driver = {
    engine,
    fake,
    store,
    last: undefined as unknown as AssistantResponse,
    send: async (action, value) =>
      (driver.last = await engine.handle({
        sessionId,
        action,
        ...(value === undefined ? {} : { value }),
        identity: { channel: "web", channelUserId: "u1" },
      })),
    pick: async (label) => {
      const option = driver.last.options.find((o) => o.label === label);
      if (option === undefined) {
        throw new Error(`no option "${label}" in: ${driver.last.options.map((o) => o.label).join(" | ")}`);
      }
      return driver.send(option.action, option.value);
    },
    has: (label) => driver.last.options.some((o) => o.label === label),
    giftCardToQuote: async () => {
      await driver.pick("🎁 خرید گیفت کارت");
      await driver.send("SEARCH", "itunes");
      await driver.pick("iTunes");
      await driver.pick("US");
      return driver.pick("۲۵ دلار");
    },
  };
  await driver.send("RESUME");
  return driver;
}
