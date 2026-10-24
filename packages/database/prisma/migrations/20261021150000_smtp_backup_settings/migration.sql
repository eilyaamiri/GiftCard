-- Admin-managed outbound e-mail (SMTP) and off-host backup settings.
-- Additive only: three enums, three new tables, no change to existing rows.

-- CreateEnum
CREATE TYPE "SmtpSecurity" AS ENUM ('SSL_TLS', 'STARTTLS');

-- CreateEnum
CREATE TYPE "BackupRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "SmtpSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 587,
    "security" "SmtpSecurity" NOT NULL DEFAULT 'STARTTLS',
    "username" TEXT NOT NULL DEFAULT '',
    "passwordEncrypted" TEXT,
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL DEFAULT '',
    "remoteDirectory" TEXT NOT NULL DEFAULT '',
    "hostKeys" TEXT NOT NULL DEFAULT '',
    "privateKeyEncrypted" TEXT,
    "publicKey" TEXT,
    "archivePassphraseEncrypted" TEXT,
    "dailyAtMinute" INTEGER NOT NULL DEFAULT 240,
    "retentionCount" INTEGER NOT NULL DEFAULT 14,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "trigger" "BackupRunTrigger" NOT NULL,
    "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
    "scheduledDay" TEXT,
    "sourceSnapshot" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "remoteFileName" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "errorMessage" TEXT,
    "requestedByStaffId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupRun_scheduledDay_key" ON "BackupRun"("scheduledDay");

-- CreateIndex
CREATE INDEX "BackupRun_status_startedAt_idx" ON "BackupRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");


-- Both settings tables hold exactly one row.
ALTER TABLE "SmtpSettings" ADD CONSTRAINT "SmtpSettings_singleton" CHECK ("id" = 'default');
ALTER TABLE "BackupSettings" ADD CONSTRAINT "BackupSettings_singleton" CHECK ("id" = 'default');

ALTER TABLE "SmtpSettings" ADD CONSTRAINT "SmtpSettings_port_range" CHECK ("port" BETWEEN 1 AND 65535);
ALTER TABLE "BackupSettings" ADD CONSTRAINT "BackupSettings_port_range" CHECK ("port" BETWEEN 1 AND 65535);
ALTER TABLE "BackupSettings" ADD CONSTRAINT "BackupSettings_daily_minute_range" CHECK ("dailyAtMinute" BETWEEN 0 AND 1439);
ALTER TABLE "BackupSettings" ADD CONSTRAINT "BackupSettings_retention_range" CHECK ("retentionCount" BETWEEN 1 AND 365);

-- A scheduled run always names its day; a manual run never does.
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_scheduled_day_matches_trigger"
  CHECK (("trigger" = 'SCHEDULED') = ("scheduledDay" IS NOT NULL));
