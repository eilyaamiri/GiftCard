import type { StateDef } from "../engine/machine";
import { checkoutStates } from "./checkout";
import { gameStates } from "./game";
import { giftCardStates } from "./gift-card";
import { internationalStates } from "./international";
import { menuStates } from "./menu";
import { orderStates } from "./orders";
import { supportStates } from "./support";
import { telegramStates } from "./telegram";

/** Every state of the machine, keyed by id. This table is the whole product flow. */
export const flowStates: Readonly<Record<string, StateDef>> = {
  ...menuStates,
  ...giftCardStates,
  ...telegramStates,
  ...gameStates,
  ...internationalStates,
  ...checkoutStates,
  ...orderStates,
  ...supportStates,
};
