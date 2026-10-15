import type { ECRComment } from "../../../api/ecr";
import { formatECRNumber } from "../../../config/ecrRoles";
import type { EngineeringChangeRequest } from "../../../types/erpnext";

export interface EngineerECRActivityEvent {
  id: string;
  ecrNumber: string;
  content: string;
  timestamp: string;
  time: number;
}

function eventTime(value?: string): number {
  if (!value) return Number.NaN;
  return new Date(value.includes("T") ? value : value.replace(" ", "T")).getTime();
}

/** Keep activity reads bounded to the five latest records in the caller's scope. */
export function selectECRActivityRecords(ecrs: EngineeringChangeRequest[]): EngineeringChangeRequest[] {
  const unique = new Map(ecrs.filter((ecr) => ecr.name).map((ecr) => [ecr.name, ecr]));
  return [...unique.values()].sort((left, right) => {
    const leftTime = eventTime(left.modified || left.creation);
    const rightTime = eventTime(right.modified || right.creation);
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
      || left.name.localeCompare(right.name);
  }).slice(0, 5);
}

/** ERPNext comments may contain markup; the timeline only renders plain text. */
export function ecrActivityPlainText(value: string): string {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  };
  return String(value || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (!code.startsWith("#")) return entities[code.toLowerCase()] || entity;
      const hex = code.toLowerCase().startsWith("#x");
      const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Use recorded comment timestamps and content, never inferred workflow events. */
export function buildECRActivityEvents(
  records: Array<{ ecr: EngineeringChangeRequest; comments: ECRComment[] }>,
): EngineerECRActivityEvent[] {
  const events = new Map<string, EngineerECRActivityEvent>();
  for (const { ecr, comments } of records) {
    for (const comment of comments) {
      const content = ecrActivityPlainText(comment.content);
      const time = eventTime(comment.creation);
      if (!content || !Number.isFinite(time)) continue;
      const id = `${ecr.name}:${comment.name}`;
      events.set(id, {
        id,
        ecrNumber: formatECRNumber(ecr),
        content,
        timestamp: comment.creation.includes("T") ? comment.creation : comment.creation.replace(" ", "T"),
        time,
      });
    }
  }
  return [...events.values()].sort((left, right) => right.time - left.time || left.id.localeCompare(right.id)).slice(0, 5);
}
