import { z } from "zod";
import { api } from "./api";

/**
 * The questions a visitor actually asks before their first order.
 *
 * One admin-managed list, read by both the landing page's closing section and
 * `/help`, so the two can never answer the same question differently — which
 * is the failure mode a second hand-maintained copy always eventually reaches.
 */
export type FaqEntry = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
};

const faqEntrySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
});
const faqListSchema = z.object({ items: z.array(faqEntrySchema) });

/**
 * Read the published FAQ entries for a page.
 *
 * A failure here must not take the page with it: `FaqSection` already hides
 * itself for an empty list, so a fetch failure just means that closing
 * section is absent, the same way an empty support-channel list hides the
 * contact tab.
 */
export async function getFaqs(): Promise<readonly FaqEntry[]> {
  try {
    const response = await api.get("/api/faqs", faqListSchema);
    return response.items;
  } catch {
    return [];
  }
}
