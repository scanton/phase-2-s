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
// renderSessionHtml — structure
// ---------------------------------------------------------------------------

describe("renderSessionHtml — structure", () => {
  it("returns valid HTML shell", () => {
    const html = renderSessionHtml(emptyConv());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("renders ## headings as <h2> tags (not <pre>)", () => {
    const html = renderSessionHtml(basicConv());
    expect(html).toContain("<h2>");
    expect(html).not.toContain("<pre># Phase2S");
  });

  it("renders # heading as <h1>", () => {
    const html = renderSessionHtml(emptyConv());
    expect(html).toContain("<h1>");
  });

  it("renders --- separators as <hr>", () => {
    const html = renderSessionHtml(basicConv());
    expect(html).toContain("<hr");
  });

  it("renders fenced code blocks as <pre><code>", () => {
    const html = renderSessionHtml(toolConv());
    expect(html).toContain("<pre>");
    // marked adds class attributes: <code class="language-json">
    expect(html).toContain("<code");
  });

  it("includes dark mode media query", () => {
    const html = renderSessionHtml(emptyConv());
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("contains no CDN or external asset links", () => {
    const html = renderSessionHtml(toolConv());
    expect(html).not.toMatch(/https?:\/\/(?!.*\bExported\b)/);
  });
});

// ---------------------------------------------------------------------------
// renderSessionHtml — sanitization
// ---------------------------------------------------------------------------

describe("renderSessionHtml — sanitization", () => {
  it("HTML-encodes angle brackets from message content", () => {
    const conv = new Conversation();
    conv.addUser("<script>alert(1)</script>");
    const html = renderSessionHtml(conv);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("HTML-encodes ampersands from message content", () => {
    const conv = new Conversation();
    conv.addUser("a & b");
    const html = renderSessionHtml(conv);
    expect(html).toContain("&amp;");
    expect(html).not.toContain(" & b");
  });

  it("neutralizes javascript: hrefs in message content", () => {
    const conv = new Conversation();
    conv.addUser("[click me](javascript:alert(1))");
    const html = renderSessionHtml(conv);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("href=\"javascript:");
  });

  it("preserves normal https links unmodified", () => {
    const conv = new Conversation();
    conv.addAssistant("See https://example.com for details.");
    const html = renderSessionHtml(conv);
    // https URLs in plain text are rendered as text, not stripped
    expect(html).toContain("example.com");
  });
});

// ---------------------------------------------------------------------------
// renderSessionHtml — content rendering
// ---------------------------------------------------------------------------

describe("renderSessionHtml — content rendering", () => {
  it("renders user message content inside h2 section", () => {
    const html = renderSessionHtml(basicConv());
    expect(html).toContain("Hello there");
    expect(html).toContain("Hi! How can I help?");
  });

  it("renders tool call name in h2", () => {
    const html = renderSessionHtml(toolConv());
    expect(html).toContain("file_read");
  });

  it("renders tool result content inside pre/code block", () => {
    const html = renderSessionHtml(toolConv());
    // Tool result is in a fenced code block → becomes <pre><code>
    expect(html).toContain("const x = 1;");
  });

  it("empty session produces valid HTML with h1", () => {
    const html = renderSessionHtml(emptyConv());
    expect(html).toContain("<h1>");
    expect(html).toContain("Phase2S Session");
  });
});
