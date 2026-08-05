import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Calendar,
  ClipboardList,
  DollarSign,
  FileText,
  GitBranch,
  Info,
  Loader2,
  Save,
  Send,
  Wallet,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  createBudget,
  fetchBudgetNamingSeries,
  fetchCompanies,
  fetchCompanyCurrency,
  fetchCostCenters,
  fetchExpenseAccounts,
  fetchFiscalYears,
  fetchMonthlyDistributions,
  fetchProjects,
  findDuplicateBudget,
  submitBudget,
  type BudgetAgainst,
  type BudgetListItem,
} from "../../api/budget";
import { triggerBudgetSubmitted } from "../../api/notifications";
import { COMPANY } from "../../api/erpnext";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatDateTime } from "../../utils/format";
import { sanitizeFrappeError } from "../../utils/friendlyError";

interface FormErrors {
  company?: string;
  fiscalYear?: string;
  budgetAgainst?: string;
  costCenter?: string;
  project?: string;
  account?: string;
  amount?: string;
}

/** True when a backend failure is ERPNext's duplicate-budget validation. */
function isDuplicateBudgetError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /another budget|overlapping fiscal|duplicate budget/i.test(raw);
}

function formatMoney(amount: number, currency: string): string {
  if (Number.isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function BudgetCreatePage() {
  const layout = useOptionalLayout();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const createdBy = user?.full_name ?? user?.email ?? user?.name ?? "—";

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: companies = [], isLoading: companiesLoading } = useQuery({
    queryKey: ["budget-companies"],
    queryFn: fetchCompanies,
    staleTime: 60_000,
  });

  const { data: namingSeries = "", isLoading: seriesLoading } = useQuery({
    queryKey: ["budget-naming-series"],
    queryFn: fetchBudgetNamingSeries,
    staleTime: 300_000,
  });

  const { data: fiscalYears = [], isLoading: fiscalYearsLoading } = useQuery({
    queryKey: ["fiscal-years"],
    queryFn: fetchFiscalYears,
    staleTime: 60_000,
  });

  const { data: monthlyDistributions = [] } = useQuery({
    queryKey: ["monthly-distributions"],
    queryFn: fetchMonthlyDistributions,
    staleTime: 120_000,
  });

  const [company, setCompany] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [budgetAgainst, setBudgetAgainst] = useState<BudgetAgainst>("Cost Center");
  const [costCenter, setCostCenter] = useState("");
  const [project, setProject] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [monthlyDistribution, setMonthlyDistribution] = useState("");
  const [remarks, setRemarks] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [duplicateBudget, setDuplicateBudget] = useState<BudgetListItem | null>(null);

  useEffect(() => {
    if (company) return;
    const defaultCompany =
      companies.find((c) => c.name === COMPANY)?.name ?? companies[0]?.name ?? COMPANY;
    if (defaultCompany) setCompany(defaultCompany);
  }, [companies, company]);

  const { data: costCenters = [], isLoading: costCentersLoading } = useQuery({
    queryKey: ["cost-centers", company],
    queryFn: () => fetchCostCenters(company),
    enabled: !!company,
    staleTime: 60_000,
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", company],
    queryFn: () => fetchProjects(company),
    enabled: !!company && budgetAgainst === "Project",
    staleTime: 60_000,
  });

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["expense-accounts", company],
    queryFn: () => fetchExpenseAccounts(company),
    enabled: !!company,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    fetchCompanyCurrency(company).then((c) => {
      if (!cancelled) setCurrency(c);
    });
    return () => {
      cancelled = true;
    };
  }, [company]);

  useEffect(() => {
    setCostCenter("");
    setProject("");
    setAccount("");
  }, [company]);

  // Prefill Cost Center / Fiscal Year when navigated here from the Finance
  // Review "Create Budget" action (runs once, after the company reset above).
  const [searchParams] = useSearchParams();
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (prefillApplied.current || !company) return;
    const ccParam = searchParams.get("costCenter");
    const fyParam = searchParams.get("fiscalYear");
    if (!ccParam && !fyParam) {
      prefillApplied.current = true;
      return;
    }
    if (ccParam && costCentersLoading) return; // wait for the list to resolve
    if (ccParam && costCenters.some((c) => c.name === ccParam)) {
      setCostCenter(ccParam);
    }
    if (fyParam && fiscalYears.includes(fyParam)) {
      setFiscalYear(fyParam);
    }
    prefillApplied.current = true;
  }, [company, searchParams, costCenters, costCentersLoading, fiscalYears]);

  useEffect(() => {
    if (budgetAgainst === "Cost Center") {
      setProject("");
    } else {
      setCostCenter("");
    }
  }, [budgetAgainst]);

  // Any change to the duplicate-defining fields clears a stale duplicate warning.
  useEffect(() => {
    setDuplicateBudget(null);
  }, [company, fiscalYear, budgetAgainst, costCenter, project, account]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  const budgetTargetLabel = useMemo(() => {
    if (budgetAgainst === "Project") {
      const match = projects.find((p) => p.name === project);
      return match?.project_name ?? (project || "—");
    }
    const match = costCenters.find((c) => c.name === costCenter);
    return match?.cost_center_name ?? (costCenter || "—");
  }, [budgetAgainst, project, projects, costCenter, costCenters]);

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!company.trim()) next.company = "Company is required.";
    if (!fiscalYear.trim()) next.fiscalYear = "Fiscal year is required.";
    if (!budgetAgainst) next.budgetAgainst = "Budget against is required.";
    if (budgetAgainst === "Cost Center" && !costCenter.trim()) {
      next.costCenter = "Cost center is required.";
    }
    if (budgetAgainst === "Project" && !project.trim()) {
      next.project = "Project is required.";
    }
    if (!account.trim()) next.account = "Expense account is required.";
    if (!amount.trim() || parsedAmount <= 0) {
      next.amount = "Enter a valid budget amount greater than zero.";
    }
    return next;
  }

  function buildPayload() {
    const payload = {
      company,
      budget_against: budgetAgainst,
      cost_center: budgetAgainst === "Cost Center" ? costCenter : undefined,
      project: budgetAgainst === "Project" ? project : undefined,
      fiscal_year: fiscalYear,
      account,
      budget_amount: parsedAmount,
      naming_series: namingSeries || undefined,
      monthly_distribution: monthlyDistribution || undefined,
      action_if_annual_budget_exceeded: "Stop",
      remarks: remarks.trim() || undefined,
    };
    // eslint-disable-next-line no-console
    console.log("[BudgetCreatePage] form payload", JSON.stringify(payload, null, 2));
    return payload;
  }

  const duplicateTargetWord = budgetAgainst === "Project" ? "Project" : "Cost Center";
  const duplicateMessage = `A budget already exists for this ${duplicateTargetWord}, Budget Account, and Fiscal Year. Please edit the existing budget or select a different ${duplicateTargetWord}, Account, or Fiscal Year.`;

  /** Look up an existing Budget that would collide with the current form. */
  function findDuplicate(): Promise<BudgetListItem | null> {
    return findDuplicateBudget({
      company,
      fiscalYear,
      account,
      costCenter: budgetAgainst === "Cost Center" ? costCenter : undefined,
      project: budgetAgainst === "Project" ? project : undefined,
    });
  }

  /**
   * Convert any create/submit failure into a user-safe outcome. The full
   * exception is logged (never shown); ERPNext duplicate errors are mapped to
   * the friendly message + "View Existing Budget" affordance.
   */
  function reportCreateError(err: unknown): void {
    if (isDuplicateBudgetError(err)) {
      // eslint-disable-next-line no-console
      console.error("[Budget create] duplicate rejected by ERPNext", err);
      toast.error(duplicateMessage);
      void findDuplicate().then((dup) => dup && setDuplicateBudget(dup));
      return;
    }
    const clean = sanitizeFrappeError(
      err,
      "Unable to create the budget. Please try again.",
      "Budget create"
    );
    toast.error(clean.message);
  }

  async function handleSaveDraft() {
    setShowValidation(true);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Please fix validation errors before saving.");
      return;
    }

    setDuplicateBudget(null);
    setSaving(true);
    try {
      const dup = await findDuplicate();
      if (dup) {
        setDuplicateBudget(dup);
        toast.error(duplicateMessage);
        return;
      }
      const created = await createBudget(buildPayload());
      toast.success("Budget draft saved successfully");
      navigate(`/budget/detail/${encodeURIComponent(created.name)}`);
    } catch (err) {
      reportCreateError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForApproval() {
    setShowValidation(true);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Please fix validation errors before submitting.");
      return;
    }

    setDuplicateBudget(null);
    setSubmitting(true);
    try {
      const dup = await findDuplicate();
      if (dup) {
        setDuplicateBudget(dup);
        toast.error(duplicateMessage);
        return;
      }
      const created = await createBudget(buildPayload());
      const submitted = await submitBudget(created.name);
      triggerBudgetSubmitted(
        submitted.name,
        parsedAmount,
        user?.email ?? user?.full_name
      );
      toast.success("Budget submitted for Finance Manager approval");
      navigate(`/budget/detail/${encodeURIComponent(submitted.name)}`);
    } catch (err) {
      reportCreateError(err);
    } finally {
      setSubmitting(false);
    }
  }

  const metaLoading =
    companiesLoading || seriesLoading || fiscalYearsLoading;
  const busy = saving || submitting;

  return (
    <div>
      <PageHeader
        title="Create Budget"
        description="Create a budget document for Finance Manager approval. All fields map directly to the standard budget form."
        actions={
          <Link
            to="/budget"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 no-underline"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main form */}
        <div className="space-y-4 lg:col-span-2">
          <SectionCard icon={FileText} title="Budget Information">
            {metaLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Budget Series"
                  required
                  hint="Auto-generated from the naming series when the document is saved."
                  error={undefined}
                  className="sm:col-span-2"
                >
                  <input
                    type="text"
                    readOnly
                    value={namingSeries || "Loading…"}
                    className={inputClass(true)}
                  />
                </FormField>

                <FormField
                  label="Company"
                  required
                  hint="Legal entity this budget applies to."
                  error={showValidation ? errors.company : undefined}
                >
                  <select
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    disabled={busy}
                    className={inputClass(false, !!errors.company && showValidation)}
                  >
                    <option value="">Select company</option>
                    {companies.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.company_name ?? c.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  label="Fiscal Year"
                  required
                  hint="Fiscal year for budget tracking."
                  error={showValidation ? errors.fiscalYear : undefined}
                >
                  <select
                    value={fiscalYear}
                    onChange={(e) => setFiscalYear(e.target.value)}
                    disabled={busy}
                    className={inputClass(false, !!errors.fiscalYear && showValidation)}
                  >
                    <option value="">Select fiscal year</option>
                    {fiscalYears.map((fy) => (
                      <option key={fy} value={fy}>
                        {fy}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  label="Budget Against"
                  required
                  hint="Allocate budget against a cost center or a project."
                  error={showValidation ? errors.budgetAgainst : undefined}
                  className="sm:col-span-2"
                >
                  <div className="flex flex-wrap gap-4 rounded-lg border border-neutral-200 bg-neutral-50/60 px-4 py-3">
                    <RadioOption
                      name="budget_against"
                      value="Cost Center"
                      checked={budgetAgainst === "Cost Center"}
                      onChange={() => setBudgetAgainst("Cost Center")}
                      label="Cost Center"
                      disabled={busy}
                    />
                    <RadioOption
                      name="budget_against"
                      value="Project"
                      checked={budgetAgainst === "Project"}
                      onChange={() => setBudgetAgainst("Project")}
                      label="Project"
                      disabled={busy}
                    />
                  </div>
                </FormField>

                {budgetAgainst === "Cost Center" ? (
                  <FormField
                    label="Cost Center"
                    required
                    hint="Department or unit receiving this budget allocation."
                    error={showValidation ? errors.costCenter : undefined}
                    className="sm:col-span-2"
                  >
                    {costCentersLoading ? (
                      <Skeleton className="h-10 rounded-lg" />
                    ) : (
                      <select
                        value={costCenter}
                        onChange={(e) => setCostCenter(e.target.value)}
                        disabled={busy || !company}
                        className={inputClass(false, !!errors.costCenter && showValidation)}
                      >
                        <option value="">Select cost center</option>
                        {costCenters.map((cc) => (
                          <option key={cc.name} value={cc.name}>
                            {cc.cost_center_name ?? cc.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                ) : (
                  <FormField
                    label="Project"
                    required
                    hint="Project that will consume this budget."
                    error={showValidation ? errors.project : undefined}
                    className="sm:col-span-2"
                  >
                    {projectsLoading ? (
                      <Skeleton className="h-10 rounded-lg" />
                    ) : (
                      <select
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                        disabled={busy || !company}
                        className={inputClass(false, !!errors.project && showValidation)}
                      >
                        <option value="">Select project</option>
                        {projects.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.project_name ?? p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={DollarSign} title="Financial Information">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Expense Account"
                required
                hint="GL expense account for budget monitoring."
                error={showValidation ? errors.account : undefined}
                className="sm:col-span-2"
              >
                {accountsLoading ? (
                  <Skeleton className="h-10 rounded-lg" />
                ) : (
                  <select
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    disabled={busy || !company}
                    className={inputClass(false, !!errors.account && showValidation)}
                  >
                    <option value="">Select expense account</option>
                    {accounts.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>

              <FormField
                label="Budget Amount"
                required
                hint={`Amount in ${currency} (company default currency).`}
                error={showValidation ? errors.amount : undefined}
              >
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">
                    {currency}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                    placeholder="0.00"
                    className={`${inputClass(false, !!errors.amount && showValidation)} pl-12`}
                  />
                </div>
              </FormField>

              <FormField
                label="Monthly Distribution"
                hint="Optional — spread budget across months using a distribution template."
              >
                <select
                  value={monthlyDistribution}
                  onChange={(e) => setMonthlyDistribution(e.target.value)}
                  disabled={busy}
                  className={inputClass(false)}
                >
                  <option value="">None (Annual)</option>
                  {monthlyDistributions.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Applicable On"
                hint="Annual budget enforcement when monthly distribution is not set."
                className="sm:col-span-2"
              >
                <input
                  type="text"
                  readOnly
                  value="Annual"
                  className={inputClass(true)}
                />
              </FormField>

              <FormField
                label="Remarks"
                hint="Stored as a comment on the budget document."
                className="sm:col-span-2"
              >
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  disabled={busy}
                  placeholder="Optional notes for the Finance Manager…"
                  className={`${inputClass(false)} resize-y min-h-[88px]`}
                />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard icon={GitBranch} title="Workflow Information">
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadOnlyField label="Workflow Status" value="Draft" />
              <ReadOnlyField label="Created By" value={createdBy} />
              <ReadOnlyField
                label="Created Date"
                value="—"
                hint="Set automatically when the budget is saved."
              />
              <ReadOnlyField
                label="Last Modified"
                value="—"
                hint="Updated on each save."
              />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <p className="text-xs text-blue-800">
                Finance Executives can create, save drafts, and submit budgets.
                Approve, reject, and cancel actions are restricted to Finance Managers.
              </p>
            </div>
          </SectionCard>

          <div className="flex flex-wrap gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Draft
            </button>
            <button
              type="button"
              onClick={handleSubmitForApproval}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit for Approval
            </button>
            <Link
              to="/budget"
              className={`inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 no-underline ${
                busy ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <X className="h-4 w-4" />
              Cancel
            </Link>
          </div>
        </div>

        {/* Summary sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <Wallet className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">Budget Summary</h3>
                  <p className="text-[11px] text-neutral-500">Live preview before save</p>
                </div>
              </div>
              <div className="divide-y divide-neutral-100 px-5">
                <SummaryRow
                  icon={DollarSign}
                  label="Budget Amount"
                  value={parsedAmount > 0 ? formatMoney(parsedAmount, currency) : "—"}
                  highlight
                />
                <SummaryRow
                  icon={Building2}
                  label="Company"
                  value={company || "—"}
                />
                <SummaryRow
                  icon={Calendar}
                  label="Fiscal Year"
                  value={fiscalYear || "—"}
                />
                <SummaryRow
                  icon={ClipboardList}
                  label={budgetAgainst === "Project" ? "Project" : "Cost Center"}
                  value={budgetTargetLabel}
                />
                <SummaryRow icon={GitBranch} label="Workflow Status" value="Draft" />
                <SummaryRow icon={FileText} label="Created By" value={createdBy} />
                <SummaryRow
                  icon={Calendar}
                  label="Created Date"
                  value={formatDateTime(new Date().toISOString())}
                  muted
                />
              </div>
            </div>

            {duplicateBudget && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-amber-800">Duplicate budget</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800">
                      {duplicateMessage}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/budget/detail/${encodeURIComponent(duplicateBudget.name)}`
                        )
                      }
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View Existing Budget
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showValidation && Object.keys(errors).length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50/70 px-4 py-3">
                <p className="mb-2 text-xs font-bold text-red-800">Validation errors</p>
                <ul className="space-y-1">
                  {Object.values(errors).map((msg) => (
                    <li key={msg} className="text-xs text-red-700">
                      • {msg}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-3.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100">
          <Icon className="h-4 w-4 text-neutral-600" />
        </div>
        <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function FormField({
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold text-neutral-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-[11px] text-neutral-500">{hint}</p>
      )}
      {error && <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="text-sm font-medium text-neutral-800">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}

function RadioOption({
  name,
  value,
  checked,
  onChange,
  label,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-700">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 border-neutral-300 text-primary-600 focus:ring-primary-500"
      />
      {label}
    </label>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
  highlight,
  muted,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${muted ? "text-neutral-300" : "text-neutral-400"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-neutral-500">{label}</p>
        <p
          className={`mt-0.5 truncate text-sm ${
            highlight ? "font-bold text-emerald-700" : "font-medium text-neutral-800"
          } ${muted ? "text-neutral-500" : ""}`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function inputClass(readOnly: boolean, hasError?: boolean): string {
  const base =
    "w-full rounded-lg border px-3 py-2.5 text-sm text-neutral-900 transition focus:outline-none focus:ring-2 focus:ring-primary-500/30";
  if (readOnly) {
    return `${base} border-neutral-200 bg-neutral-50 text-neutral-600 cursor-default`;
  }
  if (hasError) {
    return `${base} border-red-300 bg-white focus:border-red-400`;
  }
  return `${base} border-neutral-200 bg-white hover:border-neutral-300`;
}
