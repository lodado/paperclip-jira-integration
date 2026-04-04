/**
 * Jira Cloud REST often returns `fields.description` as Atlassian Document Format (ADF).
 * Paperclip agents need plain text; this extracts readable text for sync payloads.
 */
export function extractPlainTextFromJiraDescriptionField(
  value: unknown,
): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const o = value as Record<string, unknown>;
  if (o.type === "doc") {
    if (!Array.isArray(o.content) || o.content.length === 0) {
      return null;
    }
    const text = extractAdfTextFromNodes(o.content).trim();
    return text ? text : null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractAdfTextFromNodes(nodes: unknown[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const n = node as Record<string, unknown>;
    const t = n.type;

    if (t === "text" && typeof n.text === "string") {
      parts.push(n.text);
      continue;
    }

    if (t === "hardBreak") {
      parts.push("\n");
      continue;
    }

    if (Array.isArray(n.content)) {
      const inner = extractAdfTextFromNodes(n.content);
      if (
        t === "paragraph" ||
        t === "heading" ||
        t === "listItem" ||
        t === "blockquote" ||
        t === "codeBlock"
      ) {
        parts.push(inner.trim() ? `${inner.trim()}\n` : "");
      } else {
        parts.push(inner);
      }
    }
  }

  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
