/**
 * Tests for src/cli/dump.ts — renderSessionMarkdown and renderSessionHtml.
 */
import { describe, it, expect } from "vitest";
import { renderSessionMarkdown, renderSessionHtml } from "../../src/cli/dump.js";
import { Conversation } from "../../src/core/conversation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function emptyConv(): Conversation {
  return new Conversation();
}

function basicConv(): Conversation {
  const conv = new Conversation();
  conv.addUser("Hello there");
  conv.addAssistant("Hi! How can I help?");
  return conv;
}

function toolConv(): Conversation {
  const conv = new Conversation();
  conv.addUser("Read a file for me");
  conv.addAssistant("", [{ id: "tc1", name: "file_read", arguments: '{"path":"src/foo.ts"}' }]);
  conv.addToolResult("tc1", "const x = 1;");
  conv.addAssistant("Done. The file contains: const x = 1;");
  return conv;
}

function systemConv(): Conversation {
  return new Conversation("You are a helpful assistant.");
}

// ---------------------------------------------------------------------------
// renderSessionMarkdown
// ---------------------------------------------------------------------------

describe("renderSessionMarkdown", () => {
  it("produces header with export date on empty session", () => {
    const md = renderSessionMarkdown(emptyConv());
    expect(md).toContain("# Phase2S Session");
    expect(md).toContain("Exported:");
    expect(md).toContain("---");
  });

  it("renders user and assistant messages", () => {
    const md = renderSessionMarkdown(basicConv());
    expect(md).toContain("## User");
    expect(md).toContain("Hello there");
    expect(md).toContain("## Assistant");
    expect(md).toContain("Hi! How can I help?");
  });

  it("renders tool_use as JSON fenced block", () => {
    const md = renderSessionMarkdown(toolConv());
    expect(md).toContain("## Tool Call: file_read");
    expect(md).toContain("```json");
    expect(md).toContain('"path":"src/foo.ts"');
  });

  it("renders tool result as text fenced block", () => {
    const md = renderSessionMarkdown(toolConv());
    expect(md).toContain("## Tool Result");
    expect(md).toContain("```text");
    expect(md).toContain("const x = 1;");
  });

  it("skips system messages", () => {
    const conv = systemConv();
    conv.addUser("Hey");
    const md = renderSessionMarkdown(conv);
    expect(md).not.toContain("You are a helpful assistant.");
    expect(md).toContain("Hey");
  });
});

// ---------------------------------------------------------------------------
// renderSessionHtml
// ---------------------------------------------------------------------------

describe("renderSessionHtml", () => {
  it("wraps content in valid HTML shell with pre tag", () => {
    const html = renderSessionHtml(emptyConv());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<pre>");
  });

  it("HTML-encodes angle brackets from markdown content", () => {
    const conv = new Conversation();
    conv.addUser("<script>alert(1)</script>");
    const html = renderSessionHtml(conv);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes dark mode media query", () => {
    const html = renderSessionHtml(emptyConv());
    expect(html).toContain("prefers-color-scheme: dark");
  });
});

describe("renderSessionHtml — additional encoding", () => {
  it("HTML-encodes ampersands", () => {
    const conv = new Conversation();
    conv.addUser("a & b");
    const html = renderSessionHtml(conv);
    expect(html).not.toContain("a & b");
    expect(html).toContain("a &amp; b");
  });
});
