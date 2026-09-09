"use client";

import { useState } from "react";
import { InlineError, messageFor } from "../../../_components/error-notice";
import {
  canEnterDeliveryAssetManually,
  fulfillment,
  type FulfillmentWorkspace,
  type RecordSupplierResultInput,
} from "../../../_lib/fulfillment";
import { AssetPanel } from "./asset-panel";
import { ChecklistPanel } from "./checklist-panel";
import { CostVariancePanel } from "./cost-variance-panel";
import { FinalActionPanel } from "./final-action-panel";
import { InternationalPaymentPanel } from "./international-payment-panel";
import { PaymentReceiptPanel } from "./payment-receipt-panel";
import { SupplierResultForm } from "./supplier-result-form";

/**
 * Single owner of the fulfillment workspace state.
 *
 * Every mutation endpoint returns the recomputed workspace, so the whole panel
 * is replaced with the server's answer after each call instead of patching a
 * local copy. That is what keeps the send gate, the checklist and the cost
 * variance from ever disagreeing with the database.
 */
export function FulfillmentPanel({
  workItemId,
  initialWorkspace,
  canOperate,
  canApprove,
  canCorrect,
}: {
  workItemId: string;
  initialWorkspace: FulfillmentWorkspace;
  canOperate: boolean;
  canApprove: boolean;
  canCorrect: boolean;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(key: string, call: () => Promise<FulfillmentWorkspace>) {
    setError(null);
    setBusyKey(key);
    try {
      setWorkspace(await call());
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function recordSupplierResult(input: RecordSupplierResultInput) {
    // Thrown on failure so the form keeps the operator's input instead of
    // silently clearing a code that was never stored.
    setError(null);
    setWorkspace(await fulfillment.recordSupplierResult(workItemId, input));
  }

  const hasAsset = workspace.assets.length > 0;
  /* The brief is populated only for INTERNATIONAL_PAYMENT, so it doubles as the
   * switch that keeps gift-card vocabulary off a payment task. */
  const payment = workspace.internationalPayment;

  return (
    <>
      {!canOperate ? (
        <p className="warning">
          {payment
            ? "برای تغییر چک‌لیست، ثبت نتیجهٔ پرداخت یا ارسال، این کار باید روی میز شما و باز باشد."
            : "برای تغییر چک‌لیست، ثبت نتیجهٔ تأمین‌کننده یا ارسال، این کار باید روی میز شما و باز باشد."}
        </p>
      ) : null}

      <InlineError message={error} />

      {payment ? (
        <InternationalPaymentPanel workItemId={workItemId} brief={payment} canOperate={canOperate} />
      ) : null}

      {payment ? (
        <PaymentReceiptPanel
          workItemId={workItemId}
          receipt={workspace.paymentReceipt}
          disabled={!canOperate || workspace.checklist.isLocked}
          onUploaded={setWorkspace}
        />
      ) : null}

      {/* A payment task files its proof after the money has moved, so the form
          belongs where the work is, above the record of it. */}
      {payment && !hasAsset && !workspace.checklist.isLocked ? (
        <SupplierResultForm disabled={!canOperate} variant="INTERNATIONAL_PAYMENT" onSubmit={recordSupplierResult} />
      ) : null}

      <AssetPanel
        workItemId={workItemId}
        assets={workspace.assets}
        canOperate={canOperate}
        variant={payment ? "INTERNATIONAL_PAYMENT" : "GIFT_CARD"}
        /* A gift card is the opposite: the code IS the delivery, so it is typed
           into the card that holds the delivery asset — the operator who already
           has a code in hand does not have to find the supplier flow or wait for
           an admin to answer a code request. */
        manualEntry={
          canEnterDeliveryAssetManually(workspace) ? (
            <SupplierResultForm
              disabled={!canOperate}
              variant="GIFT_CARD"
              chrome="inline"
              onSubmit={recordSupplierResult}
            />
          ) : undefined
        }
      />

      {workspace.costVariance ? (
        <CostVariancePanel
          variance={workspace.costVariance}
          recordedCost={workspace.supplierCost}
          canApprove={canApprove}
          /* Correcting is pointless once the card is gone: the checklist locks on
           * send, and the API refuses the call from that moment on. */
          canCorrect={canCorrect && !workspace.checklist.isLocked}
          onApprove={async (reason) => {
            setWorkspace(await fulfillment.approveCostVariance(workItemId, reason));
          }}
          onCorrect={async (input) => {
            // Thrown on failure so the form keeps what was typed and can show why.
            setError(null);
            setWorkspace(await fulfillment.correctActualCost(workItemId, input));
          }}
        />
      ) : null}

      <ChecklistPanel
        checklist={workspace.checklist}
        canOperate={canOperate}
        busyKey={busyKey}
        recordedCost={workspace.supplierCost}
        canCorrectCost={canCorrect}
        onCheck={(itemKey, checked) =>
          void mutate(itemKey, () => fulfillment.checkItem(workItemId, itemKey, checked))
        }
        onSetField={(itemKey, value) => void mutate(itemKey, () => fulfillment.setField(workItemId, itemKey, value))}
      />

      <FinalActionPanel
        workspace={workspace}
        canOperate={canOperate}
        onRecordCost={async (input) => {
          setError(null);
          setWorkspace(await fulfillment.recordActualCost(workItemId, input));
        }}
        onSend={async () => {
          const { outcome } = await fulfillment.send(workItemId);
          setWorkspace(outcome.workspace);
          return outcome;
        }}
        onRetry={async () => {
          const { outcome } = await fulfillment.retryDelivery(workItemId);
          setWorkspace(outcome.workspace);
          return outcome;
        }}
      />
    </>
  );
}
