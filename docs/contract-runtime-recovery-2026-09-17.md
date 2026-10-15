# New Contract runtime recovery

## Cause and evidence

The reported `/contracts/new` failure was a development runtime conflict, not a
missing Contract context provider or incompatible installed React version.

Two app Vite servers were listening on the same port:

| Listener | Process | React URL version |
| --- | --- | --- |
| IPv4 `0.0.0.0:5175` | 20384 | `2add6156` |
| IPv6 `[::1]:5175` | 23912 | `730147ea` |

Both used `node_modules/.vite/bidsphere`. The second server had been started with
a localhost host override while the original wildcard listener was still
running. Their dependency graphs and the shared optimized files disagreed; the
IPv4 server rejected a dependency URL emitted by the IPv6 server with HTTP 504
`Outdated Optimize Dep`. Mixing React modules from different optimization runs
can leave a hook's React dispatcher unset, producing the reported null
`useContext` error when the lazy route renders.

The original error's browser stack was not available in the accessible browser
session. The runtime conflict above was observed directly; no source line is
being inferred from the error reference alone.

`npm ls react react-dom` confirmed one deduplicated installation, with both
packages at 19.2.6. The page is correctly wrapped by QueryClientProvider and
BrowserRouter. The route has a valid default lazy export, no invalid direct
component calls, no new import cycles, and no hook-rule violations.

## Repair

Stopped the two verified BidSphere Vite processes, then ran the existing
`npm run dev:clean` command once. This rebuilt the optimizer cache and restored
one app listener on port 5175 with normal ERPNext connectivity.

No production components, API contracts, authentication, schema, permissions,
supplier behavior, workflow logic, or installed package versions were changed.
The five-stage form remains intact.

To avoid recurrence, reuse the running app server. Do not start another app
server with a host override to get around an occupied port. Stop the existing
instance before a clean restart. Isolated UI/SSR diagnostic servers must use
their own port and cache directory.

## Verification

- Exactly one app listener remains on port 5175.
- Actual emitted React, ReactDOM, Router, Query, and JSX dependency URLs return
  HTTP 200 and converge on the same `react.js?v=4a1464d0` runtime. Different
  per-entry version hashes are normal; React identity must be shared.
- Signed in as Procurement Manager and opened the real `/contracts/new` route.
- Loaded an existing Supplier Quotation through the existing prefill service.
- Traversed all five stages with unsaved verification input; checked required
  fields, Back/Edit navigation, retained source and form values, and final review.
- Cleared only the unsaved verification form and confirmed the route renders
  again. The final browser error log is empty.
- Added `ContractCreatePage.providers.test.tsx`: three tests use real React,
  ReactDOM, Router, and Query providers, without mocking their hooks.
- 187 focused regression tests pass, including existing save/update/submission
  and failed-submission retry coverage. Production build passes with the existing
  chunk-size warning.

No live Contract was saved, submitted, or sent to another reviewer during the
runtime verification. Save and submission behavior were exercised by the
regression tests; their production implementation was unchanged.
