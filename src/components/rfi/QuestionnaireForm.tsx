import { Loader2 } from "lucide-react";

import { getFullFileUrl } from "../../api/legalDocsStorage";
import type {
  RfiAnswer,
  RfiQuestion,
  RfiUploadedFile,
} from "../../types/rfi";
import { RFI_QUESTION_TYPES } from "../../types/rfi";

function openableAnswerUrl(fileUrl: string | undefined): string {
  const raw = String(fileUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:") || raw.includes("/api/file-proxy")) return raw;
  return getFullFileUrl(raw) || "";
}

interface Props {
  questions: RfiQuestion[];
  answers: RfiAnswer[];
  onChange: (answers: RfiAnswer[]) => void;
  onUploadFile?: (questionId: string, file: File) => Promise<RfiUploadedFile>;
  readOnly?: boolean;
  uploadingQuestionId?: string | null;
}

function typeLabel(type: RfiQuestion["type"]): string {
  return RFI_QUESTION_TYPES.find((t) => t.value === type)?.label ?? type;
}

function ensureAnswer(
  answers: RfiAnswer[],
  questionId: string,
): { list: RfiAnswer[]; answer: RfiAnswer } {
  const existing = answers.find((a) => a.question_id === questionId);
  if (existing) return { list: answers, answer: existing };
  const answer: RfiAnswer = { question_id: questionId };
  return { list: [...answers, answer], answer };
}

export default function QuestionnaireForm({
  questions,
  answers,
  onChange,
  onUploadFile,
  readOnly = false,
  uploadingQuestionId = null,
}: Props) {
  const setScalar = (
    questionId: string,
    value: string | number | boolean | null,
  ) => {
    const { list, answer } = ensureAnswer(answers, questionId);
    onChange(
      list.map((a) =>
        a.question_id === questionId
          ? { ...answer, value, values: undefined, file: undefined }
          : a,
      ),
    );
  };

  const setValues = (questionId: string, values: string[]) => {
    const { list, answer } = ensureAnswer(answers, questionId);
    onChange(
      list.map((a) =>
        a.question_id === questionId
          ? { ...answer, values, value: undefined, file: undefined }
          : a,
      ),
    );
  };

  const setFile = (questionId: string, file: RfiUploadedFile | null) => {
    const { list, answer } = ensureAnswer(answers, questionId);
    onChange(
      list.map((a) =>
        a.question_id === questionId
          ? { ...answer, file, value: undefined, values: undefined }
          : a,
      ),
    );
  };

  const getAnswer = (qid: string) =>
    answers.find((a) => a.question_id === qid);

  if (!questions.length) {
    return (
      <p className="text-sm text-neutral-500">No questionnaire for this RFI.</p>
    );
  }

  return (
    <div className="space-y-4">
      {questions
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((q, i) => {
          const ans = getAnswer(q.id);
          return (
            <div
              key={q.id}
              className="rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-neutral-900">
                  {i + 1}. {q.title}
                  {q.required && (
                    <span className="ml-1 text-danger-500">*</span>
                  )}
                </span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  {typeLabel(q.type)}
                </span>
              </div>
              {q.help_text ? (
                <p className="mb-2 text-[12px] text-neutral-500">{q.help_text}</p>
              ) : null}

              {q.type === "short_text" && (
                <input
                  type="text"
                  disabled={readOnly}
                  placeholder={q.placeholder || undefined}
                  value={(ans?.value as string) ?? ""}
                  onChange={(e) => setScalar(q.id, e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 disabled:bg-neutral-50"
                />
              )}

              {q.type === "long_text" && (
                <textarea
                  disabled={readOnly}
                  rows={4}
                  placeholder={q.placeholder || undefined}
                  value={(ans?.value as string) ?? ""}
                  onChange={(e) => setScalar(q.id, e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 disabled:bg-neutral-50"
                />
              )}

              {q.type === "number" && (
                <input
                  type="number"
                  disabled={readOnly}
                  placeholder={q.placeholder || undefined}
                  value={
                    ans?.value === undefined || ans?.value === null
                      ? ""
                      : String(ans.value)
                  }
                  onChange={(e) =>
                    setScalar(
                      q.id,
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                  className="w-full max-w-xs rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 disabled:bg-neutral-50"
                />
              )}

              {q.type === "yes_no" && (
                <div className="flex gap-4">
                  {(["Yes", "No"] as const).map((opt) => (
                    <label
                      key={opt}
                      className="inline-flex items-center gap-2 text-sm text-neutral-700"
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        disabled={readOnly}
                        checked={ans?.value === opt}
                        onChange={() => setScalar(q.id, opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}

              {q.type === "dropdown" && (
                <select
                  disabled={readOnly}
                  value={(ans?.value as string) ?? ""}
                  onChange={(e) => setScalar(q.id, e.target.value)}
                  className="w-full max-w-md rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 disabled:bg-neutral-50"
                >
                  <option value="">Select…</option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {q.type === "checkbox" && (
                <div className="space-y-2">
                  {q.options.map((opt) => {
                    const selected = ans?.values ?? [];
                    const checked = selected.includes(opt);
                    return (
                      <label
                        key={opt}
                        className="flex items-center gap-2 text-sm text-neutral-700"
                      >
                        <input
                          type="checkbox"
                          disabled={readOnly}
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selected.filter((v) => v !== opt)
                              : [...selected, opt];
                            setValues(q.id, next);
                          }}
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              )}

              {q.type === "file_upload" && (
                <div className="space-y-2">
                  {ans?.file?.file_url && openableAnswerUrl(ans.file.file_url) ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <a
                        href={openableAnswerUrl(ans.file.file_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary-700 hover:underline"
                      >
                        {ans.file.file_name}
                      </a>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setFile(q.id, null)}
                          className="text-xs text-danger-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ) : readOnly ? (
                    <p className="text-sm text-neutral-400">No file uploaded</p>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50">
                      {uploadingQuestionId === q.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        "Choose file"
                      )}
                      <input
                        type="file"
                        className="hidden"
                        disabled={!!uploadingQuestionId || !onUploadFile}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file || !onUploadFile) return;
                          const uploaded = await onUploadFile(q.id, file);
                          setFile(q.id, uploaded);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
