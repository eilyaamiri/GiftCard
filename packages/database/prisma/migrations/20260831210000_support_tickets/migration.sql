-- CreateEnum
CREATE TYPE "SupportMessageAuthorType" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "ownerStaffId" TEXT,
    "firstResponseDueAt" TIMESTAMP(3) NOT NULL,
    "nextResponseDueAt" TIMESTAMP(3) NOT NULL,
    "firstRespondedAt" TIMESTAMP(3),
    "lastRespondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "SupportMessageAuthorType" NOT NULL,
    "customerId" TEXT,
    "staffId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportOwnershipEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "previousStaffId" TEXT,
    "newStaffId" TEXT NOT NULL,
    "changedByStaffId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportOwnershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_workItemId_key" ON "SupportTicket"("workItemId");
CREATE INDEX "SupportTicket_ownerStaffId_nextResponseDueAt_idx" ON "SupportTicket"("ownerStaffId", "nextResponseDueAt");
CREATE INDEX "SupportTicket_firstResponseDueAt_idx" ON "SupportTicket"("firstResponseDueAt");
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");
CREATE INDEX "SupportMessage_staffId_createdAt_idx" ON "SupportMessage"("staffId", "createdAt");
CREATE INDEX "SupportOwnershipEvent_ticketId_createdAt_idx" ON "SupportOwnershipEvent"("ticketId", "createdAt");
CREATE INDEX "SupportOwnershipEvent_newStaffId_createdAt_idx" ON "SupportOwnershipEvent"("newStaffId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_ownerStaffId_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportOwnershipEvent" ADD CONSTRAINT "SupportOwnershipEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportOwnershipEvent" ADD CONSTRAINT "SupportOwnershipEvent_previousStaffId_fkey" FOREIGN KEY ("previousStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportOwnershipEvent" ADD CONSTRAINT "SupportOwnershipEvent_newStaffId_fkey" FOREIGN KEY ("newStaffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportOwnershipEvent" ADD CONSTRAINT "SupportOwnershipEvent_changedByStaffId_fkey" FOREIGN KEY ("changedByStaffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill ticket metadata for support requests created before threaded support.
INSERT INTO "SupportTicket" (
    "id", "workItemId", "ownerStaffId", "firstResponseDueAt", "nextResponseDueAt",
    "firstRespondedAt", "lastRespondedAt", "closedAt", "createdAt", "updatedAt"
)
SELECT
    'support_ticket_' || md5(w."id"),
    w."id",
    w."assignedToStaffId",
    w."createdAt" + INTERVAL '30 minutes',
    CASE
      WHEN w."status" IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN COALESCE(w."completedAt", w."updatedAt")
      ELSE COALESCE(w."dueAt", w."createdAt" + INTERVAL '30 minutes')
    END,
    CASE WHEN w."assignedToStaffId" IS NOT NULL THEN COALESCE(w."startedAt", w."assignedAt") END,
    CASE WHEN w."assignedToStaffId" IS NOT NULL THEN COALESCE(w."completedAt", w."startedAt", w."assignedAt") END,
    CASE WHEN w."status" IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN COALESCE(w."completedAt", w."updatedAt") END,
    w."createdAt",
    w."updatedAt"
FROM "WorkItem" w
WHERE w."type" = 'SUPPORT_REQUEST'
ON CONFLICT ("workItemId") DO NOTHING;

-- Preserve the customer's original request as the first conversation message.
INSERT INTO "SupportMessage" (
    "id", "ticketId", "authorType", "customerId", "body", "createdAt"
)
SELECT
    'support_message_' || md5(w."id"),
    t."id",
    'CUSTOMER'::"SupportMessageAuthorType",
    w."customerId",
    w."description",
    w."createdAt"
FROM "WorkItem" w
JOIN "SupportTicket" t ON t."workItemId" = w."id"
WHERE w."type" = 'SUPPORT_REQUEST' AND w."description" IS NOT NULL;

-- Record the legacy assignee as the initial owner so future transfers remain traceable.
INSERT INTO "SupportOwnershipEvent" (
    "id", "ticketId", "previousStaffId", "newStaffId", "changedByStaffId", "reason", "createdAt"
)
SELECT
    'support_owner_' || md5(w."id"),
    t."id",
    NULL,
    w."assignedToStaffId",
    w."assignedToStaffId",
    'LEGACY_ASSIGNEE_BACKFILL',
    COALESCE(w."assignedAt", w."createdAt")
FROM "WorkItem" w
JOIN "SupportTicket" t ON t."workItemId" = w."id"
WHERE w."type" = 'SUPPORT_REQUEST' AND w."assignedToStaffId" IS NOT NULL;
