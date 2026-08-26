import React, { useState, useRef, useEffect } from "react";
import { X, Plus, FileText, Loader2, Sparkles, Paperclip, Trash2, Image as ImageIcon, FileSpreadsheet } from "lucide-react";
import toast from "react-hot-toast";
import type { CreateBusinessNeedInput, NeedPriority, NeedType, IntakeAttachment, TechnicalRequirementItem } from "../../types/businessIntake";
import { getERPNextCompanies } from "../../api/businessIntakeErp";
import { TechnicalRequirementsEditor } from "./TechnicalRequirementsEditor";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateBusinessNeedInput) => Promise<void>;
  currentUserEmail?: string;
  currentUserName?: string;
}

const DEPARTMENTS = [
  "IT & Digital Transformation",
  "Manufacturing Engineering",
  "Supply Chain & Logistics",
  "Facilities & EHS",
  "Operations & Production",
  "Research & Development",
  "Quality Assurance",
  "Finance & Administration",
  "Human Resources",
];

const PLANTS = [
  "Plant 01 - Main Manufacturing Hub",
  "Plant 02 - Chassis & Assembly Center",
  "Plant 03 - Precision BioTech Facility",
  "HQ Corporate Center",
  "Tech Center - R&D Facility",
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "svg", "webp"].includes(ext)) {
    return <ImageIcon className="h-4 w-4 text-sky-600" />;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />;
  }
  if (["pdf"].includes(ext)) {
    return <FileText className="h-4 w-4 text-red-600" />;
  }
  return <Paperclip className="h-4 w-4 text-neutral-500" />;
}

