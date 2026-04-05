/**
 * Browser tool — headless Chromium via Playwright.
 *
 * Security model:
 *   - HTTP/HTTPS: allowed to localhost/127.0.0.1 (dev servers) and public internet.
 *   - Private IP ranges (RFC 1918 + link-local) are blocked — SSRF prevention.
 *   - file:// URLs: allowed only within the project sandbox (assertInSandbox).
 *   - All other schemes (chrome://, data://, etc.) are blocked.
 *
 * Page lifecycle: single active-page model. Each `navigate` closes the previous
 * page and opens a fresh one. No page IDs — always one page, always deterministic.
 *
 * Screenshot output: saved to .phase2s/screenshots/<ts>-<slug>.png. The tool
 * returns the file path + a base64 thumbnail (800x600 viewport) so the
 * model gets visual signal without bloating the context window.
 *
 * Playwright is loaded lazily at first use. If it is not installed the tool
 * returns a clear actionable error instead of crashing at import time.
 */

import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import type { ToolDefinition, ToolResult } from "./types.js";
import { assertInSandbox } from "./sandbox.js";

// ---------------------------------------------------------------------------
// Private IP range blocking (SSRF prevention)
// ---------------------------------------------------------------------------

/** IPv4 ranges blocked to prevent SSRF to internal infrastructure. */
const BLOCKED_CIDR_PATTERNS = [
  /^10\.\d+\.\d+\.\d+$/,                        // RFC 1918: 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,        // RFC 1918: 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,                        // RFC 1918: 192.168.0.0/16
  /^169\.254\.\d+\.\d+$/,                        // Link-local / AWS metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // RFC 6598 shared address
  /^127\.\d+\.\d+\.\d+$/,                        // Loopback (except localhost exception below)
  /^0\.0\.0\.0$/,                                // Unspecified
  /^::1$/,                                       // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,                            // IPv6 ULA fc00::/7
  /^fe[89ab][0-9a-f]:/i,                         // IPv6 link-local fe80::/10
];

/**
 * Return a reason string if the URL should be blocked, or null if allowed.
 *
 * Localhost (127.0.0.1 / ::1 / "localhost" hostname) is explicitly allowed
 * because dev servers on localhost are the primary use case.
 */
export function getUrlBlockReason(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }

  const scheme = parsed.protocol.replace(":", "");

  // Allow file:// (sandbox check happens separately)
  if (scheme === "file") return null;

  // Only http and https for network URLs
  if (scheme !== "http" && scheme !== "https") {
    return `Scheme '${scheme}' is not allowed. Only http, https, and file are supported.`;
  }

  const hostname = parsed.hostname;

  // Explicit localhost allowlist — dev servers are the point of this tool
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return null;
  }

  // Block private/reserved IP ranges
  for (const pattern of BLOCKED_CIDR_PATTERNS) {
    if (pattern.test(hostname)) {
      return `URL blocked: '${hostname}' is in a reserved/private address range. Only localhost and public addresses are allowed.`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Browser session (single active-page model)
// ---------------------------------------------------------------------------

interface BrowserSession {
  browser: import("playwright").Browser;
  page: import("playwright").Page | null;
}

let _session: BrowserSession | null = null;

async function getPlaywright(): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "Browser tool requires Playwright. Install it with:\n" +
      "  npm install -g playwright\n" +
      "  npx playwright install chromium\n" +
      "Then restart Phase2S.",
    );
  }
}

async function getSession(): Promise<BrowserSession> {
  if (!_session) {
    const pw = await getPlaywright();
    const browser = await pw.chromium.launch({ headless: true });
    _session = { browser, page: null };
  }
  return _session;
}

