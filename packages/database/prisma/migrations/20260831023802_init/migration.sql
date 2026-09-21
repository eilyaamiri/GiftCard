-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'FULFILLMENT_PENDING', 'FULFILLING', 'FULFILLED', 'FAILED', 'REVIEW_REQUIRED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'REDIRECTED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'UNKNOWN', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentFailureReason" AS ENUM ('CUSTOMER_CANCELLED', 'REQUEST_REJECTED', 'VERIFY_FAILED', 'INVALID_AUTHORITY', 'AMOUNT_MISMATCH', 'PROVIDER_TIMEOUT', 'PROVIDER_NETWORK_ERROR', 'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH', 'UNKNOWN_PROVIDER_RESPONSE');

-- CreateEnum
CREATE TYPE "PaymentAmountUnit" AS ENUM ('IRR', 'IRT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SUPPLIER', 'NEED_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkItemType" AS ENUM ('MANUAL_GIFT_CARD_FULFILLMENT', 'INTERNATIONAL_PAYMENT', 'CUSTOMER_INFORMATION', 'SUPPLIER_FOLLOWUP', 'UNKNOWN_OUTCOME', 'REFUND_REVIEW', 'SUPPORT_REQUEST');

-- CreateEnum
CREATE TYPE "QueueKey" AS ENUM ('GIFT_CARD_MANUAL', 'SAAS_PAYMENT', 'AI_TOOLS', 'DOMAIN_HOSTING', 'EXAM_PAYMENT', 'SUPPLIER_ISSUE', 'CUSTOMER_INFO_REQUIRED', 'UNKNOWN_OUTCOME', 'REFUND_REVIEW');

-- CreateEnum
CREATE TYPE "ChecklistItemType" AS ENUM ('BOOLEAN', 'SYSTEM_VERIFIED', 'REQUIRED_FIELD', 'MANAGER_APPROVAL');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'NOT_APPLICABLE', 'WAITING_APPROVAL');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('INCOMPLETE', 'READY_FOR_REVIEW', 'COMPLETED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DeliveryAssetType" AS ENUM ('CODE', 'CODE_PIN', 'URL', 'PROVIDER_DIRECT_EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_READY', 'READY', 'SENDING', 'SENT', 'DELIVERY_FAILED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'FINANCE', 'SUPPORT', 'VIEWER');

-- CreateEnum
CREATE TYPE "IdentityType" AS ENUM ('MOBILE', 'EMAIL');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'VERIFY_MOBILE', 'VERIFY_EMAIL', 'CHANGE_MOBILE', 'CHANGE_EMAIL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "FxPair" AS ENUM ('USD_IRR');

-- CreateEnum
CREATE TYPE "ReconciliationIssueType" AS ENUM ('payment_without_order', 'paid_not_fulfilled', 'supplier_purchase_without_fulfillment', 'amount_mismatch', 'duplicate_payment', 'unknown_payment', 'unknown_supplier_outcome', 'refund_mismatch', 'paid_without_work_item', 'fulfilled_without_gift_card', 'gift_card_entered_not_sent', 'sent_not_fulfilled', 'delivery_failed', 'missing_actual_supplier_cost');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED_WITH_REASON');

