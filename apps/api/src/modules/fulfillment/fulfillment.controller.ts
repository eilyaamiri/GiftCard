import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity/rbac/roles.decorator';
import { requireStaff } from '../workitems/staff-context';
import {
  FulfillmentService,
  type DeliveryOutcome,
  type FulfillmentWorkspace,
} from './fulfillment.service';
import {
  checkChecklistItemBodySchema,
  correctActualCostBodySchema,
  reasonBodySchema,
  recordActualCostBodySchema,
  recordSupplierResultBodySchema,
  setChecklistFieldBodySchema,
  type CheckChecklistItemBody,
  type CorrectActualCostBody,
  type ReasonBody,
  type RecordActualCostBody,
  type RecordSupplierResultBody,
  type SetChecklistFieldBody,
} from './fulfillment.schemas';
import { MAX_PAYMENT_RECEIPT_BYTES } from './payment-receipt.service';

/**
 * The operator fulfillment workspace.
 *
 * Every endpoint re-derives authorisation and the send gate from the database.
 * Nothing here trusts a flag from the client: `POST /send` called directly with
 * curl by an authenticated operator is subject to exactly the same checks as the
 * button in the panel, which is the property the security review asks for.
 */
@Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR')
@Controller('operator/fulfillment')
export class FulfillmentController {
  constructor(@Inject(FulfillmentService) private readonly fulfillment: FulfillmentService) {}

  @Get(':workItemId')
  async workspace(
    @Param('workItemId') workItemId: string,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    return { workspace: await this.fulfillment.getWorkspace(workItemId, staff) };
  }

  @Get(':workItemId/payment-receipt')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async paymentReceipt(
    @Param('workItemId') workItemId: string,
    @Req() request: unknown,
  ): Promise<StreamableFile> {
    const staff = requireStaff(request);
    const receipt = await this.fulfillment.paymentReceiptForStaff({ workItemId, staff });
    return new StreamableFile(receipt.content, {
      type: receipt.contentType,
      disposition: `inline; filename="${receipt.filename}"`,
      length: receipt.sizeBytes,
    });
  }

  @Post(':workItemId/payment-receipt')
  @UseInterceptors(
    FileInterceptor('receipt', {
      limits: { fileSize: MAX_PAYMENT_RECEIPT_BYTES, files: 1 },
      fileFilter: (_request, file, callback) => {
        callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
      },
    }),
  )
  async uploadPaymentReceipt(
    @Param('workItemId') workItemId: string,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    if (!file) {
      throw new BadRequestException('یک تصویر معتبر JPG، PNG یا WebP انتخاب کنید.');
    }
    const staff = requireStaff(request);
    return {
      workspace: await this.fulfillment.uploadPaymentReceipt({ workItemId, staff, file }),
    };
  }

  @Post(':workItemId/checklist/check')
  async check(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(checkChecklistItemBodySchema)) body: CheckChecklistItemBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    const workspace = await this.fulfillment.checkItem({
      workItemId,
      staff,
      itemKey: body.itemKey,
      checked: body.checked,
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    return { workspace };
  }

  @Post(':workItemId/checklist/field')
  async setField(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(setChecklistFieldBodySchema)) body: SetChecklistFieldBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    const workspace = await this.fulfillment.setField({
      workItemId,
      staff,
      itemKey: body.itemKey,
      value: body.value,
    });
    return { workspace };
  }

  @Post(':workItemId/supplier-result')
  async recordSupplierResult(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(recordSupplierResultBodySchema)) body: RecordSupplierResultBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    const workspace = await this.fulfillment.recordSupplierResult({
      workItemId,
      staff,
      asset: body.asset,
      ...(body.skuId === undefined ? {} : { skuId: body.skuId }),
      ...(body.supplierId === undefined ? {} : { supplierId: body.supplierId }),
      ...(body.supplierReference === undefined ? {} : { supplierReference: body.supplierReference }),
      ...(body.actualSupplierCost === undefined ? {} : { actualSupplierCost: body.actualSupplierCost }),
      ...(body.actualSupplierCurrency === undefined
        ? {}
        : { actualSupplierCurrency: body.actualSupplierCurrency }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    });
    return { workspace };
  }

