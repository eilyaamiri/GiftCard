# AGENTS.md — Barat Pay Engineering Contract

This file is binding for **every** agent and human contributor in this repository.
If a task instruction conflicts with this file, **this file wins** — stop and escalate.

---

## 1. The 13 Engineering Rules (non-negotiable)

1. **Financial correctness > development speed.**
2. **NEVER use JS float for money.** Use `BigInt` (IRR) or `Decimal.js`.
3. **Store Iranian money internally as IRR (`BigInt`).** UI may display Toman. Explicit
   conversion helpers only.
4. **Every financial calculation must be auditable.**
5. **Orders NEVER call a specific payment provider directly.**
6. **Orders NEVER call a specific FX provider directly.**
7. **Orders NEVER call a specific supplier provider directly** — only via interfaces in
   `integrations/`.
8. **Payment callbacks ALWAYS verified server-side.** Never trust callback params.
9. **Idempotency required:** payment, quote acceptance, order creation, fulfillment.
10. **NEVER log:** payment tokens, API secrets, gift card codes/PINs, private keys, OTP values.
11. **Quote snapshots immutable once checkout/payment starts.**
12. **Every financial change requires tests.**
13. **Percentages are integer basis points (`100 bps = 1%`).**

---

## 2. The golden dependency direction (enforced by ESLint)

```
apps/*          ->  packages/contracts        ->  (nothing)
apps/api        ->  packages/database, integrations/*   (interface barrel only)
integrations/*  ->  packages/contracts        (never the reverse)
packages/ui     ->  packages/config           (never apps, never api)
```

The domain core (`pricing`, `quotes`, `orders`, `fulfillment`, …) may **never** `import`
`zarinpal`, `tillo`, `reloadly`, `runa`, `giftbit` or any other concrete provider.
This is enforced by a `no-restricted-imports` rule in the root `eslint.config.mjs`:

```
apps/api/src/modules/**  ⇏  integrations/*/src/providers/**
apps/api/src/modules/**  ⇏  @barat/{fx,payments,suppliers,notifications}/providers/**
```

Modules resolve providers through the **interface barrel** (`@barat/payments`,
`@barat/fx`, …) and dependency injection tokens only.

---

## 3. Directory ownership map

Two agents never write to the same file. Coordination happens exclusively through
`packages/contracts`, which is **frozen** after Phase 0.

### Frozen after Phase 0 — Foundation agent only

| Path | Owner |
|---|---|
| root config files (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `eslint.config.mjs`, `.env.example`, `AGENTS.md`) | Foundation (O1) |
| `packages/config/**` | Foundation (O1), tailwind preset shared with S1 |
| `packages/contracts/**` | Foundation (O1) — **FROZEN** |
| `packages/database/prisma/schema.prisma` | Foundation (O1) — **FROZEN** |
| `apps/api/src/app.module.ts` | Foundation (O1) — **FROZEN module registry** |
| `apps/api/src/common/**` | Foundation (O1), security subtree shared with O6 |

Need something that is missing in a frozen file? **Do not edit it.** Work around it and
report the gap; the Foundation agent applies the change in one controlled pass.

### Opus workstreams — financially critical

| Code | Workstream | Owned directories |
|---|---|---|
| **O1** | Core Platform | root, `packages/config`, `packages/contracts`, `packages/database` |
| **O2 / B1** | Money & Pricing Engine | `apps/api/src/modules/pricing` |
| **O3 / B2** | FX Aggregator | `apps/api/src/modules/fx`, `integrations/fx/src` |
| **O4 / B4** | Payments & ZarinPal | `apps/api/src/modules/payments`, `integrations/payments/src` |
| **O5 / B3** | Quotes, Orders, Catalog | `apps/api/src/modules/{quotes,orders,catalog}` |
| **O5 / B6** | Fulfillment, WorkItems, Suppliers | `apps/api/src/modules/{workitems,fulfillment,suppliers}`, `integrations/suppliers/src` |
| **O6 / B5** | Identity, RBAC, Audit, Customers | `apps/api/src/modules/{identity,audit,customers}` |
| **O7** | Finance & Reconciliation | `apps/api/src/modules/{finance,reconciliation,reporting}` |

### Sonnet workstreams

