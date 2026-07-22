import { GripVertical, Plus, Trash2 } from "lucide-react";

import {
  RFI_QUESTION_TYPES,
  type RfiQuestion,
  type RfiQuestionType,
} from "../../types/rfi";
import { generateId } from "../../utils/id";

export type QuestionDraft = Omit<RfiQuestion, "sort_order">;

interface Props {
  questions: QuestionDraft[];
  onChange: (next: QuestionDraft[]) => void;
  readOnly?: boolean;
}

const needsOptions = (type: RfiQuestionType) =>
  type === "dropdown" || type === "checkbox";

export function createEmptyQuestion(): QuestionDraft {
  return {
    id: generateId(),
    title: "",
    type: "short_text",
    required: true,
    options: [],
    placeholder: "",
    help_text: "",
  };
}

export default function QuestionnaireBuilder({
  questions,
  onChange,
  readOnly = false,
}: Props) {
  const update = (id: string, patch: Partial<QuestionDraft>) => {
    onChange(
      questions.map((q) => {
        if (q.id !== id) return q;
        const next = { ...q, ...patch };
        if (patch.type && !needsOptions(patch.type)) {
          next.options = [];
        }
        if (patch.type && needsOptions(patch.type) && !next.options.length) {
          next.options = ["Option 1", "Option 2"];
        }
        return next;
      }),
    );
  };

  const remove = (id: string) => {
    onChange(questions.filter((q) => q.id !== id));
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...questions];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    onChange(next);
  };

  const setOption = (qid: string, idx: number, value: string) => {
    onChange(
      questions.map((q) => {
        if (q.id !== qid) return q;
        const options = [...q.options];
        options[idx] = value;
        return { ...q, options };
      }),
    );
  };

  const addOption = (qid: string) => {
    onChange(
      questions.map((q) =>
        q.id === qid
          ? { ...q, options: [...q.options, `Option ${q.options.length + 1}`] }
          : q,
      ),
    );
  };

  const removeOption = (qid: string, idx: number) => {
    onChange(
      questions.map((q) =>
        q.id === qid
          ? { ...q, options: q.options.filter((_, i) => i !== idx) }
          : q,
      ),
    );
  };

  if (questions.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-500">
          No questions yet. Add at least one question before publishing.
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => onChange([createEmptyQuestion()])}
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800"
          >
            <Plus className="h-4 w-4" />
            Add Question
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[920px] text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-[#F8FAFC]">
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                <th className="w-14 px-3 py-2.5">Seq</th>
                <th className="px-3 py-2.5">Question</th>
                <th className="w-36 px-3 py-2.5">Question Type</th>
                <th className="w-20 px-3 py-2.5">Required</th>
                <th className="px-3 py-2.5">Placeholder</th>
                <th className="px-3 py-2.5">Help Text</th>
                {!readOnly ? <th className="w-20 px-3 py-2.5" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {questions.map((q, index) => (
                <tr key={q.id} className="align-top hover:bg-[#F8FAFC]/60">
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-center gap-1">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                        {index + 1}
                      </span>
                      {!readOnly ? (
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                            className="text-[10px] text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            title="Move down"
                            disabled={index === questions.length - 1}
                            onClick={() => move(index, 1)}
                            className="text-[10px] text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>
                      ) : (
                        <GripVertical className="h-3.5 w-3.5 text-neutral-300" />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="text"
                      value={q.title}
                      disabled={readOnly}
                      onChange={(e) => update(q.id, { title: e.target.value })}
                      placeholder="e.g. What is your annual production capacity?"
                      className="w-full min-w-[200px] rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400 disabled:bg-neutral-50"
                    />
                    {needsOptions(q.type) ? (
                      <div className="mt-2 space-y-1.5 rounded-md border border-neutral-100 bg-neutral-50 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                          Options
                        </p>
                        {q.options.map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={opt}
                              disabled={readOnly}
                              onChange={(e) =>
                                setOption(q.id, oi, e.target.value)
                              }
                              className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] outline-none focus:border-primary-400"
                            />
                            {!readOnly && q.options.length > 2 ? (
                              <button
                                type="button"
                                onClick={() => removeOption(q.id, oi)}
                                className="text-[10px] text-danger-600"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {!readOnly ? (
                          <button
                            type="button"
                            onClick={() => addOption(q.id)}
                            className="text-[11px] font-medium text-primary-700 hover:underline"
                          >
                            + Add option
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={q.type}
                      disabled={readOnly}
                      onChange={(e) =>
                        update(q.id, {
                          type: e.target.value as RfiQuestionType,
                        })
                      }
                      className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400 disabled:bg-neutral-50"
                    >
                      {RFI_QUESTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={q.required}
                      disabled={readOnly}
                      onChange={(e) =>
                        update(q.id, { required: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="text"
                      value={q.placeholder ?? ""}
                      disabled={readOnly}
                      onChange={(e) =>
                        update(q.id, { placeholder: e.target.value })
                      }
                      placeholder="Placeholder…"
                      className="w-full min-w-[120px] rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400 disabled:bg-neutral-50"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="text"
                      value={q.help_text ?? ""}
                      disabled={readOnly}
                      onChange={(e) =>
                        update(q.id, { help_text: e.target.value })
                      }
                      placeholder="Help text…"
                      className="w-full min-w-[120px] rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400 disabled:bg-neutral-50"
                    />
                  </td>
                  {!readOnly ? (
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(q.id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-danger-600 hover:bg-danger-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
          onClick={() => onChange([...questions, createEmptyQuestion()])}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800"
        >
          <Plus className="h-4 w-4" />
          Add Question
        </button>
      ) : null}
    </div>
  );
}
