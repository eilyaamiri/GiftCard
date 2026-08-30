import type { WorkItemType } from "@barat/contracts";
import type { OperatorTaskSummary } from "@/lib/mock-operator";
import { GiftCardFulfillmentWorkspace } from "./GiftCardFulfillmentWorkspace";
import { InternationalPaymentWorkspace } from "./InternationalPaymentWorkspace";
import { CustomerInformationWorkspace } from "./CustomerInformationWorkspace";
import { SupplierFollowupWorkspace } from "./SupplierFollowupWorkspace";
import { UnknownOutcomeWorkspace } from "./UnknownOutcomeWorkspace";
import { RefundReviewWorkspace } from "./RefundReviewWorkspace";
import { SupportRequestWorkspace } from "./SupportRequestWorkspace";

export interface WorkspaceProps {
  task: OperatorTaskSummary;
}

/**
 * Registry object keyed by WorkItemType — deliberately not a switch, so a
 * new task type is added by registering a component here, not by editing a
 * branch inside a shared function.
 */
export const TASK_WORKSPACE_REGISTRY: Record<WorkItemType, (props: WorkspaceProps) => React.ReactElement> = {
  MANUAL_GIFT_CARD_FULFILLMENT: GiftCardFulfillmentWorkspace,
  INTERNATIONAL_PAYMENT: InternationalPaymentWorkspace,
  CUSTOMER_INFORMATION: CustomerInformationWorkspace,
  SUPPLIER_FOLLOWUP: SupplierFollowupWorkspace,
  UNKNOWN_OUTCOME: UnknownOutcomeWorkspace,
  REFUND_REVIEW: RefundReviewWorkspace,
  SUPPORT_REQUEST: SupportRequestWorkspace,
};
