import { describe, expect, it } from "vitest";

import { extractPlainTextFromJiraDescriptionField } from "../description-text";

describe("extractPlainTextFromJiraDescriptionField", () => {
  it("returns trimmed string as-is", () => {
    expect(extractPlainTextFromJiraDescriptionField("  hello  ")).toBe("hello");
  });

  it("returns null for empty string", () => {
    expect(extractPlainTextFromJiraDescriptionField("   ")).toBeNull();
  });

  it("returns null for empty ADF doc", () => {
    expect(
      extractPlainTextFromJiraDescriptionField({
        type: "doc",
        version: 1,
        content: [],
      }),
    ).toBeNull();
  });

  it("extracts text from ADF paragraphs", () => {
    expect(
      extractPlainTextFromJiraDescriptionField({
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Line one" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Line two" }],
          },
        ],
      }),
    ).toBe("Line one\nLine two");
  });

  it("handles headings and hard breaks", () => {
    expect(
      extractPlainTextFromJiraDescriptionField({
        type: "doc",
        version: 1,
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "hardBreak" },
              { type: "text", text: "b" },
            ],
          },
        ],
      }),
    ).toContain("Title");
  });
});