-- CreateEnum
CREATE TYPE "FunnelEventType" AS ENUM ('PRODUCT_VIEWED', 'SERVICE_VIEWED', 'CART_CREATED', 'CART_ITEM_ADDED', 'CART_ITEM_REMOVED', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'CHECKOUT_STARTED', 'CUSTOMER_IDENTIFIED', 'PAYMENT_STARTED', 'PAYMENT_REDIRECTED', 'PAYMENT_RETURNED', 'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'ORDER_FULFILLED');

-- CreateEnum
CREATE TYPE "AbandonmentType" AS ENUM ('BROWSE_ABANDONMENT', 'QUOTE_ABANDONMENT', 'CHECKOUT_ABANDONMENT', 'PAYMENT_ABANDONMENT', 'EXPIRED_QUOTE');

-- CreateEnum
CREATE TYPE "FeatureFlagKey" AS ENUM ('gift_cards_enabled', 'international_payments_enabled', 'manual_fulfillment_enabled', 'supplier_api_enabled', 'fx_auto_rate_enabled', 'payment_gateway_enabled', 'zarinpal_enabled');

-- CreateEnum
CREATE TYPE "ServiceFieldType" AS ENUM ('TEXT', 'EMAIL', 'URL', 'NUMBER', 'SELECT', 'TEXTAREA', 'FILE');

-- CreateEnum
CREATE TYPE "SupplierIntegrationMode" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "FulfillmentMethod" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PricingRuleScope" AS ENUM ('GLOBAL', 'PRODUCT', 'SKU', 'SERVICE');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('OPEN', 'CONVERTED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'SMS', 'PANEL');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerIdentity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "IdentityType" NOT NULL,
    "value" TEXT NOT NULL,
    "valueNormalized" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "nationalIdHash" TEXT,
    "birthDate" TIMESTAMP(3),
    "preferredLanguage" TEXT NOT NULL DEFAULT 'fa',
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "identityType" "IdentityType" NOT NULL,
    "identityValueNormalized" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "customerId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "utm" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authorStaffId" TEXT,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFlag" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT,
    "createdByStaffId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "teamId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Queue" (
    "id" TEXT NOT NULL,
    "key" "QueueKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "slaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueMembership" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "canAssign" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFa" TEXT NOT NULL,
    "description" TEXT,
    "descriptionFa" TEXT,
    "category" TEXT NOT NULL,
    "imageUrl" TEXT,
    "redemptionNotesFa" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "faceValue" DECIMAL(18,6) NOT NULL,
    "denominationLabel" TEXT NOT NULL,
    "deliveryAssetType" "DeliveryAssetType" NOT NULL DEFAULT 'CODE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "maxQuantity" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "integrationMode" "SupplierIntegrationMode" NOT NULL DEFAULT 'MANUAL',
    "supportsRawCode" BOOLEAN NOT NULL DEFAULT false,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "costAmount" DECIMAL(18,6) NOT NULL,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternationalService" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "minAmount" DECIMAL(18,6),
    "maxAmount" DECIMAL(18,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternationalService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFieldDefinition" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelFa" TEXT NOT NULL,
    "fieldType" "ServiceFieldType" NOT NULL DEFAULT 'TEXT',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "validationRegex" TEXT,
    "helpTextFa" TEXT,
    "options" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "PricingRuleScope" NOT NULL DEFAULT 'GLOBAL',
    "targetId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fxSpreadBps" INTEGER NOT NULL,
    "fxRiskBufferBps" INTEGER NOT NULL,
    "serviceFeeBps" INTEGER NOT NULL,
    "serviceFeeFixedIrr" BIGINT NOT NULL DEFAULT 0,
    "operationalFeeIrr" BIGINT NOT NULL DEFAULT 0,
    "targetMarginBps" INTEGER NOT NULL,
    "minimumMarginIrr" BIGINT NOT NULL DEFAULT 0,
    "paymentFeeBps" INTEGER NOT NULL,
    "paymentFeeFixedIrr" BIGINT NOT NULL DEFAULT 0,
    "quoteTtlSeconds" INTEGER NOT NULL DEFAULT 600,
    "roundingStepIrr" BIGINT NOT NULL DEFAULT 10000,
    "maxSupplierCostToleranceBps" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "pair" "FxPair" NOT NULL,
    "buyRate" DECIMAL(18,6) NOT NULL,
    "sellRate" DECIMAL(18,6) NOT NULL,
    "midRate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "createdByStaffId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "commerceSessionId" TEXT,
    "cartId" TEXT,
    "skuId" TEXT,
    "serviceId" TEXT,
    "supplierOfferId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricingRuleId" TEXT,
    "pricingVersion" INTEGER NOT NULL DEFAULT 1,
    "marketFxRate" DECIMAL(18,6) NOT NULL,
    "effectiveFxRate" DECIMAL(18,6) NOT NULL,
    "fxProvider" TEXT NOT NULL,
    "fxRateId" TEXT,
    "fxRateTimestamp" TIMESTAMP(3) NOT NULL,
    "fxSpreadAmount" BIGINT NOT NULL DEFAULT 0,
    "fxRiskBufferAmount" BIGINT NOT NULL DEFAULT 0,
    "supplierCostUsd" DECIMAL(18,6) NOT NULL,
    "supplierCostIrr" BIGINT NOT NULL,
    "paymentFee" BIGINT NOT NULL DEFAULT 0,
    "serviceFee" BIGINT NOT NULL DEFAULT 0,
    "operationalFee" BIGINT NOT NULL DEFAULT 0,
    "marginAmount" BIGINT NOT NULL DEFAULT 0,
    "discountAmount" BIGINT NOT NULL DEFAULT 0,
    "subtotal" BIGINT NOT NULL,
    "finalAmountIrr" BIGINT NOT NULL,
    "displayAmountToman" BIGINT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteComponent" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelFa" TEXT NOT NULL,
    "amountIrr" BIGINT NOT NULL,
    "amountForeign" DECIMAL(18,6),
    "currency" TEXT,
    "bps" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "commerceSessionId" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "skuId" TEXT,
    "serviceId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCostForeign" DECIMAL(18,6),
    "currency" TEXT,
    "inputData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "cartId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmountIrr" BIGINT NOT NULL,
    "displayAmountToman" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "idempotencyKey" TEXT NOT NULL,
    "deliveryEmail" TEXT,
    "customerNote" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "placedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amountIrr" BIGINT NOT NULL,
    "displayAmountToman" BIGINT NOT NULL,
    "providerAuthority" TEXT,
    "providerRefId" TEXT,
    "providerRequestCode" INTEGER,
    "providerVerifyCode" INTEGER,
    "providerAmount" DECIMAL(18,6),
    "providerAmountUnit" "PaymentAmountUnit",
    "providerFee" BIGINT,
    "providerFeeType" TEXT,
    "maskedCard" TEXT,
    "cardHash" TEXT,
    "failureReason" "PaymentFailureReason",
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3),
    "redirectedAt" TIMESTAMP(3),
    "callbackAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerCode" INTEGER,
    "providerMessage" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountIrr" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByStaffId" TEXT,
    "approvedByStaffId" TEXT,
    "providerRefundRef" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT,
    "queueId" TEXT NOT NULL,
    "type" "WorkItemType" NOT NULL,
    "status" "WorkItemStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "activeOrderKey" TEXT,
    "assignedToStaffId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskChecklistTemplate" (
    "id" TEXT NOT NULL,
    "workItemType" "WorkItemType" NOT NULL,
    "queueKey" "QueueKey",
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentChecklist" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "templateId" TEXT,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "blockedReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelFa" TEXT NOT NULL,
    "type" "ChecklistItemType" NOT NULL DEFAULT 'BOOLEAN',
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "isBlocking" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "value" JSONB,
    "verifiedByStaffId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "workItemId" TEXT,
    "supplierId" TEXT,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "FulfillmentMethod" NOT NULL DEFAULT 'MANUAL',
    "supplierReference" TEXT,
    "supplierOrderId" TEXT,
    "actualSupplierCost" DECIMAL(18,6),
    "actualSupplierCurrency" TEXT,
    "actualSupplierCostIrr" BIGINT,
    "costVarianceBps" INTEGER,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fulfilledByStaffId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardAsset" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT,
    "orderId" TEXT NOT NULL,
    "skuId" TEXT,
    "assetType" "DeliveryAssetType" NOT NULL DEFAULT 'CODE',
    "encryptedCode" TEXT,
    "encryptedPin" TEXT,
    "maskedCode" TEXT,
    "serialNumber" TEXT,
    "deliveryUrl" TEXT,
    "recipientEmail" TEXT,
    "expiryDate" TIMESTAMP(3),
    "supplierReference" TEXT,
    "actualSupplierCost" DECIMAL(18,6),
    "actualSupplierCurrency" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'NOT_READY',
    "enteredByUserId" TEXT,
    "enteredAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "giftCardAssetId" TEXT,
    "orderId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL DEFAULT 'EMAIL',
    "recipientMasked" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "type" "FunnelEventType" NOT NULL,
    "commerceSessionId" TEXT,
    "customerId" TEXT,
    "cartId" TEXT,
    "quoteId" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT,
    "productId" TEXT,
    "skuId" TEXT,
    "serviceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "properties" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbandonmentRecord" (
    "id" TEXT NOT NULL,
    "type" "AbandonmentType" NOT NULL,
    "commerceSessionId" TEXT,
    "customerId" TEXT,
    "cartId" TEXT,
    "quoteId" TEXT,
    "orderId" TEXT,
    "lastEventType" "FunnelEventType",
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "amountIrr" BIGINT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveredAt" TIMESTAMP(3),
    "recoveryOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "type" "ReconciliationIssueType" NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "orderId" TEXT,
    "paymentId" TEXT,
    "fulfillmentId" TEXT,
    "giftCardAssetId" TEXT,
    "expectedAmountIrr" BIGINT,
    "actualAmountIrr" BIGINT,
    "differenceIrr" BIGINT,
    "details" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToStaffId" TEXT,
    "resolvedByStaffId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "ignoreReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'STAFF',
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" "FeatureFlagKey" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "rolloutBps" INTEGER NOT NULL DEFAULT 0,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE INDEX "Customer_status_createdAt_idx" ON "Customer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerIdentity_customerId_type_idx" ON "CustomerIdentity"("customerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIdentity_type_valueNormalized_key" ON "CustomerIdentity"("type", "valueNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_customerId_key" ON "CustomerProfile"("customerId");

-- CreateIndex
CREATE INDEX "OtpChallenge_identityValueNormalized_purpose_createdAt_idx" ON "OtpChallenge"("identityValueNormalized", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_customerId_createdAt_idx" ON "OtpChallenge"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_customerId_expiresAt_idx" ON "AuthSession"("customerId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceSession_sessionToken_key" ON "CommerceSession"("sessionToken");

-- CreateIndex
CREATE INDEX "CommerceSession_customerId_lastSeenAt_idx" ON "CommerceSession"("customerId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "CommerceSession_lastSeenAt_idx" ON "CommerceSession"("lastSeenAt");

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerFlag_key_createdAt_idx" ON "CustomerFlag"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFlag_customerId_key_key" ON "CustomerFlag"("customerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "StaffUser_role_isActive_idx" ON "StaffUser"("role", "isActive");

-- CreateIndex
CREATE INDEX "StaffUser_teamId_idx" ON "StaffUser"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Queue_key_key" ON "Queue"("key");

-- CreateIndex
CREATE INDEX "QueueMembership_staffUserId_idx" ON "QueueMembership"("staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueMembership_queueId_staffUserId_key" ON "QueueMembership"("queueId", "staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_category_isActive_sortOrder_idx" ON "Product"("category", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_brand_isActive_idx" ON "Product"("brand", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE INDEX "Sku_productId_isActive_idx" ON "Sku"("productId", "isActive");

-- CreateIndex
CREATE INDEX "Sku_isActive_region_idx" ON "Sku"("isActive", "region");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_productId_region_faceValue_currency_key" ON "Sku"("productId", "region", "faceValue", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_isActive_idx" ON "Supplier"("isActive");

-- CreateIndex
CREATE INDEX "SupplierOffer_skuId_isActive_priority_idx" ON "SupplierOffer"("skuId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOffer_supplierId_skuId_key" ON "SupplierOffer"("supplierId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "InternationalService_slug_key" ON "InternationalService"("slug");

-- CreateIndex
CREATE INDEX "InternationalService_category_isActive_sortOrder_idx" ON "InternationalService"("category", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ServiceFieldDefinition_serviceId_sortOrder_idx" ON "ServiceFieldDefinition"("serviceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFieldDefinition_serviceId_key_key" ON "ServiceFieldDefinition"("serviceId", "key");

-- CreateIndex
CREATE INDEX "PricingRule_scope_targetId_isActive_idx" ON "PricingRule"("scope", "targetId", "isActive");

-- CreateIndex
CREATE INDEX "PricingRule_isActive_effectiveFrom_idx" ON "PricingRule"("isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_scope_targetId_version_key" ON "PricingRule"("scope", "targetId", "version");

-- CreateIndex
CREATE INDEX "FxRate_pair_effectiveAt_idx" ON "FxRate"("pair", "effectiveAt");

-- CreateIndex
CREATE INDEX "FxRate_pair_isManualOverride_effectiveAt_idx" ON "FxRate"("pair", "isManualOverride", "effectiveAt");

-- CreateIndex
CREATE INDEX "FxRate_provider_receivedAt_idx" ON "FxRate"("provider", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNumber_key" ON "Quote"("quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_idempotencyKey_key" ON "Quote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Quote_customerId_status_createdAt_idx" ON "Quote"("customerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_status_expiresAt_idx" ON "Quote"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Quote_commerceSessionId_createdAt_idx" ON "Quote"("commerceSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_createdAt_idx" ON "Quote"("createdAt");

-- CreateIndex
CREATE INDEX "QuoteComponent_quoteId_sortOrder_idx" ON "QuoteComponent"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "Cart_customerId_status_idx" ON "Cart"("customerId", "status");

-- CreateIndex
CREATE INDEX "Cart_commerceSessionId_status_idx" ON "Cart"("commerceSessionId", "status");

-- CreateIndex
CREATE INDEX "Cart_status_updatedAt_idx" ON "Cart"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_quoteId_idx" ON "Order"("quoteId");

-- CreateIndex
CREATE INDEX "Order_paidAt_idx" ON "Order"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_customerId_createdAt_idx" ON "Payment"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_verifiedAt_idx" ON "Payment"("verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerAuthority_key" ON "Payment"("provider", "providerAuthority");

-- CreateIndex
CREATE INDEX "PaymentAttempt_paymentId_createdAt_idx" ON "PaymentAttempt"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_paymentId_attemptNumber_key" ON "PaymentAttempt"("paymentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_status_requestedAt_idx" ON "Refund"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_code_key" ON "WorkItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_activeOrderKey_key" ON "WorkItem"("activeOrderKey");

-- CreateIndex
CREATE INDEX "WorkItem_queueId_status_priority_idx" ON "WorkItem"("queueId", "status", "priority");

-- CreateIndex
CREATE INDEX "WorkItem_assignedToStaffId_status_idx" ON "WorkItem"("assignedToStaffId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_status_createdAt_idx" ON "WorkItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItem_orderId_idx" ON "WorkItem"("orderId");

-- CreateIndex
CREATE INDEX "WorkItem_type_status_idx" ON "WorkItem"("type", "status");

-- CreateIndex
CREATE INDEX "TaskChecklistTemplate_workItemType_isActive_idx" ON "TaskChecklistTemplate"("workItemType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChecklistTemplate_workItemType_queueKey_version_key" ON "TaskChecklistTemplate"("workItemType", "queueKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentChecklist_workItemId_key" ON "FulfillmentChecklist"("workItemId");

-- CreateIndex
CREATE INDEX "FulfillmentChecklist_status_updatedAt_idx" ON "FulfillmentChecklist"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "FulfillmentChecklistItem_checklistId_status_idx" ON "FulfillmentChecklistItem"("checklistId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentChecklistItem_checklistId_key_key" ON "FulfillmentChecklistItem"("checklistId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_idempotencyKey_key" ON "Fulfillment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Fulfillment_orderId_idx" ON "Fulfillment"("orderId");

-- CreateIndex
CREATE INDEX "Fulfillment_status_createdAt_idx" ON "Fulfillment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Fulfillment_supplierId_createdAt_idx" ON "Fulfillment"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "Fulfillment_workItemId_idx" ON "Fulfillment"("workItemId");

-- CreateIndex
CREATE INDEX "GiftCardAsset_orderId_idx" ON "GiftCardAsset"("orderId");

-- CreateIndex
CREATE INDEX "GiftCardAsset_status_createdAt_idx" ON "GiftCardAsset"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCardAsset_fulfillmentId_idx" ON "GiftCardAsset"("fulfillmentId");

-- CreateIndex
CREATE INDEX "GiftCardAsset_enteredByUserId_enteredAt_idx" ON "GiftCardAsset"("enteredByUserId", "enteredAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_orderId_createdAt_idx" ON "DeliveryAttempt"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_giftCardAssetId_attemptNumber_idx" ON "DeliveryAttempt"("giftCardAssetId", "attemptNumber");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_status_createdAt_idx" ON "DeliveryAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_type_occurredAt_idx" ON "FunnelEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_commerceSessionId_occurredAt_idx" ON "FunnelEvent"("commerceSessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_customerId_occurredAt_idx" ON "FunnelEvent"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_orderId_idx" ON "FunnelEvent"("orderId");

-- CreateIndex
CREATE INDEX "FunnelEvent_occurredAt_idx" ON "FunnelEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AbandonmentRecord_type_detectedAt_idx" ON "AbandonmentRecord"("type", "detectedAt");

-- CreateIndex
CREATE INDEX "AbandonmentRecord_customerId_detectedAt_idx" ON "AbandonmentRecord"("customerId", "detectedAt");

-- CreateIndex
CREATE INDEX "AbandonmentRecord_commerceSessionId_idx" ON "AbandonmentRecord"("commerceSessionId");

-- CreateIndex
CREATE INDEX "AbandonmentRecord_recoveredAt_idx" ON "AbandonmentRecord"("recoveredAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_status_detectedAt_idx" ON "ReconciliationIssue"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_type_status_idx" ON "ReconciliationIssue"("type", "status");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_orderId_idx" ON "ReconciliationIssue"("orderId");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_paymentId_idx" ON "ReconciliationIssue"("paymentId");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_assignedToStaffId_status_idx" ON "ReconciliationIssue"("assignedToStaffId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actor_createdAt_idx" ON "AuditLog"("actor", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- AddForeignKey
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT "CustomerIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceSession" ADD CONSTRAINT "CommerceSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFlag" ADD CONSTRAINT "CustomerFlag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFlag" ADD CONSTRAINT "CustomerFlag_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueMembership" ADD CONSTRAINT "QueueMembership_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "Queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueMembership" ADD CONSTRAINT "QueueMembership_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFieldDefinition" ADD CONSTRAINT "ServiceFieldDefinition_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "InternationalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_commerceSessionId_fkey" FOREIGN KEY ("commerceSessionId") REFERENCES "CommerceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "InternationalService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_fxRateId_fkey" FOREIGN KEY ("fxRateId") REFERENCES "FxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComponent" ADD CONSTRAINT "QuoteComponent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_commerceSessionId_fkey" FOREIGN KEY ("commerceSessionId") REFERENCES "CommerceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "InternationalService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "Queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_assignedToStaffId_fkey" FOREIGN KEY ("assignedToStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentChecklist" ADD CONSTRAINT "FulfillmentChecklist_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentChecklist" ADD CONSTRAINT "FulfillmentChecklist_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentChecklistItem" ADD CONSTRAINT "FulfillmentChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "FulfillmentChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentChecklistItem" ADD CONSTRAINT "FulfillmentChecklistItem_verifiedByStaffId_fkey" FOREIGN KEY ("verifiedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_fulfilledByStaffId_fkey" FOREIGN KEY ("fulfilledByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardAsset" ADD CONSTRAINT "GiftCardAsset_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardAsset" ADD CONSTRAINT "GiftCardAsset_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardAsset" ADD CONSTRAINT "GiftCardAsset_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardAsset" ADD CONSTRAINT "GiftCardAsset_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_giftCardAssetId_fkey" FOREIGN KEY ("giftCardAssetId") REFERENCES "GiftCardAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_assignedToStaffId_fkey" FOREIGN KEY ("assignedToStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
