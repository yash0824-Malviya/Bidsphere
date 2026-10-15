# ECR, Business Case and RFQ workflow

## Policy

New ECRs created through `/api/ecr-create` carry `ecr_workflow_version = extended_v1`. This is the established version value; do not introduce a second version field or rename it to `extended`. Existing records with a missing, null, blank or `legacy` version retain the five-stage workflow: **Draft → Engineering Review → Procurement Review → RFQ Pending → RFQ**. No historical ECRs are migrated automatically.

1. The owner Engineer submits the ECR for Engineering Manager technical approval.
2. Technical approval opens Business Case preparation for the same owner.
3. Submission starts Finance review when `cost_impact = 1`, then Procurement review for every case, then Quality review when `quality_impact = 1`. Omitted reviews show **Not Required**.
4. All required approvals produce **Business Case Approved**. The Program Manager starts and completes the final ECR review.
5. After **ECR Approved**, Procurement records **RFQ Required: Yes/No** and a reason. Yes opens **Procurement Decision**, where the existing RFQ bridge is available. No closes the ECR without an RFQ.

Procurement can record preliminary sourcing advice during Business Case approval. The final decision is made after ECR approval. RFQ creation retains the existing supplier, item, plant, quantity, backlink and idempotency validations. If approved source data needs correction, Procurement uses **Request Sourcing Revision** to return to Draft; technical, Business Case and final approvals run again.

Send-back preserves the justification, costs, impacts, risks and documents. Resubmission resets all required reviewer decisions and keeps previous decisions in history. Rejection retains the record and reason.

## Storage and authorization

The ECR-linked Business Case has its own typed model and identifier (`BC-<ECR identifier>`), separate from the Business Intake module. Its canonical document is JSON in the parent ECR's `ecr_business_case` field. Saving the parent commits Business Case content, approval rows, audit history and ECR state in one ERP transaction. This avoids a partially approved pair of independently saved documents.

The dedicated `/api/ecr-business-case` GET/POST endpoint validates authenticated roles, Engineer ownership, the current stage, pending approval task and the browser's `expected_modified` revision. The server calculates annual savings, ROI and payback; undefined ratios return null. Reviewers cannot edit the owner's financial or justification fields. Generic ERP writes cannot update the workflow version, Business Case, RFQ decision or approval metadata.

Supporting documents use existing private ECR uploads and file authorization. Finance, Quality and Program Manager can read those files. Suppliers cannot read ECRs, Business Cases or their attachments. Business Case JSON and attachments are not copied into supplier-facing RFQ payloads.

Approval history is durable in the ECR. In-app alerts use the existing notification store; the header also checks persisted assigned ECR stages every minute while the app is active, so another reviewer's browser discovers new assignments. Each refresh fetches up to 200 recent assigned ECRs. Notification read state remains browser-local; this does not add email delivery.

## ERP setup and deployment

The new application must be deployed with the additive ERP schema. A deployment with missing fields fails the trusted create preflight rather than silently creating a legacy ECR.

### Repair missing ECR query fields

For `Field not permitted in query: ecr_workflow_version`, use the schema-only repair:

```powershell
node scripts/repair-ecr-data-schema.mjs --check
node scripts/repair-ecr-data-schema.mjs --apply
node scripts/repair-ecr-data-schema.mjs --check
node scripts/verify-ecr-data-queries.mjs
```

The repair adds the existing four optional native ECR fields: `ecr_workflow_version` (Data), `ecr_business_case` (Long Text), `rfq_required` (Select) and `rfq_decision_reason` (Small Text). Native definitions also satisfy the trusted create endpoint's schema preflight. The version has no default, and only trusted new-ECR creation assigns `extended_v1`. Queries retain the discriminator so legacy and extended records remain distinguishable. The baseline `setup-ecr-doctype.mjs` uses the same field definitions for future installations.

The repair retains existing stored status options and appends missing permitted values, including legacy **RFQ Pending** and the existing extended states. It does not change Workflow transitions, activation, roles, permission settings, naming or ECR content. It refuses incompatible field types and duplicate Custom Fields or alternate version fields rather than creating a competing definition. Before applying, it saves the original schema and workflow configuration plus record metadata and content fingerprints under `scratch/ecr-schema-repair-<timestamp>/`; after applying, it verifies preservation and tests the version query. Full ECR business content is not written to these verification files.

The schema repair was applied to the configured ERP on 2026-09-15. The version query passed; all **10 existing ECRs** retained their content, statuses, timestamps and null legacy versions. All **3 Workflow documents** and ECR permission settings remained unchanged. Reapplying the repair required no changes. The existing ECR Workflow remains inactive; the repair neither requires nor activates it.

The read-only query verifier extracts the actual application field lists from source. Live verification passed the dashboard/list projection (33 fields), detail projection (63 fields) and security snapshots for all 10 ECRs, notification filters for all six configured roles, and existing RFQ list/detail reads (86 RFQs). No production ECRs or RFQs were created for verification.

### Provision extended Workflow configuration

