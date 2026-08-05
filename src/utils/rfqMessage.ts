import { formatERPNextDate } from "./erpNextDate";

/** Parse RFQ `message_for_supplier` header (Title / Valid Till). */
export function parseRfqMessage(message: string | undefined | null): {
  title?: string;
  validTill?: string;
  body: string;
} {
  if (!message) return { body: "" };

  const lines = message.split(/\r?\n/);
  let title: string | undefined;
  let validTill: string | undefined;
  let firstBodyLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      firstBodyLine = i + 1;
      break;
    }
    const titleMatch = trimmed.match(/^Title\s*:\s*(.+)$/i);
    if (titleMatch && !title) {
      title = titleMatch[1].trim();
      firstBodyLine = i + 1;
      continue;
    }
    const validMatch = trimmed.match(/^Valid\s*Till\s*:\s*(.+)$/i);
    if (validMatch && !validTill) {
      const rawValidTill = validMatch[1].trim();
      validTill = formatERPNextDate(rawValidTill) ?? rawValidTill;
      firstBodyLine = i + 1;
      continue;
    }
    if (!title && !validTill) {
      firstBodyLine = i;
    }
    break;
  }

  return {
    title,
    validTill,
    body: lines.slice(firstBodyLine).join("\n").trim(),
  };
}

export function rebuildRfqMessage(input: {
  title?: string;
  validTill?: string;
  body?: string;
}): string {
  const header: string[] = [];
  if (input.title?.trim()) header.push(`Title: ${input.title.trim()}`);
  if (input.validTill?.trim()) header.push(`Valid Till: ${input.validTill.trim()}`);
  const body = (input.body ?? "").trim();
  if (!header.length) return body;
  if (!body) return header.join("\n");
  return `${header.join("\n")}\n\n${body}`;
}
