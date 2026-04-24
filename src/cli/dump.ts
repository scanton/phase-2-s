/**
 * Conversation export utilities for :dump REPL command.
 *
 * renderSessionMarkdown() — produces a plain-text markdown transcript.
 * renderSessionHtml()     — wraps the markdown in a self-contained HTML page.
 *   HTML encoding only (no markdown-to-HTML conversion); the markdown text is
 *   placed in a <pre> block. A future sprint can add `marked` for rendered code.
 */

import type { Conversation } from "../core/conversation.js";

// ---------------------------------------------------------------------------
// renderSessionMarkdown

export function renderSessionMarkdown(conv: Conversation): string {
  const messages = conv.getMessages();
  const date = new Date().toUTCString();
  let md = `# Phase2S Session\n\nExported: ${date}\n\n---\n\n`;

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      md += `## User\n\n${(msg.content ?? "").replace(/`/g, "\\`")}\n\n---\n\n`;
    } else if (msg.role === "assistant") {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        if (msg.content) {
          md += `## Assistant\n\n${msg.content.replace(/`/g, "\\`")}\n\n`;
        }
        for (const call of msg.toolCalls) {
          md += `## Tool Call: ${call.name}\n\n\`\`\`json\n${(call.arguments ?? "").replace(/`/g, "\\`")}\n\`\`\`\n\n`;
        }
        md += `---\n\n`;
      } else {
        md += `## Assistant\n\n${(msg.content ?? "").replace(/`/g, "\\`")}\n\n---\n\n`;
      }
    } else if (msg.role === "tool") {
      md += `## Tool Result\n\n\`\`\`text\n${(msg.content ?? "").replace(/`/g, "\\`")}\n\`\`\`\n\n---\n\n`;
    }
  }

  return md;
}

// ---------------------------------------------------------------------------
// renderSessionHtml

export function renderSessionHtml(conv: Conversation): string {
  const md = renderSessionMarkdown(conv);
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Phase2S Session Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
      background: #fff;
      color: #1a1a1a;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e8e8e8; }
    }
  </style>
</head>
<body>
<pre>${escaped}</pre>
</body>
</html>
`;
}
