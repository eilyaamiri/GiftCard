-- CreateTable
CREATE TABLE "CustomerBankAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "ibanEncrypted" TEXT NOT NULL,
    "ibanMasked" TEXT NOT NULL,
    "ibanBankName" TEXT,
    "cardEncrypted" TEXT NOT NULL,
    "cardMasked" TEXT NOT NULL,
    "cardBankName" TEXT,
    "ownershipAttestedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBankAccount_customerId_key" ON "CustomerBankAccount"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerBankAccount" ADD CONSTRAINT "CustomerBankAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
