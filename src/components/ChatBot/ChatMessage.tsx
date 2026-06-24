import { type ReactNode, useMemo } from "react";

const ACCENT = "#0284c7";
const ACCENT_LIGHT = "#f0f9ff";
const ACCENT_BORDER = "#bae6fd";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineBold(text: string, boldColor = "#111"): string {
  return escapeHtml(text).replace(
    /\*\*(.*?)\*\*/g,
    `<b style="color:${boldColor}">$1</b>`
  );
}

function extractLeadingEmoji(line: string): { emoji: string; text: string } {
  const match = line.match(/^([\u{1F300}-\u{1F9FF}\u2600-\u27BF\uFE0F\u200D]+)\s*/u);
  if (!match) return { emoji: "", text: line };
  return {
    emoji: match[1],
    text: line.slice(match[0].length).trim(),
  };
}

function parseMarkdownTable(tableLines: string[]): ReactNode | null {
  if (tableLines.length < 2) return null;

  const rows = tableLines.filter((l) => !/^\|[-|\s]+\|$/.test(l.trim()));
  if (rows.length < 1) return null;

  const parseRow = (row: string) =>
    row
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

  const headers = parseRow(rows[0]);
  const dataRows = rows.slice(1).map(parseRow).filter((r) => r.length > 0);

  if (headers.length === 0) return null;

  return (
    <div style={{ overflowX: "auto", margin: "10px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "12px",
          background: "white",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <thead>
          <tr style={{ background: ACCENT_LIGHT }}>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: ACCENT,
                  borderBottom: `2px solid ${ACCENT_BORDER}`,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                borderBottom: "1px solid #f3f4f6",
                background: ri % 2 === 0 ? "white" : "#fafafa",
              }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "8px 12px",
                    fontSize: "12px",
                    color: cell.includes("Overdue")
                      ? "#dc2626"
                      : cell.includes("Paid")
                      ? "#16a34a"
                      : cell.includes("Submitted")
                      ? "#0284c7"
                      : "#374151",
                    fontWeight: cell.includes("Overdue") ? 600 : 400,
                  }}
                >
                  {cell.includes("Overdue")
                    ? `⚠️ ${cell}`
                    : cell.includes("Paid")
                    ? `✅ ${cell}`
                    : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdownContent(text: string): ReactNode[] {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let tableLines: string[] = [];
  let inTable = false;
  let key = 0;

  const flushTable = () => {
    if (tableLines.length >= 2) {
      const table = parseMarkdownTable(tableLines);
      if (table) elements.push(<div key={key++}>{table}</div>);
    }
    tableLines = [];
    inTable = false;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("|")) {
      inTable = true;
      tableLines.push(line);
      continue;
    }
    if (inTable) flushTable();

    if (line.startsWith("## ")) {
      const raw = line.replace(/^##\s*/, "");
      const { emoji, text: heading } = extractLeadingEmoji(raw);
      elements.push(
        <div
          key={key++}
          style={{
            fontSize: "15px",
            fontWeight: 700,
            color: "#111",
            marginTop: "16px",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            borderBottom: `2px solid ${ACCENT_LIGHT}`,
            paddingBottom: "6px",
          }}
        >
          {emoji && <span>{emoji}</span>}
          <span>{heading}</span>
        </div>
      );
      continue;
    }

    if (line.startsWith("### ")) {
      const raw = line.replace(/^###\s*/, "");
      const { emoji, text: heading } = extractLeadingEmoji(raw);
      elements.push(
        <div
          key={key++}
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: ACCENT,
            marginTop: "12px",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {emoji && <span>{emoji}</span>}
          <span>{heading}</span>
        </div>
      );
      continue;
    }

    if (line.startsWith("• ") || line.startsWith("- ") || line.startsWith("* ")) {
      const bulletText = line.replace(/^[•\-*]\s*/, "");
      elements.push(
        <div
          key={key++}
          style={{
            display: "flex",
            gap: "8px",
            padding: "3px 0",
            fontSize: "13px",
            color: "#374151",
          }}
        >
          <span style={{ color: ACCENT, fontWeight: 700, flexShrink: 0 }}>•</span>
          <span
            dangerouslySetInnerHTML={{ __html: inlineBold(bulletText) }}
          />
        </div>
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1];
      const numberedText = line.replace(/^\d+\.\s*/, "");
      elements.push(
        <div
          key={key++}
          style={{
            display: "flex",
            gap: "8px",
            padding: "4px 0",
            fontSize: "13px",
            color: "#374151",
            alignItems: "flex-start",
          }}
        >
          <span
            style={{
              background: ACCENT,
              color: "white",
              borderRadius: "50%",
              width: "18px",
              height: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {num}
          </span>
          <span
            dangerouslySetInnerHTML={{ __html: inlineBold(numberedText) }}
          />
        </div>
      );
      continue;
    }

    if (line.includes("⚠️") || line.includes("🚨") || line.includes("❌")) {
      elements.push(
        <div
          key={key++}
          style={{
            background: "#fff5f5",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "13px",
            color: "#dc2626",
            margin: "4px 0",
            fontWeight: 500,
          }}
        >
          {line}
        </div>
      );
      continue;
    }

    if (line.includes("✅") || line.includes("✓")) {
      elements.push(
        <div
          key={key++}
          style={{
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "13px",
            color: "#15803d",
            margin: "4px 0",
            fontWeight: 500,
          }}
        >
          {line}
        </div>
      );
      continue;
    }

    if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(
        <div
          key={key++}
          style={{
            background: ACCENT_LIGHT,
            borderLeft: `3px solid ${ACCENT}`,
            padding: "8px 12px",
            borderRadius: "0 8px 8px 0",
            fontSize: "13px",
            fontWeight: 700,
            color: ACCENT,
            margin: "6px 0",
          }}
        >
          {line.replace(/\*\*/g, "")}
        </div>
      );
      continue;
    }

    if (line.startsWith("---") || line.startsWith("___")) {
      elements.push(
        <hr
          key={key++}
          style={{
            border: "none",
            borderTop: "1px solid #e5e7eb",
            margin: "10px 0",
          }}
        />
      );
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={key++} style={{ height: "4px" }} />);
      continue;
    }

    elements.push(
      <div
        key={key++}
        style={{
          fontSize: "13px",
          color: "#374151",
          lineHeight: "1.6",
          padding: "1px 0",
        }}
      >
        <span
          dangerouslySetInnerHTML={{ __html: inlineBold(line) }}
        />
      </div>
    );
  }

  if (inTable) flushTable();

  return elements;
}

interface Props {
  content: string;
  variant?: "assistant" | "user";
}

export default function ChatMessage({ content, variant = "assistant" }: Props) {
  const elements = useMemo(() => renderMarkdownContent(content), [content]);

  if (variant === "user") {
    return (
      <div style={{ fontSize: "13px", lineHeight: "1.6", color: "white" }}>
        {content}
      </div>
    );
  }

  return <div>{elements}</div>;
}
