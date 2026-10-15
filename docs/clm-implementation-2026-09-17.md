# Contract Lifecycle Management implementation — 17 September 2026

## Status

The additive CLM implementation and ERP schema migration are in place. All ten existing Contract-related schema/list adapters were checked against ERPNext: every editable field exists and all lists return successfully. The live Contract, Request, Matrix, Template, Clause and related registers currently contain no records. No demonstration business records, approvals or signatures were created.

Live browser acceptance requires a signed-in Procurement Manager session. End-to-end live approval/signing also requires an approved Contract Approval Matrix and genuine business input. The implementation rejects review submission when no rule matches; it does not invent approval thresholds or approvers.

## Existing functionality reused

- The nine requested CLM DocTypes plus the existing Contract Template.
- `Contract.custom_contract_status` for CLM lifecycle, preserving ERPNext's native `Contract.status` behavior.
- Existing contract types, terms, sources, signature fields, version/lock flags, and Obligation owner field `owne`.
- Existing authenticated app roles, private File storage/resolution, PDF signature renderer, native Version history and Notification Log.
- Existing RFQ Legal pages remain at `/legal/contracts…`; the new CLM register is `/contracts`.
- No existing Contract-specific AI analysis service was found. No AI approval capability was introduced.

## Entry points

| Purpose | Route |
| --- | --- |
| Contract register and operational alerts | `/contracts` |
| Contract Request register | `/contract-requests` |
| Authoring | `/contracts/new` |
| Existing related records | `/contracts/records/:recordType/:name` |
| Matrix, clause and template configuration | `/contracts/settings` |
| Assigned supplier contracts | `/supplier/contracts` |
| Authenticated read/action/file API | `/api/clm` |
| Protected scheduled monitoring | `/api/clm-monitor` |

The record API controls action visibility and rechecks every mutation. Finance, Engineering, Quality, Legal and Program reviewers only read/act on assigned records. A named reviewer must hold the corresponding current canonical app role. Supplier reads, uploads and downloads are constrained to their Contract; internal notes and approval details are excluded from supplier responses. Generic ERP queries cannot bypass these CLM controls.

## Schema and migration

The migration adds optional fields only: four runtime evidence fields; missing Request/Contract source references; matrix conditions/stage definitions; and obligation quantity/frequency/period fields. It extends existing Select options to retain the union of current contract types and add Hybrid routing. Two CLM-only native workflows constrain Contract and Request state transitions through the existing service role. No DocType or role was created.

Commands:

```powershell
node scripts/setup-clm.mjs --check
node scripts/setup-clm.mjs --apply
```

The apply script writes a complete schema, CLM-record and workflow backup before ERP changes. It checks field aliases/types, leaves unrelated workflows and permissions intact, and refuses automatic workflow activation where unmanaged existing records would be affected.

This run's backup is `scratch/clm-migration-2026-09-17T07-05-38-663Z/before.json`; its `result.json` verifies 49 schema/workflow operations, zero new DocTypes, zero new roles, no record migration, unchanged permission definitions, unchanged three pre-existing workflows, and zero remaining migration operations. Saving two custom DocTypes refreshed permission child-row timestamps only; verification compares all permission flags separately from those timestamps.

## Approval policy configuration

An Administrator must enter approved rules in the existing Contract Approval Matrix:

1. Choose contract type, risk/value ranges, required reviewer roles and the rule purpose.
2. Set an explicit currency when using value thresholds; there is no inferred currency conversion.
3. Use Sequential, Parallel, or Hybrid. Explicit stages define ordering; equal stages run in parallel. Required role flags cannot be omitted from configured stages.
4. Put a required final approver in the final stage and use an enabled existing User whose canonical role matches that stage.
5. Configure amendment, renewal and termination rules as appropriate. Termination must include Legal.

Optional conditions use existing business-unit data, latest linked Supplier Onboarding status, non-standard selected/modified clauses, and prior supplier contract history. “New supplier” means no other executed/signed Contract for that supplier. Unknown required source data stops routing with an explanation. A Request-to-Contract conversion requires an explicit assessed risk level.

