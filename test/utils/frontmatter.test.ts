import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/utils/frontmatter.js";

describe("parseFrontmatter()", () => {
  it("parses valid YAML frontmatter and body", () => {
    const content = `---
id: apollo
title: "Research"
model: fast
tools:
  - glob
  - grep
---
You are Apollo.`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.id).toBe("apollo");
    expect(meta.title).toBe("Research");
    expect(meta.model).toBe("fast");
    expect(meta.tools).toEqual(["glob", "grep"]);
    expect(body).toBe("You are Apollo.");
  });

  it("returns empty meta and raw content when no frontmatter", () => {
    const content = "Just some text without frontmatter.";
    const { meta, body } = parseFrontmatter(content);
    expect(meta).toEqual({});
    expect(body).toBe(content);
  });

  it("returns empty meta and raw content when frontmatter is malformed YAML", () => {
    const content = `---
id: [unclosed bracket
---
Body text.`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta).toEqual({});
    // Malformed YAML falls back to raw content
    expect(body).toBe(content);
  });

  it("trims leading/trailing whitespace from body", () => {
    const content = `---
id: test
---

  Body with leading whitespace.  `;
    const { meta, body } = parseFrontmatter(content);
    expect(body).toBe("Body with leading whitespace.");
  });

  it("handles empty body", () => {
    const content = `---
id: empty
---
`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.id).toBe("empty");
    expect(body).toBe("");
  });

  it("handles frontmatter with no tools field", () => {
    const content = `---
id: ares
title: "Implement"
model: smart
---
Full registry agent.`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.tools).toBeUndefined();
    expect(meta.id).toBe("ares");
    expect(body).toBe("Full registry agent.");
  });

  it("handles aliases field as YAML list", () => {
    const content = `---
id: apollo
aliases:
  - ":ask"
---
System prompt.`;
    const { meta } = parseFrontmatter(content);
    expect(meta.aliases).toEqual([":ask"]);
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\nid: crlf\r\n---\r\nBody line.";
    const { meta, body } = parseFrontmatter(content);
    expect(meta.id).toBe("crlf");
    expect(body).toBe("Body line.");
  });

  it("returns typed meta values correctly", () => {
    const content = `---
id: typed
number: 42
flag: true
---
Body.`;
    const { meta } = parseFrontmatter(content);
    expect(meta.id).toBe("typed");
    expect(meta.number).toBe(42);
    expect(meta.flag).toBe(true);
  });
});
