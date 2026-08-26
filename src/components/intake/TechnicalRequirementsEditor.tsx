import React, { useState, useRef } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  FileText,
  Paperclip,
  CheckCircle2,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import type {
  TechnicalRequirementItem,
  TechnicalRequirementType,
  TechnicalUOM,
  NeedPriority,
  IntakeAttachment,
} from "../../types/businessIntake";

const REQUIREMENT_TYPES: TechnicalRequirementType[] = [
  "Product / Equipment",
  "Software",
  "Hardware",
  "Service",
  "System Integration",
  "Infrastructure",
  "Automation",
  "IT / Digital Solution",
  "Other",
];

const UOM_OPTIONS: TechnicalUOM[] = [
  "Nos.",
  "Unit",
  "Set",
  "License",
  "System",
  "Lot",
  "Other",
];

const DEFAULT_SUPPLIER_DOCS = [
  "Technical Data Sheet / Specification Sheet",
  "Quality Assurance Certificate (ISO 9001 / IATF 16949)",
  "Warranty & Service Level Agreement (SLA)",
  "Safety Data Sheet (SDS) / Compliance Certificate",
  "Factory Acceptance Test (FAT) / SAT Plan",
  "2D / 3D CAD Drawing & Layout",
  "CE / Regulatory Compliance Certificate",
];