## Lifecycle and evidence

- Procurement Team creates Requests; Procurement Manager validates them. Approved Requests create the central Contract and preserve source references.
- Source lookups validate Supplier, RFQ, quotation, PO, RFP response and Request relationships. Template/Clause content is copied for controlled authoring. Unresolved template placeholders are shown to the author.
- Generated approval rows use only Pending, Approved, Rejected and Sent Back. All required approvals must be Approved before the final lock.
- Every revision preserves previous content, author, timestamp, comments, prior reference and hash. Revisions archive earlier approvals, lock artifacts and signature evidence.
- Supplier negotiation documents require a server-issued upload receipt. The service re-fetches the exact private File and checks its bytes before recording provenance. A guessed internal File ID cannot be published as a supplier attachment.
- Approved content is copied/generated into a private locked PDF with a dedicated execution page. Supplier signs first; the configured Inteva signatory signs second. Both signatures are verified against the same version and preserved in the executed PDF.
- Activation requires both signatures and an effective date range. Executed does not mean Closed.
- Obligations, milestones, risk and SLA measurements remain attached to the central Contract. Latest breached measurements drive alerts while previous readings remain in history.
- Amendment/renewal approvals create a separate Contract carrying provenance to the original and change record. The original terms/signatures stay intact. The change is executed only after the derivative Contract completes review/signing.
- Expiry and termination lead to closure validation. Open obligations, milestones, risks, referenced POs and unsettled invoices block closure. Procurement also attests to claims, disputes, warranty, settlement, archived documents and outstanding actions.

## Monitoring and notifications

Action notifications use native Frappe Notification Log with routes to the appropriate internal/supplier Contract screens. Current recipient permissions are rechecked before delivery. Failed notification delivery is reported as a warning after a saved action; it does not turn a committed approval into a false failure.

The daily scheduled handler checks obligation due/reminder/escalation dates, repeated supplier misses, milestones, risks, current SLA breaches, renewal notice periods and expiry/closure needs. It writes only native notifications; it does not approve, sign, renew or close business records. Coordinators may also run `POST /api/clm?view=monitor` using their normal authenticated session.

Set a strong **server-only `CRON_SECRET`** in deployment settings before using the scheduled route. The Vercel schedule is daily at 03:00 UTC. No secret is committed. The handler refuses unauthenticated calls and does not accept secrets in URLs. Dates follow the existing `ERP_TIME_ZONE` / `VITE_ERP_TIME_ZONE` configuration, defaulting to the application's existing ERP timezone.

Notification deduplication checks persisted subject/recipient pairs; simultaneous runners can still race because the existing Notification Log API does not provide an atomic unique external key. Optimistic record checks prevent stale approval/signature commits. An upload whose response/save fails may leave an unattached-to-workflow private File; it never reports a successful signature or receipt without verification.

## Verification

Final production build and strict CLM API TypeScript checks pass. The final targeted CLM/schema/UI/security run passed **314 tests across 15 files**.

Meaningful automated coverage includes Request conversion, all route modes and conditional fields, human reviewer authorization, send-back/rejection, locked revisions, supplier isolation, generic-query bypass prevention, negotiation upload provenance, real PDF bytes and two signatures, activation, monitoring, amendment/renewal provenance, termination and financial closure. Existing Legal signing tests pass alongside the CLM signature tests.

The full post-change run recorded **1,768 passing tests and four pre-existing failures** in `src/api/approvalWorkflow.test.ts`. Those four failures were also present before CLM and were left untouched. The three navigation expectations affected by the additive Contract Lifecycle entry were updated while preserving all previous entries. The earlier baseline's Sidebar import timeout did not recur.

Read-only live checks verified all ten DocType adapters, the role-holder query, Supplier Onboarding notification mapping, and the Purchase Invoice/PO child-table query. They made no business-record changes.

Pending live acceptance: sign in, configure an approved matrix, then exercise a genuine Request → validation → Contract → review → supplier negotiation/signature → Inteva signature → Active record and its operational/closure paths. Live business approvals and legally binding signatures must be performed by the responsible users.