/** Navigate to a URL. Closes the previous page and opens a fresh one. */
async function navigateTo(url: string, cwd: string): Promise<ToolResult> {
  // URL security check
  const blockReason = getUrlBlockReason(url);
  if (blockReason) {
    return { success: false, output: "", error: blockReason };
  }

  // Sandbox check for file:// URLs
  if (url.startsWith("file://")) {
    const filePath = url.replace("file://", "");
    try {
      await assertInSandbox(filePath, cwd);
    } catch (err) {
      return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
    }
  }

  const session = await getSession();

  // Single active-page model: close previous page before opening a new one
  if (session.page && !session.page.isClosed()) {
    await session.page.close();
  }

  const page = await session.browser.newPage();
  session.page = page;

  const consoleErrors: string[] = [];
  page.on("console", (msg: import("playwright").ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = await page.title();
    const status = response?.status() ?? 0;

    const lines: string[] = [
      `Navigated to: ${url}`,
      `Title: ${title}`,
      `Status: ${status}`,
    ];
    if (consoleErrors.length > 0) {
      lines.push("", "Console errors:", ...consoleErrors.map((e) => `  ERROR: ${e}`));
    }

    return { success: true, output: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Navigation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Take a screenshot. Saves to .phase2s/screenshots/ and returns the path + viewport thumbnail. */
async function takeScreenshot(cwd: string, label?: string): Promise<ToolResult> {
  const session = await getSession();
  if (!session.page || session.page.isClosed()) {
    return { success: false, output: "", error: "No active page. Call navigate first." };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const slug = (label ?? "screenshot").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
  const filename = `${ts}-${slug}.png`;
  const screenshotsDir = resolve(cwd, ".phase2s", "screenshots");
  const fullPath = join(screenshotsDir, filename);
  const relPath = relative(cwd, fullPath);

  await mkdir(screenshotsDir, { recursive: true });

  // Full screenshot (saves to disk)
  const fullBuffer = await session.page.screenshot({ fullPage: false });
  await writeFile(fullPath, fullBuffer);

  // Viewport thumbnail (800x600) returned inline as base64 for model inspection
  const thumbBuffer = await session.page.screenshot({
    fullPage: false,
    clip: { x: 0, y: 0, width: 800, height: 600 },
  });
  const thumbB64 = thumbBuffer.toString("base64");

  const lines = [
    `Screenshot saved: ${relPath}`,
    `Full path: ${fullPath}`,
    ``,
    `Thumbnail (800x600 viewport, base64 PNG — use for visual inspection):`,
    `data:image/png;base64,${thumbB64}`,
  ];

  return { success: true, output: lines.join("\n") };
}

async function getContent(): Promise<ToolResult> {
  const session = await getSession();
  if (!session.page || session.page.isClosed()) {
    return { success: false, output: "", error: "No active page. Call navigate first." };
  }
  const content = await session.page.content();
  return { success: true, output: content };
}

async function clickElement(selector: string): Promise<ToolResult> {
  const session = await getSession();
  if (!session.page || session.page.isClosed()) {
    return { success: false, output: "", error: "No active page. Call navigate first." };
  }
  try {
    await session.page.click(selector, { timeout: 10_000 });
    return { success: true, output: `Clicked: ${selector}` };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Click failed on '${selector}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function typeInto(selector: string, text: string): Promise<ToolResult> {
  const session = await getSession();
  if (!session.page || session.page.isClosed()) {
    return { success: false, output: "", error: "No active page. Call navigate first." };
  }
  try {
    await session.page.fill(selector, text, { timeout: 10_000 });
    return { success: true, output: `Typed into '${selector}': ${text}` };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Type failed on '${selector}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function evaluateScript(script: string): Promise<ToolResult> {
  const session = await getSession();
  if (!session.page || session.page.isClosed()) {
    return { success: false, output: "", error: "No active page. Call navigate first." };
  }
  try {
    const result = await session.page.evaluate(script);
    return { success: true, output: String(result) };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function closeBrowserSession(): Promise<ToolResult> {
  if (_session) {
    await _session.browser.close();
    _session = null;
  }
  return { success: true, output: "Browser session closed." };
}

/** Called at process exit to clean up any lingering chromium process. */
export async function disposeBrowser(): Promise<void> {
  if (_session) {
    try {
      await _session.browser.close();
    } catch { /* best-effort */ }
    _session = null;
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const params = z.object({
  action: z.enum(["navigate", "screenshot", "click", "type", "evaluate", "content", "close"])
    .describe("Browser action to perform"),
  url: z.string().optional()
    .describe("URL for navigate action (http/https/file). Required for navigate."),
  selector: z.string().optional()
    .describe("CSS selector or accessible text for click/type actions"),
  text: z.string().optional()
    .describe("Text to type into the selected element"),
  script: z.string().optional()
    .describe("JavaScript expression to evaluate in the page context"),
  label: z.string().optional()
    .describe("Label for the screenshot filename (e.g. 'homepage', 'after-login')"),
});

export function createBrowserTool(cwd: string): ToolDefinition {
  return {
    name: "browser",
    description:
      "Control a headless Chromium browser. Navigate to URLs, click elements, fill forms, " +
      "take screenshots, and evaluate JavaScript. Use for QA, visual inspection, and " +
      "testing running web applications. Localhost dev servers are supported.",
    parameters: params,
    async execute(rawParams: unknown): Promise<ToolResult> {
      const parsed = params.safeParse(rawParams);
      if (!parsed.success) {
        return { success: false, output: "", error: `Invalid parameters: ${parsed.error.message}` };
      }

      const { action, url, selector, text, script, label } = parsed.data;

      switch (action) {
        case "navigate": {
          if (!url) return { success: false, output: "", error: "url is required for navigate" };
          return navigateTo(url, cwd);
        }
        case "screenshot":
          return takeScreenshot(cwd, label);
        case "click": {
          if (!selector) return { success: false, output: "", error: "selector is required for click" };
          return clickElement(selector);
        }
        case "type": {
          if (!selector) return { success: false, output: "", error: "selector is required for type" };
          if (!text) return { success: false, output: "", error: "text is required for type" };
          return typeInto(selector, text);
        }
        case "evaluate": {
          if (!script) return { success: false, output: "", error: "script is required for evaluate" };
          return evaluateScript(script);
        }
        case "content":
          return getContent();
        case "close":
          return closeBrowserSession();
        default:
          return { success: false, output: "", error: `Unknown action: ${action as string}` };
      }
    },
  };
}
