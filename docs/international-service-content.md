# International service content release

Scope: 131 non-gift-card entries from the supplied
`pardakht-pro-rewritten-illustrated.docx`, including category pages. The 1,561
gift-card entries are excluded. All 213 referenced image assets are stored locally
with their original bytes; MailerLite's monthly plan reuses its documented shared
image. Custom payment uses the supplied foreign-site payment illustration.

Customer-facing text replaces the source company name with «برات». Document
identifiers, image identifiers, table of contents, editorial guidance and internal
notes are excluded. The unsupported claim about an office in Oman is replaced
with a statement that destination/account eligibility is reviewed. References to
the form below are adapted to the form above. Descriptions, steps, conditions and
FAQs otherwise retain the supplied content. They are not a fresh verification of
vendor pricing, plans, refund policies, availability, delivery promises or legal
conditions. Those source claims require business review before activation;
especially legacy services such as Google Domains and Lynda. The page notes that
plan information may change and the checkout quote is the payable amount. No
source prices are used in financial calculations.

## Application behavior

Detailed content is server-rendered immediately after the existing request form.
The form's fields, input IDs, validation, credentials handling, quote body and
navigation are unchanged. Its only extension is an optional rendered child after
the closing form tag. The existing top artwork remains; source images also appear
on service cards and below the form. No schema or contract changes are required.

The service listing supports search and category filtering. Both list/detail pages
read all API pages rather than silently stopping at 20 services. Existing active
service rows are still required: content alone does not create a purchasable
service or fabricate a service ID.

Six source category entries map to existing slugs: `ai-tools`, `cloud-hosting`,
`saas-subscriptions`, `online-courses`, `domain-hosting`, `exam-fees`. Existing rows
and their fields are never overwritten. The other entries get deterministic
source-specific slugs; similarly named services in the document remain separate.

## Reviewed import, separate from deploy

From `packages/database`, preview without a database connection:

```sh
pnpm exec tsx prisma/import-international-services.ts --dry-run
```

After human release approval and a verified fresh backup, an operator may run:

```sh
pnpm exec tsx prisma/import-international-services.ts --apply
```

Supply `DATABASE_URL` only through the approved server environment; never paste it
into Git, a ticket or the command line. This is not the demo seed. The importer
creates missing records in one transaction, inactive and requiring manual review.
It copies the existing `saas-subscriptions` form fields, currency and amount bounds
without changing the template. Missing template/fields abort the operation. It
never edits existing rows, fields, money rules, activation flags, quotes or orders.
Re-running preserves operator edits and does not duplicate records.

With all six existing category services, 125 new inactive services are expected.
The actual count depends on existing slugs. Review the newly imported rows and
activate selected services through the existing admin workflow only after
verifying the source's claims, currency, bounds and operational support. Deploying
this PR does not execute the importer or enable new services automatically.

Existing six category pages receive the new descriptive content on web deployment;
include those pages in content approval even if new services remain inactive.

## Validation and rollback

- Content tests check 131 distinct entries, importer/content consistency, every
  local image, and removal of source branding/editorial markers.
- Browser tests assert information follows the original form, the same request
  fields reach the quote API, and a late-page service works on mobile.
- The disposable PostgreSQL CI test checks copied fields, unchanged existing
  service configuration, inactive new rows and repeat-import idempotency.
- Standard lint/typecheck/unit/build CI applies as usual.

No production import, activation or deployment has been executed during authoring.
For a UI rollback, revert the web release normally. Do not delete imported services
that may be referenced by orders or quotes; deactivate them through the normal
admin path after review. Financial records must never be deleted.
