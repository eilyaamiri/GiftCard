import { z } from "zod";
import { api } from "./api";

/**
 * The contact routes the storefront offers, as the API publishes them.
 *
 * `packages/contracts` stops at `/api/auth`, so the shape is pinned here the
 * same way the account DTOs are. `href` arrives ready to use: the API builds it
 * from a value an admin typed and it has already validated, so nothing here
 * assembles a link out of a raw phone number or username.
 */
export const supportChannelSchema = z.object({
  kind: z.enum(["PHONE", "TELEGRAM", "WHATSAPP", "TICKET"]),
  title: z.string().min(1),
  description: z.string(),
  href: z.string().min(1),
  /** Opens in a new tab, and only ever with `rel="noopener noreferrer"`. */
  isExternal: z.boolean(),
  /** A signed-out visitor is sent to login first, then back here. */
  requiresAuth: z.boolean(),
});
export type SupportChannel = z.infer<typeof supportChannelSchema>;

const supportChannelListSchema = z.object({ items: z.array(supportChannelSchema) });

/**
 * Read the published channels for the layout.
 *
 * A failure here must not take the page with it: contact options are useful,
 * but they are not what someone came for. An empty list simply means the
 * contact tab has nothing to show, and the bottom bar hides it.
 */
export async function getSupportChannels(): Promise<readonly SupportChannel[]> {
  try {
    const response = await api.get("/api/support/channels", supportChannelListSchema);
    return response.items;
  } catch {
    return [];
  }
}