| Code | Workstream | Owned directories |
|---|---|---|
| **S1 / B7** | Design System | `packages/ui/src`, tailwind token file |
| **S2 / B8** | Customer Web | `apps/web/src` |
| **S3** | Admin Panel | `apps/admin/src/app/(admin)` |
| **S4** | Operator Workspace | `apps/admin/src/app/(operator)` |
| **S5** | Reporting UI + Analytics | `apps/admin/src/app/(reports)`, `apps/api/src/modules/analytics` |
| **S6 / B10** | QA / E2E / Seed | `tests/**`, `packages/test-utils/src`, `packages/database/prisma/seed.ts` |
| **S7** | Documentation | `docs/**` |
| **S8** | DevOps & CI | `.github/workflows`, `apps/*/Dockerfile` |

`integrations/*/package.json` and `integrations/*/tsconfig.json` are Foundation-owned;
`integrations/*/src` belongs to the matching workstream.

---

## 4. Human gates — no agent may self-merge

An agent may **prepare** the change but a human must review and approve before merge in
these areas:

1. **Payment** — provider request/verify logic, amount units, callback handling, refunds.
2. **Pricing** — the pricing formula, `PricingRule` values, rounding, margin floors.
3. **FX** — provider selection, stale thresholds, manual overrides, spread/buffer policy.
4. **Security & secrets** — encryption, key handling, OTP, sessions, RBAC, rate limits,
   log redaction, anything touching `GIFT_CARD_ENCRYPTION_KEY` or `SESSION_JWT_SECRET`.
5. **Production release** — enabling `ZARINPAL_ENABLED`, migrations against production,
   feature-flag flips that expose money movement to real customers.

Additionally, **manager approval** is required in-product for supplier cost variance
beyond `PricingRule.maxSupplierCostToleranceBps`.

---

## 5. Money conventions

| Concept | Representation |
|---|---|
| Iranian rial amount | `BigInt` / Prisma `BigInt` — integer rial, never fractional |
| Toman (display only) | `IRR / 10`, computed at the edge via an explicit helper |
| Foreign currency | `Decimal.js` / Prisma `Decimal @db.Decimal(18, 6)` |
| Rate / percentage / fee rate | integer **basis points** (`Int`); `100 bps = 1%` |
| FX rate | `Decimal @db.Decimal(18, 6)` |

The single source of truth for the pricing formula:

```
effectiveFxRate    = marketFxRate + fxSpread(bps) + fxRiskBuffer(bps)
supplierCostIrr    = supplierCostUsd x effectiveFxRate
subtotal           = supplierCostIrr
                   + paymentFee(bps + fixed)
                   + serviceFee(bps + fixed)
                   + operationalFee(fixed)
                   + margin(targetMarginBps, floored at minimumMarginIrr)
                   - discount
finalAmountIrr     = roundUp(subtotal, roundingStepIrr)
displayAmountToman = finalAmountIrr / 10
```

There is exactly **one** implementation of this formula. The admin Quote Simulator calls
the same pure function — it never re-implements it.

`Quote.finalAmountIrr === Order.totalAmountIrr === Payment.amountIrr`. Any mismatch is the
security event `AMOUNT_MISMATCH` and halts the flow.

---

## 6. Data rules

1. All rial money columns are `BigInt`. There is no `Float` money column anywhere.
2. All foreign-currency columns are `Decimal @db.Decimal(18, 6)`.
3. All percentages are `Int` basis points.
4. A `Quote` stores a **full snapshot**, not references — FX rate, provider, timestamp,
   every fee component and the pricing rule version.
5. `GiftCardAsset` stores only `encryptedCode` / `encryptedPin` (AES-256-GCM, application
   layer, key from env/secret manager) plus a `maskedCode` for display.
   **There is no plaintext code column and no code is ever logged.**
6. Financial history is never hard-deleted — only status transitions.
7. `DeliveryAssetType` is one of `CODE | CODE_PIN | URL | PROVIDER_DIRECT_EMAIL`.
   Reloadly / Runa / Giftbit do **not** hand a raw code to the operator; only Tillo does.
   Any code that assumes "the operator always types a code" is wrong.

---

## 7. Definition of done (every workstream)

- [ ] `pnpm typecheck` passes for the owned packages.
- [ ] `pnpm lint` passes with zero warnings in owned directories.
- [ ] Unit tests exist for every financial branch; edge cases included.
- [ ] No secret, code, PIN, OTP or token appears in any log statement or error message.
- [ ] Every externally reachable endpoint validates input with a `packages/contracts` schema.
- [ ] Idempotency covered by a test for the five idempotent operations (rule 9).
- [ ] No file outside the workstream's owned directories was modified.
