import { Plus, Trash2 } from "lucide-react";

import {
  RFI_ALLOWED_FILE_TYPES,
  RFI_DOCUMENT_TYPES,
  type RfiRequiredDocumentType,
} from "../../types/rfi";
import { generateId } from "../../utils/id";

export interface DocumentDraft {
  id: string;
  doc_type: RfiRequiredDocumentType;
  label?: string;
  required: boolean;
  selected: boolean;
  max_file_size_mb: number;
  allowed_file_types: string[];
}

export function createDefaultDocuments(): DocumentDraft[] {
  const defaults = new Set([
    "Company Profile",
    "ISO Certificate",
    "Brochure",
    "Technical Datasheet",
    "Financial Statement",
  ]);
  return RFI_DOCUMENT_TYPES.map((doc_type) => ({
    id: generateId(),
    doc_type,
    required: true,
    selected: defaults.has(doc_type),
    max_file_size_mb: 10,
    allowed_file_types: ["PDF", "DOCX", "PNG", "JPG"],
  }));
}

interface Props {
  docs: DocumentDraft[];
  onChange: (next: DocumentDraft[]) => void;
  readOnly?: boolean;
}

export default function RequiredDocumentsEditor({
  docs,
  onChange,
  readOnly = false,
}: Props) {
  const update = (id: string, patch: Partial<DocumentDraft>) => {
    onChange(docs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const toggleFileType = (id: string, type: string) => {
    const row = docs.find((d) => d.id === id);
    if (!row) return;
    const set = new Set(row.allowed_file_types);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    update(id, { allowed_file_types: Array.from(set) });
  };

  const addCustom = () => {
    onChange([
      ...docs,
      {
        id: generateId(),
        doc_type: "Other",
        label: "",
        required: true,
        selected: true,
        max_file_size_mb: 10,
        allowed_file_types: ["PDF"],
      },
    ]);
  };

  const selected = docs.filter((d) => d.selected);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[#64748B]">
        Configure documents suppliers must upload. Examples: ISO Certificate,
        Company Profile, Brochure, Technical Datasheet, Financial Statement.
      </p>

      {selected.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
          No required documents selected. Enable rows below or add a custom
          document.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-[#F8FAFC]">
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                <th className="px-3 py-2.5">Include</th>
                <th className="px-3 py-2.5">Document Name</th>
                <th className="px-3 py-2.5">Mandatory</th>
                <th className="px-3 py-2.5">Max File Size (MB)</th>
                <th className="px-3 py-2.5">Allowed File Types</th>
                {!readOnly ? <th className="px-3 py-2.5" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className={d.selected ? "bg-white" : "bg-[#FCFCFD] opacity-70"}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={d.selected}
                      disabled={readOnly}
                      onChange={(e) =>
                        update(d.id, { selected: e.target.checked })
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    {d.doc_type === "Other" ? (
                      <input
                        type="text"
                        disabled={readOnly || !d.selected}
                        value={d.label ?? ""}
                        onChange={(e) => update(d.id, { label: e.target.value })}
                        placeholder="Custom document name"
                        className="w-full min-w-[160px] rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400"
                      />
                    ) : (
                      <span className="font-medium text-neutral-800">
                        {d.doc_type}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={d.required}
                      disabled={readOnly || !d.selected}
                      onChange={(e) =>
                        update(d.id, { required: e.target.checked })
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      disabled={readOnly || !d.selected}
                      value={d.max_file_size_mb}
                      onChange={(e) =>
                        update(d.id, {
                          max_file_size_mb: Math.max(
                            1,
                            Number(e.target.value) || 1,
                          ),
                        })
                      }
                      className="w-20 rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {RFI_ALLOWED_FILE_TYPES.map((ft) => {
                        const on = d.allowed_file_types.includes(ft);
                        return (
                          <button
                            key={ft}
                            type="button"
                            disabled={readOnly || !d.selected}
                            onClick={() => toggleFileType(d.id, ft)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              on
                                ? "bg-[#E0F2FE] text-[#0369A1]"
                                : "bg-neutral-100 text-neutral-400"
                            } disabled:opacity-50`}
                          >
                            {ft}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  {!readOnly ? (
                    <td className="px-3 py-2.5 text-right">
                      {d.doc_type === "Other" ? (
                        <button
                          type="button"
                          onClick={() =>
                            onChange(docs.filter((x) => x.id !== d.id))
                          }
                          className="text-danger-600 hover:underline"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly ? (
        <button
          type="button"
          onClick={addCustom}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-[12px] font-medium text-neutral-700 hover:border-primary-300 hover:bg-primary-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add custom document
        </button>
      ) : null}
    </div>
  );
}