The following workflow installer is a separate deployment operation. It edits ERP Workflow definitions and must not be used for the missing-field repair above.

1. Back up the current ECR DocType and Workflow configuration using the normal ERP administration process.
2. Confirm the existing ECR installation is complete: DocTypes, naming series, procurement references, read-only human permissions, and a single active workflow using the exclusive `BidSphere ECR Workflow Service` role. On a fresh installation, follow the existing setup scripts before the extension.
3. Run the read-only preflight:

   ```powershell
   node scripts/setup-ecr-extended-workflow.mjs --check
   ```

4. Review and apply the additive setup in the target environment:

   ```powershell
   node scripts/setup-ecr-extended-workflow.mjs --apply
   node scripts/setup-ecr-extended-workflow.mjs --check
   ```

5. Deploy the application and exercise the checks below with designated test accounts.

The script adds four protected ECR fields, extends select options and merges service-only transitions into the existing workflow. It changes no ECR records and supplies no version default. It refuses incompatible existing submitted review states and human-editable workflows. The old workflow reconciliation script refuses to run after extended schema installation, protecting completed review history.

The production endpoint and Vite development server use the same Business Case handler. The available ERP has **zero active ECR workflows**; this was preserved during the schema repair. The workflow installer's secured baseline prerequisite must be resolved before separately provisioning its transitions. Application workflow and Business Case handlers continue using the existing trusted APIs.

## Validation

### Persistence verification recovery (2026-09-15)

ECR-2026-100010 had already committed **Engineering Review** with one Pending **Engineering Manager** approval when its API response reported a persistence error. The first mismatched field was `ecr_business_case`: absent from the GET/submitted document, `null` in the `frappe.client.save` response, and absent again on re-fetch. `rfq_decision_reason` had the same empty-value representation difference. `ecr_workflow_version = extended_v1`, impact flags, supplier data and the approval task were persisted correctly. The existing record was re-saved in its actual Engineering Review state and verified; no transition was replayed and it was not reset or recreated.

The workflow verifier now treats only missing, null and empty text as equivalent. Populated values still require an exact match, and a real mismatch identifies its field. No additional schema fields or migration were needed. Business Case linkage and review decisions are empty until those later stages occur: Finance, Procurement and Quality decisions belong to the existing `ecr_business_case` JSON; final ECR approval uses the existing Program Manager approval child row.

Detail/create/edit flows now refresh ECR detail, history, lists, role dashboards, badges and notification queries after a workflow response, including failures that may arrive after a commit. Failed create/edit submission re-reads the already saved ECR rather than replaying the transition.

Live verification confirmed the Engineering dashboard contains this ECR as its one pending review, and it is absent from Draft results. All 11 ECR list/detail/security projections, six notification role queries and existing RFQ reads passed. **573 focused regression tests across 65 files and the production build passed.** Legacy ECR and RFQ workflow definitions and RBAC were unchanged. The existing approval-history task was verified; the failed attempt had not written its optional Activity comment, and a separate recovery comment was not added after automatic approval review rejected that extra live-record mutation.

### Business Case approval-status correction (2026-09-15)

The live `ECR Approval.status` Select permits only `Pending`, `Approved`, `Rejected` and `Sent Back`. Business Case submission was passing a non-review transition to the shared task builder, which converted the owner's pending preparation task to `Completed`. ERPNext rejected that child row before saving the Business Case.

Extended non-review actions now retire the preparation task or retain the same-role pending task without inventing a reviewer decision. Business Case submission remains recorded in its atomic JSON history and is displayed as **Business Case Submitted** in Approval History. Actual reviewer actions continue to persist the supported approval statuses. The existing legacy/RFQ task handling is preserved; no schema options, roles or general Business Intake behavior changed.

Required Finance and Quality review states initialize to `Pending`; disabled reviews retain the existing `Not Required` sentinel in the Business Case JSON. Procurement always initializes to `Pending`. Only the current stage receives an actionable child task, following the existing Finance → Procurement → Quality sequence. Successful Business Case actions refresh all ECR dashboard, badge, notification, list, detail and history queries, including internal/display-ID aliases.

Live readback of **ECR-2026-100010** confirmed **Technical Approved**, its existing Engineering Manager approval and the owner's pending preparation task. `ecr_business_case` is empty. The previously entered form was closed without a persisted draft, so submission of this specific record requires the owner to re-enter and save the intended Business Case content. The ECR has not been reset or recreated, and no replacement Business Case content was fabricated.

The regression suite applies the live four-value child-row schema to every simulated ERP save. Coverage includes all impact combinations, persisted save/submit/re-fetch, all reviewer outcomes, send-back/resubmission history, conditional skips and overall approval only after every required review is approved. **638 targeted tests across 67 files and the production build passed**, including existing Business Intake, legacy ECR and RFQ regression coverage.

### Finance actions on ECR detail (2026-09-15)

The Finance assignment was correct, but ECR detail rendered only the generic ECR approval panel. That panel intentionally excludes Business Case review stages because those decisions require the dedicated Business Case endpoint. The detail page and full Business Case page now share `ECRBusinessCaseReviewPanel`, which posts `approve`, `send_back` or `reject` to `/api/ecr-business-case` with the opened revision, reviewer role and comment. The generic workflow bypass remains disabled.