interface Props {
  requirements: TechnicalRequirementItem[];
  onChange?: (updated: TechnicalRequirementItem[]) => void;
  readOnly?: boolean;
  title?: string;
  subtitle?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TechnicalRequirementsEditor({
  requirements = [],
  onChange,
  readOnly = false,
  title = "Technical Requirements & Specifications",
  subtitle = "Define detailed technical parameters, quantities, performance criteria, and required supplier deliverables.",
}: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Form State
  const [reqType, setReqType] = useState<TechnicalRequirementType>("Product / Equipment");
  const [specification, setSpecification] = useState("");
  const [quantity, setQuantity] = useState<number | "">(1);
  const [uom, setUom] = useState<TechnicalUOM>("Nos.");
  const [priority, setPriority] = useState<NeedPriority>("High");
  const [isMandatory, setIsMandatory] = useState<boolean>(true);
  const [performanceReqs, setPerformanceReqs] = useState("");
  const [qualityReqs, setQualityReqs] = useState("");
  const [deliveryReqs, setDeliveryReqs] = useState("");
  const [integrationReqs, setIntegrationReqs] = useState("");
  const [safetyReqs, setSafetyReqs] = useState("");
  const [supplierDocs, setSupplierDocs] = useState<string[]>([]);
  const [customDocInput, setCustomDocInput] = useState("");
  const [itemAttachments, setItemAttachments] = useState<IntakeAttachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setReqType("Product / Equipment");
    setSpecification("");
    setQuantity(1);
    setUom("Nos.");
    setPriority("High");
    setIsMandatory(true);
    setPerformanceReqs("");
    setQualityReqs("");
    setDeliveryReqs("");
    setIntegrationReqs("");
    setSafetyReqs("");
    setSupplierDocs([]);
    setCustomDocInput("");
    setItemAttachments([]);
    setEditingIndex(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenEdit = (index: number) => {
    const item = requirements[index];
    if (!item) return;
    setEditingIndex(index);
    setReqType(item.requirement_type || "Product / Equipment");
    setSpecification(item.specification || item.description || "");
    setQuantity(item.quantity ?? 1);
    setUom(item.uom || "Nos.");
    setPriority(item.priority || "High");
    setIsMandatory(item.is_mandatory !== false);
    setPerformanceReqs(item.performance_requirements || "");
    setQualityReqs(item.quality_requirements || "");
    setDeliveryReqs(item.delivery_installation_requirements || "");
    setIntegrationReqs(item.integration_requirements || "");
    setSafetyReqs(item.safety_compliance_requirements || "");
    setSupplierDocs(item.required_supplier_documents || []);
    setItemAttachments(item.attachments || []);
    setIsModalOpen(true);
  };

  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!specification.trim()) {
      toast.error("Requirement / Technical Specification is required.");
      return;
    }

    if (quantity === "" || Number(quantity) <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }

    const newItem: TechnicalRequirementItem = {
      id: editingIndex !== null && requirements[editingIndex]?.id ? requirements[editingIndex].id : `tr-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      requirement_type: reqType,
      specification: specification.trim(),
      quantity: Number(quantity),
      uom: uom,
      priority: priority,
      is_mandatory: isMandatory,
      performance_requirements: performanceReqs.trim() || undefined,
      quality_requirements: qualityReqs.trim() || undefined,
      delivery_installation_requirements: deliveryReqs.trim() || undefined,
      integration_requirements: integrationReqs.trim() || undefined,
      safety_compliance_requirements: safetyReqs.trim() || undefined,
      required_supplier_documents: supplierDocs.length > 0 ? supplierDocs : undefined,
      attachments: itemAttachments.length > 0 ? itemAttachments : undefined,
      // Compatibility fields
      description: specification.trim(),
    };

    let updatedList: TechnicalRequirementItem[];
    if (editingIndex !== null) {
      updatedList = [...requirements];
      updatedList[editingIndex] = newItem;
      toast.success("Technical requirement updated.");
    } else {
      updatedList = [...requirements, newItem];
      toast.success("Technical requirement added.");
    }

    if (onChange) onChange(updatedList);
    setIsModalOpen(false);
    resetForm();
  };

  const handleDeleteItem = (index: number) => {
    const updated = requirements.filter((_, i) => i !== index);
    if (onChange) onChange(updated);
    toast.success("Technical requirement removed.");
  };

  const handleToggleDoc = (docName: string) => {
    setSupplierDocs((prev) =>
      prev.includes(docName) ? prev.filter((d) => d !== docName) : [...prev, docName]
    );
  };

  const handleAddCustomDoc = () => {
    if (!customDocInput.trim()) return;
    const name = customDocInput.trim();
    if (!supplierDocs.includes(name)) {
      setSupplierDocs((prev) => [...prev, name]);
    }
    setCustomDocInput("");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    e.target.value = "";

    const ALLOWED = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "png", "jpg", "jpeg", "dwg", "step", "stp"];
    const newAtts: IntakeAttachment[] = [];

    for (const file of selected) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED.includes(ext)) {
        toast.error(`"${file.name}" is an unsupported file format.`);
        continue;
      }
      newAtts.push({
        name: file.name,
        size: formatBytes(file.size),
        date: new Date().toISOString().split("T")[0],
        type: ext.toUpperCase(),
        rawFile: file,
      });
    }

    setItemAttachments((prev) => [...prev, ...newAtts]);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-bold text-neutral-900">{title}</h3>
            <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-[11px] font-bold text-primary-700 border border-primary-200">
              {requirements.length} {requirements.length === 1 ? "Item" : "Items"}
            </span>
          </div>
          {subtitle && <p className="text-[12.5px] text-neutral-500 mt-0.5">{subtitle}</p>}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-700 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add Technical Requirement
          </button>
        )}
      </div>

      {/* Empty State */}
      {requirements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-8 text-center">
          <Layers className="mx-auto h-8 w-8 text-neutral-400 mb-2" />
          <h4 className="text-sm font-semibold text-neutral-800">No Technical Requirements Specified</h4>
          <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1 mb-4">
            Technical requirements describe the equipment, specifications, performance criteria, and quality standards required for this intake.
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add Technical Requirement
            </button>
          )}
        </div>
      ) : (
        /* Requirements Table / Grid */
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
              <tr>
                <th className="p-3">Type</th>
                <th className="p-3">Specification / Description</th>
                <th className="p-3">Qty &amp; UOM</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Mandatory</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {requirements.map((item, idx) => {
                const isExpanded = expandedIndex === idx;
                return (
                  <React.Fragment key={item.id || idx}>
                    <tr className="hover:bg-neutral-50/70 transition-colors">
                      <td className="p-3 font-semibold text-neutral-900 whitespace-nowrap">
                        <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-800">
                          {item.requirement_type}
                        </span>
                      </td>
                      <td className="p-3 max-w-md">
                        <p className="font-medium text-neutral-900 leading-snug line-clamp-2">
                          {item.specification || item.description || "—"}
                        </p>
                        {(item.performance_requirements || item.required_supplier_documents?.length) && (
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-500">
                            {item.performance_requirements && (
                              <span className="truncate max-w-[200px]">Perf: {item.performance_requirements}</span>
                            )}
                            {item.required_supplier_documents && item.required_supplier_documents.length > 0 && (
                              <span className="font-semibold text-indigo-600">
                                {item.required_supplier_documents.length} Docs Required
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="font-bold text-neutral-900">{item.quantity}</span>{" "}
                        <span className="text-neutral-500">{item.uom}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            item.priority === "Critical"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : item.priority === "High"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : item.priority === "Medium"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {item.priority}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {item.is_mandatory !== false ? (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Yes
                          </span>
                        ) : (
                          <span className="text-neutral-500">Optional</span>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                            className="p-1 text-neutral-500 hover:text-neutral-800 rounded hover:bg-neutral-100 transition-colors"
                            title={isExpanded ? "Collapse details" : "Expand details"}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>

                          {!readOnly && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(idx)}
                                className="p-1 text-neutral-500 hover:text-primary-600 rounded hover:bg-primary-50 transition-colors"
                                title="Edit Requirement"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(idx)}
                                className="p-1 text-neutral-500 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                                title="Delete Requirement"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Detail Panel */}
                    {isExpanded && (
                      <tr className="bg-neutral-50/80">
                        <td colSpan={6} className="p-4 border-t border-neutral-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            {item.performance_requirements && (
                              <div className="rounded-lg bg-white p-3 border border-neutral-200">
                                <span className="font-bold text-neutral-700 block mb-1">Performance Requirements</span>
                                <p className="text-neutral-600 whitespace-pre-line">{item.performance_requirements}</p>
                              </div>
                            )}

                            {item.quality_requirements && (
                              <div className="rounded-lg bg-white p-3 border border-neutral-200">
                                <span className="font-bold text-neutral-700 block mb-1">Quality Requirements</span>
                                <p className="text-neutral-600 whitespace-pre-line">{item.quality_requirements}</p>
                              </div>
                            )}

                            {item.delivery_installation_requirements && (
                              <div className="rounded-lg bg-white p-3 border border-neutral-200">
                                <span className="font-bold text-neutral-700 block mb-1">Delivery &amp; Installation Requirements</span>
                                <p className="text-neutral-600 whitespace-pre-line">{item.delivery_installation_requirements}</p>
                              </div>
                            )}

                            {item.integration_requirements && (
                              <div className="rounded-lg bg-white p-3 border border-neutral-200">
                                <span className="font-bold text-neutral-700 block mb-1">Integration Requirements</span>
                                <p className="text-neutral-600 whitespace-pre-line">{item.integration_requirements}</p>
                              </div>
                            )}

                            {item.safety_compliance_requirements && (
                              <div className="rounded-lg bg-white p-3 border border-neutral-200">
                                <span className="font-bold text-neutral-700 block mb-1">Safety &amp; Compliance Requirements</span>
                                <p className="text-neutral-600 whitespace-pre-line">{item.safety_compliance_requirements}</p>
                              </div>
                            )}

                            {item.required_supplier_documents && item.required_supplier_documents.length > 0 && (
                              <div className="rounded-lg bg-white p-3 border border-neutral-200">
                                <span className="font-bold text-neutral-700 block mb-1.5">Required Supplier Deliverables &amp; Certificates</span>
                                <ul className="space-y-1">
                                  {item.required_supplier_documents.map((doc, dIdx) => (
                                    <li key={dIdx} className="flex items-center gap-1.5 text-neutral-700">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                      <span>{doc}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {item.attachments && item.attachments.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-neutral-200">
                              <span className="font-bold text-neutral-700 block text-xs mb-1.5">Technical Attachments &amp; Drawings ({item.attachments.length})</span>
                              <div className="flex flex-wrap gap-2">
                                {item.attachments.map((att, aIdx) => (
                                  <div key={aIdx} className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800">
                                    <Paperclip className="h-3.5 w-3.5 text-neutral-500" />
                                    <span className="font-medium truncate max-w-[180px]">{att.name}</span>
                                    {att.size && <span className="text-[10px] text-neutral-400">({att.size})</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Technical Requirement Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral-900/60 p-4 backdrop-blur-sm">
          <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl transition-all">
            {/* Modal Header */}
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-neutral-200 px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600 border border-primary-100">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900">
                    {editingIndex !== null ? "Edit Technical Requirement" : "Add Technical Requirement"}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Specify technical details, required deliverables, and performance parameters.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveItem} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Basic Parameters: Type, Qty, UOM, Priority, Mandatory */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-neutral-600 mb-1">
                      Requirement Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={reqType}
                      onChange={(e) => setReqType(e.target.value as TechnicalRequirementType)}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-900 bg-white focus:border-primary-500 focus:outline-none"
                    >
                      {REQUIREMENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-neutral-600 mb-1">
                      Quantity <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-900 focus:border-primary-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-neutral-600 mb-1">
                      UOM <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={uom}
                      onChange={(e) => setUom(e.target.value as TechnicalUOM)}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-900 bg-white focus:border-primary-500 focus:outline-none"
                    >
                      {UOM_OPTIONS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-neutral-600 mb-1">
                      Priority <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as NeedPriority)}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-900 bg-white focus:border-primary-500 focus:outline-none"
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </div>
                </div>

                {/* Mandatory Requirement toggle */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_mandatory_check"
                    checked={isMandatory}
                    onChange={(e) => setIsMandatory(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="is_mandatory_check" className="text-xs font-semibold text-neutral-800 cursor-pointer">
                    Mandatory Technical Requirement (Must be satisfied by supplier)
                  </label>
                </div>

                {/* Requirement / Specification Textarea */}
                <div>
                  <label className="block text-xs font-semibold uppercase text-neutral-600 mb-1">
                    Requirement / Technical Specification <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={specification}
                    onChange={(e) => setSpecification(e.target.value)}
                    placeholder="Provide full technical description, material grade, dimensions, capacity, or scope of work..."
                    className="w-full rounded-lg border border-neutral-300 p-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none"
                  />
                </div>

                {/* Extended Parameters Accordion / Fields */}
                <div className="space-y-4 pt-2 border-t border-neutral-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                    Detailed Parameters &amp; Criteria (Optional)
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        Performance Requirements
                      </label>
                      <textarea
                        rows={2}
                        value={performanceReqs}
                        onChange={(e) => setPerformanceReqs(e.target.value)}
                        placeholder="e.g. Min 20 units/hour, 99.8% uptime, max 45kW power consumption"
                        className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        Quality Requirements
                      </label>
                      <textarea
                        rows={2}
                        value={qualityReqs}
                        onChange={(e) => setQualityReqs(e.target.value)}
                        placeholder="e.g. ISO 9001 certified, CMM inspection report, zero surface defects"
                        className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        Delivery / Installation Requirements
                      </label>
                      <textarea
                        rows={2}
                        value={deliveryReqs}
                        onChange={(e) => setDeliveryReqs(e.target.value)}
                        placeholder="e.g. DDP Plant 01, installation & commissioning included, 45-day lead time"
                        className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        Integration Requirements
                      </label>
                      <textarea
                        rows={2}
                        value={integrationReqs}
                        onChange={(e) => setIntegrationReqs(e.target.value)}
                        placeholder="e.g. OPC-UA interface, Siemens S7 PLC compatibility, MES API integration"
                        className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Safety &amp; Compliance Requirements
                    </label>
                    <textarea
                      rows={2}
                      value={safetyReqs}
                      onChange={(e) => setSafetyReqs(e.target.value)}
                      placeholder="e.g. CE marking, OSHA compliance, EHS zero-hazard certification"
                      className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Required Supplier Documents */}
                <div className="pt-2 border-t border-neutral-200 space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600">
                    Required Supplier Documents &amp; Certificates
                  </label>
                  <p className="text-xs text-neutral-500">Select standard deliverables suppliers must upload during bidding:</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {DEFAULT_SUPPLIER_DOCS.map((doc) => {
                      const isChecked = supplierDocs.includes(doc);
                      return (
                        <label
                          key={doc}
                          className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                            isChecked ? "bg-primary-50/70 border-primary-200 text-primary-900" : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleDoc(doc)}
                            className="h-4 w-4 rounded border-neutral-300 text-primary-600"
                          />
                          <span className="font-medium text-[11.5px]">{doc}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={customDocInput}
                      onChange={(e) => setCustomDocInput(e.target.value)}
                      placeholder="Add custom supplier document requirement..."
                      className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs focus:border-primary-500 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomDoc();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomDoc}
                      className="rounded-lg border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Technical Attachments */}
                <div className="pt-2 border-t border-neutral-200 space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600">
                    Technical Attachments (Drawings, Datasheets, CAD Files)
                  </label>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.dwg,.step,.stp"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 shadow-2xs"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-neutral-500" />
                      Attach Technical File
                    </button>
                    <span className="text-[11px] text-neutral-400">Accepted: PDF, CAD (DWG/STEP), Excel, Images</span>
                  </div>

                  {itemAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {itemAttachments.map((att, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800">
                          <Paperclip className="h-3.5 w-3.5 text-neutral-500" />
                          <span className="font-medium truncate max-w-[160px]">{att.name}</span>
                          <button
                            type="button"
                            onClick={() => setItemAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-neutral-400 hover:text-red-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-neutral-200 px-6 py-3.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700"
                >
                  {editingIndex !== null ? "Update Requirement" : "Add Requirement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
