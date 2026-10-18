"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reviewModeration, type ReviewStatus } from "@/lib/reviews";
import { InlineError, messageFor } from "../../(operator)/_components/error-notice";

/**
 * Approve or reject one review. Sends back the `updatedAt` this row was loaded
 * with, so a customer edit made in the meantime is refused instead of being
 * published unread; the moderator then refreshes and reads the new text.
 */
export function ReviewDecision({
  id,
  status,
  updatedAt,
}: {
  readonly id: string;
  readonly status: ReviewStatus;
  readonly updatedAt: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setError(null);
    setPending(decision);
    try {
      await reviewModeration.decide(id, decision, updatedAt);
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
      setPending(null);
    }
  }

  return (
    <div className="review-decision">
      <div className="review-decision-buttons">
        {status !== "APPROVED" ? (
          <button type="button" className="primary-btn" disabled={pending !== null} onClick={() => void decide("APPROVED")}>
            {pending === "APPROVED" ? "در حال انتشار…" : "تأیید و انتشار"}
          </button>
        ) : null}
        {status !== "REJECTED" ? (
          <button type="button" className="secondary-btn" disabled={pending !== null} onClick={() => void decide("REJECTED")}>
            {pending === "REJECTED" ? "در حال ثبت…" : status === "APPROVED" ? "برداشتن از سایت" : "رد دیدگاه"}
          </button>
        ) : null}
      </div>
      <InlineError message={error} />
    </div>
  );
}
