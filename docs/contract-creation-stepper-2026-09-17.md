# New Contract creation: five-stage form

## Scope

The existing New Contract route now displays Source & Parties, Contract Details,
Commercial Terms, Performance & Compliance, and Documents & Review. Contract
Request creation continues to use its existing form.

The change is confined to frontend form components and tests. No backend,
DocType, migration, authentication, role, permission, or workflow changes are
needed for this redesign.

## Preserved behavior

- All 45 previously displayed editable Contract fields remain available. The
  grouping helper retains unknown metadata fields instead of dropping them.
- One form state retains entries and source selections between stages.
- Source loading and template loading use the existing prefill endpoint.
- Next checks only the current stage. Final submission checks all fields against
  the existing required-field contract; backend validation remains authoritative.
- Save Draft sends the current server-allowed payload to the existing save
  action. Existing backend draft requirements still apply. No placeholder values
  or partial-save backend exceptions are introduced.
- After the first save, subsequent saves update the same name and revision.
  Failed submission preserves the saved draft identity, avoiding duplicate
  creation on retry.
- Uploads become available after a draft exists and continue using the existing
  private upload helper. Navigation, save, and submit wait for upload completion.
- Template-supplied child rows remain in the permitted save payload and review.
- Renewal notice values remain available and survive toggling Auto Renewal.
- Review sections provide key-value previews, expandable complete information,
  and Edit actions. Normal textareas use compact, resizable controls.

## Verification

- 192 focused tests pass across Contract UI, frontend API, backend core,
  endpoint, and gateway authorization coverage.
- Production TypeScript/Vite build passes.
- Browser checks use the real wizard and field components with isolated,
  in-memory service replacements under `scratch/contract-wizard-preview`.
  There are no ERPNext writes from that fixture.
- Checked source/template loading, inline validation, Back/Next retention,
  completed-stage editing, renewal value retention, draft save, review summary,
  upload control availability, and failed submission followed by successful
  retry using the same draft.
- Checked desktop (1440px), tablet (768px), and mobile (390px and 320px) layouts.
  Document scroll width matched viewport content width; mobile fields stacked
  into one column. The tested browser session reported no console warnings or
  errors.

Live ERPNext contract creation/submission was not performed for this UI-only
change. The application shell, sidebar, and global header were not modified.