export function CreateBusinessNeedModal({
  isOpen,
  onClose,
  onSubmit,
  currentUserEmail = "department@netlink.com",
  currentUserName = "Department User",
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [businessUnit, setBusinessUnit] = useState("Industrial Operations");
  const [plant, setPlant] = useState(PLANTS[0]);
  const [project, setProject] = useState("");
  const [program, setProgram] = useState("");
  const [businessOwner, setBusinessOwner] = useState("");
  const [priority, setPriority] = useState<NeedPriority>("High");
  const [needType, setNeedType] = useState<NeedType>("Direct");
  const [expectedCompletionDate, setExpectedCompletionDate] = useState(
    new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [estimatedBudget, setEstimatedBudget] = useState<number | "">("");
  const [currency, setCurrency] = useState("USD");
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([]);
  const [techRequirements, setTechRequirements] = useState<TechnicalRequirementItem[]>([]);
  const [companies, setCompanies] = useState<{ name: string; company_name: string; abbr: string; default_currency: string }[]>([]);
  const [company, setCompany] = useState("");
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companyError, setCompanyError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setLoadingCompanies(true);
    setCompanyError("");
    
    getERPNextCompanies()
      .then((data) => {
        if (!isMounted) return;
        setCompanies(data);
        if (data.length === 1) {
          setCompany(data[0].name);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setCompanyError("Unable to load companies from ERPNext. Please try again.");
      })
      .finally(() => {
        if (isMounted) setLoadingCompanies(false);
      });
      
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTriggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    // Reset input value so the same file can be re-selected if removed
    e.target.value = "";

    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    const ALLOWED_EXTS = [
      "pdf", "doc", "docx", "xls", "xlsx", "csv",
      "png", "jpg", "jpeg", "dwg", "step", "stp"
    ];

    for (const file of selectedFiles) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED_EXTS.includes(ext)) {
        toast.error(`"${file.name}" is an unsupported file type.`);
        continue;
      }

      if (file.size > MAX_SIZE) {
        toast.error(`"${file.name}" exceeds the maximum 25 MB file size limit.`);
        continue;
      }

      const formattedSize = formatBytes(file.size);

      // Prevent duplicate attachment selection
      if (attachments.some((a) => a.name === file.name && a.size === formattedSize)) {
        toast.error(`"${file.name}" is already attached.`);
        continue;
      }

      const newAtt: IntakeAttachment = {
        name: file.name,
        size: formattedSize,
        date: new Date().toISOString().split("T")[0],
        type: ext.toUpperCase(),
        uploading: false,
        rawFile: file,
      };

      setAttachments((prev) => [...prev, newAtt]);
    }
  };


  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim() || !description.trim() || !estimatedBudget) return;

    if (uploadingCount > 0) {
      toast.error("Please wait for all file uploads to complete before submitting.");
      return;
    }

      if (!company) {
        toast.error("Selected company is not available in ERPNext. Please select a valid company.");
        return;
      }
      
      if (companyError) {
        toast.error(companyError);
        return;
      }

      try {
        setSubmitting(true);

        // Attachments are uploaded in businessIntakeErp.ts after the Business Need is created.
        const readyAttachments = attachments;

        await onSubmit({
          title,
          description,
          company,
          problem_statement: description,
          department,
          business_unit: businessUnit,
          plant,
          project: project || "General Capital Project",
          program: program || "Operational Efficiency",
          requester: currentUserEmail,
          requester_email: currentUserEmail,
          business_owner: businessOwner || currentUserEmail,
          business_owner_email: currentUserEmail,
          priority,
          need_type: needType,
          expected_completion_date: expectedCompletionDate,
          estimated_budget: Number(estimatedBudget),
          currency,
          technical_requirements_list: techRequirements,
          attachments: readyAttachments,
        });
      onClose();
    } catch (err: any) {
      console.error("[BusinessNeed] Submission error:", err);
      const msg =
        err?.message ||
        err?.response?.data?.message ||
        "Business Need submission failed. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral-900/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-[940px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl transition-all">
        {/* Header */}
        <div className="flex h-[74px] shrink-0 items-center justify-between border-b border-neutral-200/80 bg-white px-7 py-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 border border-primary-100/60 shadow-xs">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-neutral-900 leading-tight">
                New Business Need Intake
              </h2>
              <p className="text-[13px] text-neutral-500 leading-tight mt-0.5">
                Create a business requirement for Finance & Legal review before Procurement.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Form Body & Sticky Footer in Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
            {/* Section 1: BUSINESS REQUIREMENT */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  1. Business Requirement
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Requirement Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Next-Gen High Precision Inspection Laser Sensors"
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Priority <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as NeedPriority)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                  Description & Requirement Details <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe operational bottleneck, business justification, and required capabilities..."
                  className="w-full h-[100px] rounded-lg border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>

            {/* Section 2: ORGANIZATION */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  2. Organization
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Department <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Company <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    disabled={loadingCompanies || companies.length === 1}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white disabled:bg-neutral-100"
                  >
                    <option value="" disabled>
                      {loadingCompanies ? "Loading companies..." : companyError ? "Error loading companies" : "[ Select company ]"}
                    </option>
                    {companies.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.company_name || c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Business Unit
                  </label>
                  <input
                    type="text"
                    value={businessUnit}
                    onChange={(e) => setBusinessUnit(e.target.value)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Plant / Location <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={plant}
                    onChange={(e) => setPlant(e.target.value)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                  >
                    {PLANTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 3: PROJECT CONTEXT */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  3. Project Context
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    placeholder="e.g. Project Quality 2026"
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Program Name
                  </label>
                  <input
                    type="text"
                    value={program}
                    onChange={(e) => setProgram(e.target.value)}
                    placeholder="e.g. Smart Manufacturing FY26"
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>

            {/* Section 4: OWNERSHIP */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  4. Ownership
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Requester Name
                  </label>
                  <input
                    type="text"
                    value={currentUserName}
                    readOnly
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:outline-none bg-neutral-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Business Owner
                  </label>
                  <input
                    type="text"
                    value={businessOwner}
                    onChange={(e) => setBusinessOwner(e.target.value)}
                    placeholder="e.g. Director of Operations"
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>

            {/* Section 5: REQUIREMENT & BUDGET */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  5. Requirement & Budget
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Need Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={needType}
                    onChange={(e) => setNeedType(e.target.value as NeedType)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                  >
                    <option value="Direct">Direct</option>
                    <option value="Indirect">Indirect</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Completion Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={expectedCompletionDate}
                    onChange={(e) => setExpectedCompletionDate(e.target.value)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Estimated Budget <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={estimatedBudget}
                    onChange={(e) =>
                      setEstimatedBudget(e.target.value ? Number(e.target.value) : "")
                    }
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full h-[42px] rounded-lg border border-neutral-300 px-3.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="INR">INR (₹)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 6: TECHNICAL REQUIREMENTS */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  6. Technical Requirements
                </span>
              </div>
              <TechnicalRequirementsEditor
                requirements={techRequirements}
                onChange={setTechRequirements}
                title="Technical Requirements & Specifications"
                subtitle="Add equipment, software, hardware, or service technical specifications for this need."
              />
            </div>

            {/* Section 7: SUPPORTING DOCUMENTS */}
            <div className="space-y-4">
              <div className="pb-1.5 border-b border-neutral-200/80">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
                  7. Supporting Documents
                </span>
                <p className="text-xs text-neutral-500 font-normal mt-0.5">
                  Attach technical specifications, drawings, quotations, or supporting documents.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.dwg,.step,.stp"
                className="hidden"
                onChange={handleFileSelect}
              />

              {attachments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-6 text-center">
                  <Paperclip className="mx-auto h-6 w-6 text-neutral-400 mb-1.5" />
                  <p className="text-xs text-neutral-500 font-medium mb-3">No files attached yet</p>
                  <button
                    type="button"
                    onClick={handleTriggerFileSelect}
                    disabled={uploadingCount > 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 transition-colors disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add File
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="divide-y divide-neutral-200/80 rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    {attachments.map((att, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-4 py-3 text-xs hover:bg-neutral-50/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                            {getFileIcon(att.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-neutral-800 truncate">{att.name}</p>
                            <p className="text-[11px] text-neutral-500 flex items-center gap-1.5 mt-0.5">
                              <span>{att.type || "FILE"}</span>
                              <span>•</span>
                              <span>{att.size || "Unknown size"}</span>
                              <span>•</span>
                              {att.uploading ? (
                                <span className="text-amber-600 font-medium flex items-center gap-1">
                                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
                                </span>
                              ) : (
                                <span className="text-emerald-600 font-medium">Pending Upload</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(i)}
                          title="Remove attachment"
                          className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-start">
                    <button
                      type="button"
                      onClick={handleTriggerFileSelect}
                      disabled={uploadingCount > 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors shadow-2xs disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add File
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Footer */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-neutral-200/80 bg-white px-7 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingCount > 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating Business Need...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Submit Business Need
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
