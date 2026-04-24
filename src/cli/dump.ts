/**
 * Conversation export utilities for :dump REPL command.
 *
 * renderSessionMarkdown() — produces a plain-text markdown transcript.
 * renderSessionHtml()     — renders the markdown to a self-contained HTML page
 *   using `marked` for proper headings, fenced code blocks, and readable structure.
 */

import { marked } from "marked";
import type { Conversation } from "../core/conversation.js";

// Strip images — conversation transcripts have no legitimate images, and
// <img src="https://..."> in AI response markdown would make the browser issue
// outbound requests when the export auto-opens. Render alt text instead.
marked.use({ renderer: { image: ({ text }: { text: string }) => text } });

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

  // Escape raw HTML in the markdown source so inline tags from message content
  // (e.g. <script>, <img>) don't execute in the exported file. marked passes
  // through raw HTML by default; escaping at this layer keeps the export safe.
  const safeMd = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let body = marked(safeMd, { async: false });

  // Neutralize any href/src that isn't a safe protocol. Allowlist approach
  // catches javascript:, vbscript:, data:text/html, file://, and future
  // schemes without needing a per-protocol denylist.
  body = body.replace(/(\s(?:href|src))="(?!https?:|mailto:|#)[^"]*"/gi, '$1="#"');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Phase2S Session Export</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    h1, h2 { margin-top: 1.5em; }
    h2 { border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
    pre { background: #f6f8fa; border-radius: 6px; padding: 16px;
          overflow-x: auto; font-size: 13px; }
    code { font-family: "SF Mono","Fira Code","Cascadia Code",monospace; }
    p > code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e8e8e8; }
      pre  { background: #2d2d2d; }
      h2   { border-bottom-color: #444; }
      hr   { border-top-color: #444; }
      p > code { background: #333; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
