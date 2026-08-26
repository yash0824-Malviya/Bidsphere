function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toUpperCase();
}

function workflowToken(value) {
  return normalized(value)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function canonicalEcrApprovalRole(value) {
  const role = workflowToken(value);
  if ([
    "ENGINEERING MANAGER",
    "ENGINEERING MANAGER APPROVAL",
    "ENGINEERING MANAGER REVIEW",
    "ENGINEERING",
  ].includes(role)) return "Engineering Manager";
  if ([
    "PROCUREMENT TEAM",
    "PROCUREMENT TEAM APPROVAL",
    "PROCUREMENT TEAM REVIEW",
    "PROCUREMENT USER",
    "PURCHASE USER",
  ].includes(role)) return "Procurement Team";
  if ([
    "PROCUREMENT MANAGER",
    "PROCUREMENT MANAGER APPROVAL",
    "PROCUREMENT MANAGER REVIEW",
    "PURCHASE MANAGER",
    "PROCUREMENT",
  ].includes(role)) return "Procurement Manager";
  return clean(value);
}

/**
 * Resolve a persisted legacy ECR into the sequential demo. A linked RFQ is
 * authoritative. RFQ Pending is trusted only when persisted history proves
 * Procurement Team approval; otherwise post-engineering records return to
 * Procurement Review so a downstream task is never created prematurely.
 */
export function reconciledEcrWorkflowState(row) {
  const state = workflowToken(row?.select_pxfp);
  // Preserve legacy returned records because ordinary REST reconciliation
  // cannot safely unsubmit docstatus 1 -> 0. New Send Back actions use Draft.
  if (["SENT BACK", "NEEDS REVISION"].includes(state)) return "Sent Back";
  if (state === "CLOSED") return "Closed";
  if (state === "REJECTED") return "Rejected";
  if (state === "CANCELLED") return "Cancelled";

  if (clean(row?.rfq)) return "RFQ";
  if (!state || state === "DRAFT") return "Draft";
  const procurementTeamApproved = (Array.isArray(row?.approval_requirements)
    ? row.approval_requirements
    : []).some((task) =>
      canonicalEcrApprovalRole(task?.approval_role) === "Procurement Team" &&
      ["APPROVED", "COMPLETED"].includes(normalized(task?.status))
    );
  if (["RFQ PENDING", "PROCUREMENT MANAGER", "RFQ CREATED"].includes(state)) {
    return procurementTeamApproved ? "RFQ Pending" : "Procurement Review";
  }
  if ([
    "ENGINEERING REVIEW",
    "ENGINEERING MANAGER APPROVAL",
    "ENGINEERING MANAGER REVIEW",
    "EM APPROVAL",
    "SUBMITTED",
    "UNDER REVIEW",
  ].includes(state)) {
    return "Engineering Review";
  }
  if ([
    "APPROVED",
    "ECR APPROVED",
    "OPERATIONS REVIEW",
    "QUALITY REVIEW",
    "PROGRAM REVIEW",
    "CROSS FUNCTIONAL REVIEW",
    "PROCUREMENT",
    "PROCUREMENT REVIEW",
    "PROCUREMENT TEAM",
    "PROCUREMENT TEAM REVIEW",
    "PURCHASE REQUISITION",
    "REQUISITION CREATION",
    "RFQ",
    "SUPPLIER RESPONSE",
    "SUPPLIER EVALUATION",
    "SUPPLIER SELECTION",
    "SUPPLIER SELECTED",
    "IMPLEMENTATION",
    "VALIDATION",
  ].includes(state)) {
    return "Procurement Review";
  }
  throw new Error(`Unsupported ECR workflow state '${clean(row?.select_pxfp) || "(blank)"}'.`);
}

const APPROVAL_ROLE_BY_STATE = Object.freeze({
  "Engineering Review": "Engineering Manager",
  "Procurement Review": "Procurement Team",
  "RFQ Pending": "Procurement Manager",
});

/** Canonicalize persisted task ownership and retain exactly one active stage task. */
export function reconcileApprovalTasks(
  doc,
  targetState = reconciledEcrWorkflowState(doc),
) {
  const rows = Array.isArray(doc?.approval_requirements)
    ? doc.approval_requirements
    : [];
  const expectedRole = APPROVAL_ROLE_BY_STATE[targetState];
  const isPending = (row) => normalized(row?.status) === "PENDING";
  const completed = rows
    .filter((row) => !isPending(row))
    .map((row) => ({
      ...row,
      approval_role: canonicalEcrApprovalRole(row?.approval_role),
    }));
  if (!expectedRole) return completed;

  const existing = rows.find(
    (row) =>
      isPending(row) &&
      canonicalEcrApprovalRole(row?.approval_role) === expectedRole,
  );
  return [
    ...completed,
    {
      ...(existing ?? {}),
      doctype: clean(existing?.doctype) || "ECR Approval",
      department: clean(existing?.department) || clean(doc?.requesting_department),
      approval_role: expectedRole,
      approver: clean(existing?.approver),
      required: 1,
      status: "Pending",
      approval_date: "",
      comments: "",
    },
  ];
}

/**
 * Ordinary Frappe resource saves still validate active workflow transitions.
 * Refuse non-adjacent legacy rewrites while any ECR workflow is active so the
 * migration cannot partially mutate records and then strand them.
 */
export function assertEcrStateReconciliationIsSafe(rows, activeWorkflowNames = []) {
  const active = [...new Set(
    (Array.isArray(activeWorkflowNames) ? activeWorkflowNames : [])
      .map(clean)
      .filter(Boolean),
  )];
  if (active.length === 0) return;
  const changes = (Array.isArray(rows) ? rows : []).filter(
    (row) => clean(row?.select_pxfp) !== reconciledEcrWorkflowState(row),
  );
  if (changes.length === 0) return;
  throw new Error(
    `Legacy ECR state reconciliation cannot run while active workflow(s) ${active.join(", ")} ` +
    `validate state changes. Deactivate those ECR workflows, then rerun this setup; ` +
    `no ECR records have been changed. Pending tasks and legacy states will be reconciled ` +
    `before the sequential workflow is activated.`,
  );
}

const TARGET_DOCSTATUS_BY_STATE = Object.freeze({
  Draft: 0,
  "Engineering Review": 0,
  "Procurement Review": 0,
  "RFQ Pending": 0,
  RFQ: 1,
  Rejected: 0,
  // Historical records remain non-actionable and keep their original
  // lifecycle because ordinary REST cannot safely unsubmit/cancel them.
  "Sent Back": 1,
  Closed: 1,
  Cancelled: 2,
});

export function expectedEcrWorkflowDocstatus(
  row,
  targetState = reconciledEcrWorkflowState(row),
) {
  // The workflow installer is intentionally stricter than the runtime
  // compatibility bridge. Frappe workflow states have one docstatus each, so
  // activating the draft-state workflow over a submitted legacy review row
  // would strand that row on its next transition. A trusted bench patch must
  // canonicalize legacy submitted records before installation.
  return TARGET_DOCSTATUS_BY_STATE[targetState];
}

/**
 * Frappe rejects submitted -> draft and draft -> cancelled workflow changes.
 * Fail before metadata or records are mutated when legacy data needs a
 * trusted server-side docstatus patch.
 */
export function validateEcrDocstatusReconciliation(rows) {
  const problems = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const targetState = reconciledEcrWorkflowState(row);
    const expected = expectedEcrWorkflowDocstatus(row, targetState);
    if (expected === undefined || Number(row?.docstatus) === expected) continue;
    problems.push(
      `${clean(row?.name) || "(unnamed ECR)"} is docstatus ${Number(row?.docstatus)} ` +
      `but ${targetState} requires ${expected}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `ECR docstatus migration preflight failed: ${problems.join("; ")}. ` +
      "Frappe cannot convert submitted review records back to draft through an ordinary save. " +
      "Apply a reviewed, trusted server-side data patch before rerunning this migration; no ECR records have been changed.",
    );
  }
}

export function isReservedNewEcrNumber(value) {
  const match = normalized(value).match(/^ECR-\d{4}-(\d{6})$/);
  if (!match) return false;
  const sequence = Number(match[1]);
  // `ECR-.YYYY.-1.#####` starts at 100001. The legacy formatter can rarely
  // produce 100000, which remains outside the new ERP naming-series band.
  return sequence >= 100001 && sequence <= 199999;
}

export function maxNewEcrSeriesCounter(rows, year) {
  const normalizedYear = String(year ?? "").trim();
  if (!/^\d{4}$/.test(normalizedYear)) {
    throw new Error(`Invalid ECR naming-series year '${normalizedYear}'.`);
  }
  const matcher = new RegExp(`^ECR-${normalizedYear}-1(\\d{5})$`, "i");
  let maximum = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = clean(row?.name).match(matcher);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum;
}

/** Cancelled documents cannot be updated through Frappe's ordinary REST save. */
export function validateCancelledEcrReconciliation(rows) {
  const problems = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (Number(row?.docstatus || 0) !== 2) continue;
    const name = clean(row?.name) || "(unnamed ECR)";
    if (!clean(row?.ecr_number)) problems.push(`${name} has no business number`);
    const pending = (Array.isArray(row?.approval_requirements)
      ? row.approval_requirements
      : []).filter((task) => normalized(task?.status) === "PENDING");
    if (pending.length > 0) problems.push(`${name} has ${pending.length} stale pending approval task(s)`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Cancelled ECR migration preflight failed: ${problems.join("; ")}. ` +
      "Frappe does not allow REST edits to cancelled documents; apply a reviewed, trusted server-side data patch before rerunning this migration.",
    );
  }
}

/** Keep byte-for-byte parity with the client formatter for legacy opaque IDs. */
export function stableLegacyEcrNumber(name) {
  let hash = 0;
  for (const char of clean(name)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const sequence = String((Math.abs(hash) % 90000) + 10001).padStart(5, "0");
  return `ECR-2026-${sequence}`;
}

export function reserveUniqueEcrNumber(name, usedNumbers) {
  const canonicalName = normalized(name);
  if (/^ECR-\d{4}-\d{5,}$/.test(canonicalName) && !usedNumbers.has(canonicalName)) {
    usedNumbers.add(canonicalName);
    return canonicalName;
  }

  const preferred = stableLegacyEcrNumber(name);
  if (!usedNumbers.has(preferred) && !isReservedNewEcrNumber(preferred)) {
    usedNumbers.add(preferred);
    return preferred;
  }

  const prefix = "ECR-2026-";
  let sequence = Number(preferred.slice(prefix.length));
  for (let attempt = 0; attempt < 90000; attempt += 1) {
    sequence = sequence >= 100000 ? 10001 : sequence + 1;
    const candidate = `${prefix}${String(sequence).padStart(5, "0")}`;
    if (!usedNumbers.has(candidate)) {
      usedNumbers.add(candidate);
      return candidate;
    }
  }
  throw new Error("Unable to allocate a unique ECR business number.");
}

/**
 * Fail closed before activating a workflow that cannot represent persisted
 * records or whose public-number routing would be ambiguous.
 */
export function validateExistingEcrRows(rows, allowedStates, expectedDocstatusByState = {}) {
  const records = Array.isArray(rows) ? rows : [];
  const allowed = new Set([...allowedStates].map(normalized));
  const expectedDocstatuses = new Map(
    Object.entries(expectedDocstatusByState).map(([state, docstatus]) => [
      normalized(state),
      Number(docstatus),
    ]),
  );
  const names = new Map();
  const numbers = new Map();
  const problems = [];

  for (const row of records) {
    const name = clean(row?.name);
    const state = clean(row?.select_pxfp);
    const number = clean(row?.ecr_number);
    if (!name) {
      problems.push("an ECR row has no document name");
      continue;
    }
    names.set(normalized(name), name);
    let reconciledState = "";
    try {
      reconciledState = reconciledEcrWorkflowState(row);
    } catch {
      // Preserve the consolidated preflight message below.
    }
    const stateKey = normalized(reconciledState);
    if (!state || !reconciledState || !allowed.has(stateKey)) {
      problems.push(`${name} has unsupported workflow state '${state || "(blank)"}'`);
    } else if (expectedDocstatuses.has(stateKey)) {
      const expectedDocstatus = expectedDocstatuses.get(stateKey);
      if (Number(row?.docstatus) !== expectedDocstatus) {
        problems.push(
          `${name} has docstatus ${Number(row?.docstatus)} but ${reconciledState} requires ${expectedDocstatus}`,
        );
      }
    }
    if (number) {
      const key = normalized(number);
      const prior = numbers.get(key);
      if (prior && prior !== name) {
        problems.push(`business number ${number} is duplicated by ${prior} and ${name}`);
      } else {
        numbers.set(key, name);
      }
      if (isReservedNewEcrNumber(number) && !isReservedNewEcrNumber(name)) {
        problems.push(`${name} uses reserved new-series business number ${number}`);
      }
    }
  }

  for (const [number, ownerName] of numbers) {
    const collidingName = names.get(number);
    if (collidingName && collidingName !== ownerName) {
      problems.push(
        `${ownerName}'s business number collides with document name ${collidingName}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Existing ECR migration preflight failed: ${[...new Set(problems)].join("; ")}. ` +
      "Resolve these records before activating the sequential workflow.",
    );
  }
}