The shared permission check requires an extended draft ECR, matching Business Case reference and stage, the reviewer's `Pending` status and exactly one required current task. Only `finance` can review Finance. The detail panel shows persisted unit costs, implementation and other costs, annual volume, savings, ROI, payback, budget/revenue impacts and risks. Finance approval revalidates the existing saved numeric inputs, budget impact and financial risk without rewriting them. Invalid content can still be sent back or rejected. Comments remain optional for approval and required for Send Back/Reject.

Finance approval persists `Approved` and advances to the existing **Procurement BC Review** stage. Quality follows Procurement when required. Send Back preserves the entered information and returns to **Technical Approved** for the Engineer; rejection preserves the record and stops the workflow. Existing audit, notifications, revision checks and cache refresh are retained. No schema options, roles, legacy ECR, RFQ or general Business Intake workflows changed for this fix.

Live verification in the signed-in Finance Manager session confirmed **ECR-2026-100010** at **Finance Review** with **Approve Business Case** visible and enabled on both pages. Send Back and Reject enabled when a comment was entered; the temporary comment was cleared without submitting a decision. The Finance dashboard showed one pending ECR financial review. Approval requests, persisted outcomes, history, role restrictions and next-reviewer notifications are covered by automated tests; no live Finance decision was made for verification. **725 targeted tests across 70 files and the production build passed.**

### Final decision rationale mapping (2026-09-15)

The final-stage UI configuration returned no assessment fields, while the existing backend required `reviewFields["Final Decision Rationale"]`. The panel also validated only the generic `Approve` action, omitting `Approve ECR`. Native and Custom Field inspection confirmed there is no `final_decision_rationale` ERP field; the existing audit stores labeled assessment values and Review Comments in `ECR Approval.comments`.

The Final ECR Approval panel now displays a dedicated **Final Decision Rationale \*** textarea and the requested helper text, separately from **Review Comments**. The API contract is preserved: rationale uses `reviewFields["Final Decision Rationale"]` (maximum 2,000 characters), while Review Comments use `comment` (maximum 4,000 characters). No duplicate fields, schema migration or API renaming was introduced, and comments are never an implicit rationale fallback.

Approve ECR and Reject require the dedicated rationale in both UI and backend validation. Reject and Send Back retain their existing Review Comments requirement. Send Back's rationale remains optional. All final outcomes retain any supplied rationale and comments with separate labels in the immutable approval row and Activity entry, along with decision, approver and timestamp. Approval advances to **ECR Approved** and creates the existing **Procurement Manager** task to record the Procurement Decision. Existing notification routing covers that assignment.

The live Program Manager preview for **ECR-2026-100010** displays the new required field and keeps Approve ECR/Reject disabled when it is empty. **762 targeted tests across 73 files and the production build passed**, including payload mapping, validation without comment substitution, persistence/re-fetch, audit metadata, next assignments, Send Back/Reject and legacy behavior.

Automated coverage includes conditional reviews, sequential role authorization, missing and stale revisions, calculated values, immutable review content, send-back and resubmission history, final approval gating, Yes/No sourcing, RFQ bypass prevention, legacy workflow behavior, navigation, role-specific form rendering, private attachments, notifications and schema merge idempotency.

Run the suite with `npm test`. Run the production build with `npm run build`.

Initial implementation verification: TypeScript and the production build passed. The full suite completed with **1,136 passing tests and 4 failures**, all four in the existing `src/api/approvalWorkflow.test.ts` RFQ approval tests. That RFQ workflow implementation was preserved. All new ECR workflow, Business Case, role, attachment, notification and schema merge tests passed. The subsequent schema repair verifies live read queries and preservation without creating production ECRs or RFQs for testing. Full live approval write sequences remain deployment acceptance checks.

Schema repair regression run: **514 tests passed across 61 files**, covering ECR creation, list/detail, dashboards, workflow version compatibility, Business Case actions, RFQ creation/workflow, and schema preservation. Missing, undefined, null, blank and explicit `legacy` versions all retain the five-stage policy in both frontend and backend; `extended_v1` retains the extended policy. TypeScript and the production build passed after the repair.

Live acceptance checks after setup:

- Engineer creates, submits and edits only their own ECR/Business Case; an unrelated Engineer and a supplier are denied.
- Engineering Manager approves technical review; owner prepares and submits the Business Case.
- Both impact-flag combinations route correctly; all three reviewers can approve/send back/reject only their assigned stage.
- Resubmission preserves entered data and starts fresh approvals while retaining history.
- Program Manager sees the approved Business Case and completes final ECR approval.
- Procurement records No and closes without RFQ; records Yes and creates one linked RFQ; retries do not duplicate it.
- A sourcing revision returns to Draft and reruns all approvals.
- Existing legacy ECRs and the existing RFQ → Legal/e-signature → Finance → PO flow retain their current behavior.
