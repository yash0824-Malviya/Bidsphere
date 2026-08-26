import React, { useRef, useState } from "react";
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  CheckCircle2,
  FileCode,
} from "lucide-react";
import toast from "react-hot-toast";
import type { IntakeAttachment } from "../../../types/businessIntake";

interface Props {
  attachments: IntakeAttachment[];
  onChange: (attachments: IntakeAttachment[]) => void;
}

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
  if (["dwg", "step", "stp", "cad"].includes(ext)) {
    return <FileCode className="h-4 w-4 text-purple-600" />;
  }
  return <Paperclip className="h-4 w-4 text-neutral-500" />;
}

export function Step5Documents({ attachments, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = (files: File[]) => {
    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    const ALLOWED_EXTS = [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "csv",
      "ppt",
      "pptx",
      "png",
      "jpg",
      "jpeg",
      "dwg",
      "step",
      "stp",
    ];

    const newItems: IntakeAttachment[] = [];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED_EXTS.includes(ext)) {
        toast.error(`"${file.name}" has an unsupported format.`);
        continue;
      }

      if (file.size > MAX_SIZE) {
        toast.error(`"${file.name}" exceeds 25 MB limit.`);
        continue;
      }

      const formattedSize = formatBytes(file.size);

      if (
        attachments.some((a) => a.name === file.name && a.size === formattedSize) ||
        newItems.some((a) => a.name === file.name && a.size === formattedSize)
      ) {
        toast.error(`"${file.name}" is already attached.`);
        continue;
      }

      newItems.push({
        name: file.name,
        size: formattedSize,
        date: new Date().toISOString().split("T")[0],
        type: ext.toUpperCase(),
        uploading: false,
        rawFile: file,
      });
    }

    if (newItems.length > 0) {
      onChange([...attachments, ...newItems]);
      toast.success(`Attached ${newItems.length} file(s).`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
    e.target.value = "";
  };

  const handleRemove = (index: number) => {
    const updated = attachments.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-0">
      {/* ── Section Header ── */}
      <div className="px-6 sm:px-8 py-5 border-b border-neutral-100">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
            Supporting Documents
          </h2>
          <span className="text-[11px] font-medium text-neutral-400">
            Step 5 of 6 &middot; Specifications &amp; Files
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Attach relevant specifications, quotes, technical drawings, or supporting files.
        </p>
      </div>

      {/* ── Form Body ── */}
      <div className="px-6 sm:px-8 py-6 space-y-6">
        {/* Compact Drag & Drop Target */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center p-6 rounded-xl border border-dashed cursor-pointer transition-all ${
            isDragging
              ? "border-primary-500 bg-primary-50/60"
              : "border-neutral-300 bg-neutral-50/40 hover:bg-neutral-50 hover:border-neutral-400"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.dwg,.step,.stp"
          />
          <div className="h-10 w-10 rounded-full bg-primary-50 flex items-center justify-center text-primary-600 mb-2">
            <UploadCloud className="h-5 w-5" />
          </div>
          <p className="text-xs font-bold text-neutral-900">
            Click to upload or drag and drop files here
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            PDF, Word (.docx), Excel (.xlsx), CAD (.dwg, .step), Images (PNG, JPG) up to 25 MB
          </p>
        </div>

        {/* Attached Files List */}
        {attachments.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-neutral-700">
              Attached Files ({attachments.length})
            </h4>
            <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white overflow-hidden">
              {attachments.map((att, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 hover:bg-neutral-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-center shrink-0">
                      {getFileIcon(att.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-neutral-900 truncate">
                        {att.name}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                        <span>{att.size}</span>
                        <span>•</span>
                        <span className="uppercase">{att.type}</span>
                        <span>•</span>
                        <span className="text-emerald-600 inline-flex items-center gap-0.5 font-medium">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(index);
                    }}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Remove attachment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-400 italic">No files attached yet. You can attach documents now or later.</p>
        )}
      </div>
    </div>
  );
}
