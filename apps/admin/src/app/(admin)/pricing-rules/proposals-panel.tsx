"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatJalaliDate } from "@barat/ui";
import { decidePricingProposalAction } from "./actions";
import { PRICING_RULE_SCOPE_LABELS, type PricingRuleProposal } from "./pricing-rule-schema";

/**
 * Large pricing changes waiting for a second person (ORD-7). The API refuses an
 * approval by the proposer; this list only shows what is waiting and why.
 */
export function PricingProposalsPanel({ proposals }: { proposals: readonly PricingRuleProposal[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  function decide(proposalId: string, decision: "approve" | "reject") {
    setMessage(null);
    startTransition(async () => {
      const result = await decidePricingProposalAction({ proposalId, decision });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="card panel" style={{ marginBlockEnd: 26 }}>
      <div className="section-label">
        <h3>در انتظار تأیید</h3>
        <span>تغییرهای بزرگ تا تأیید همکار دوم اعمال نمی‌شوند</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>قاعده</th>
              <th>تغییر</th>
              <th>پیشنهاددهنده</th>
              <th>زمان</th>
              <th>اقدام</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.proposalId}>
                <td>
                  {proposal.request.name}
                  <br />
                  <span className="muted">{PRICING_RULE_SCOPE_LABELS[proposal.request.scope]}</span>
                </td>
                <td className="bp-ltr" style={{ fontSize: 12 }}>
                  {proposal.reasons.map((reason) => (
                    <div key={reason}>{reason}</div>
                  ))}
                </td>
                <td className="bp-ltr">{proposal.proposedBy}</td>
                <td className="bp-ltr">{formatJalaliDate(proposal.createdAt)}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="primary-btn" disabled={pending} onClick={() => decide(proposal.proposalId, "approve")}>
                      تأیید و اعمال
                    </button>
                    <button type="button" className="secondary-btn" disabled={pending} onClick={() => decide(proposal.proposalId, "reject")}>
                      رد
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message ? (
        <p className="warning" role="alert" style={{ marginBlockEnd: 0 }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