  /**
   * Attaches the supplier's price to an order whose card is already stored.
   *
   * Separate from `/supplier-result` because that one refuses to run once an
   * asset exists: without this, a card entered by an admin on a code request
   * could never clear `ACTUAL_COST_MISSING` and so could never be sent.
   */
  @Post(':workItemId/actual-cost')
  async recordActualCost(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(recordActualCostBodySchema)) body: RecordActualCostBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    const workspace = await this.fulfillment.recordActualCost({
      workItemId,
      staff,
      actualSupplierCost: body.actualSupplierCost,
      ...(body.actualSupplierCurrency === undefined
        ? {}
        : { actualSupplierCurrency: body.actualSupplierCurrency }),
      ...(body.supplierReference === undefined ? {} : { supplierReference: body.supplierReference }),
    });
    return { workspace };
  }

  /**
   * Replaces a mistyped supplier cost. Manager-only, reason mandatory, and the
   * service voids any approval the old figure had earned.
   */
  @Post(':workItemId/correct-actual-cost')
  async correctActualCost(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(correctActualCostBodySchema)) body: CorrectActualCostBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    const workspace = await this.fulfillment.correctActualCost({
      workItemId,
      staff,
      actualSupplierCost: body.actualSupplierCost,
      reason: body.reason,
      ...(body.actualSupplierCurrency === undefined
        ? {}
        : { actualSupplierCurrency: body.actualSupplierCurrency }),
    });
    return { workspace };
  }

  @Post(':workItemId/approve-cost-variance')
  async approveCostVariance(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(reasonBodySchema)) body: ReasonBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    const workspace = await this.fulfillment.approveCostVariance({
      workItemId,
      staff,
      reason: body.reason,
    });
    return { workspace };
  }

  @Post(':workItemId/send')
  async send(
    @Param('workItemId') workItemId: string,
    @Req() request: unknown,
  ): Promise<{ outcome: DeliveryOutcome }> {
    const staff = requireStaff(request);
    return { outcome: await this.fulfillment.sendToCustomer({ workItemId, staff }) };
  }

  @Post(':workItemId/retry-delivery')
  async retryDelivery(
    @Param('workItemId') workItemId: string,
    @Req() request: unknown,
  ): Promise<{ outcome: DeliveryOutcome }> {
    const staff = requireStaff(request);
    return { outcome: await this.fulfillment.retryDelivery({ workItemId, staff }) };
  }

  @Post(':workItemId/reopen')
  async reopen(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(reasonBodySchema)) body: ReasonBody,
    @Req() request: unknown,
  ): Promise<{ workspace: FulfillmentWorkspace }> {
    const staff = requireStaff(request);
    return {
      workspace: await this.fulfillment.reopen({ workItemId, staff, reason: body.reason }),
    };
  }

  /**
   * Reveals the plaintext to the operator holding the claim.
   *
   * The response is the ONLY place in the API where a gift-card code appears, it
   * requires a written reason, and it writes `GIFT_CARD_CODE_VIEWED` before the
   * decryption happens.
   */
  @Post(':workItemId/assets/:assetId/reveal')
  async reveal(
    @Param('workItemId') workItemId: string,
    @Param('assetId') assetId: string,
    @Body(zodPipe(reasonBodySchema)) body: ReasonBody,
    @Req() request: unknown,
  ): Promise<{ secret: { assetType: string; code?: string; pin?: string; deliveryUrl?: string } }> {
    const staff = requireStaff(request);
    const secret = await this.fulfillment.revealAssetSecret({
      workItemId,
      assetId,
      staff,
      reason: body.reason,
    });
    return { secret };
  }

  /**
   * Reveals the customer's account password for an international payment.
   *
   * Same contract as the gift-card reveal above: claim holder only, a written
   * reason, and `SERVICE_ACCOUNT_PASSWORD_VIEWED` recorded before decryption. The
   * password is returned on its own so it can never end up in the cached
   * workspace payload.
   */
  @Post(':workItemId/service-account/reveal')
  async revealServiceAccountPassword(
    @Param('workItemId') workItemId: string,
    @Body(zodPipe(reasonBodySchema)) body: ReasonBody,
    @Req() request: unknown,
  ): Promise<{ credential: { accountPassword: string } }> {
    const staff = requireStaff(request);
    const credential = await this.fulfillment.revealServiceAccountPassword({
      workItemId,
      staff,
      reason: body.reason,
    });
    return { credential };
  }
}
