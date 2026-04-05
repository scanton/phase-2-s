/**
 * Notification gateway.
 *
 * Sends a post-run notification via:
 * 1. macOS system notification (osascript, zero deps, macOS-only)
 * 2. Slack webhook (PHASE2S_SLACK_WEBHOOK env var or config, uses native fetch)
 *
 * Both channels are fail-safe: errors are logged to stderr but never thrown.
 * Notifications should never block or fail a dark factory run.
 */

import { spawnSync } from "node:child_process";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyOptions {
  /** Show macOS system notification. Defaults to true on darwin, false elsewhere. */
  mac?: boolean;
  /** Slack incoming webhook URL. Overrides PHASE2S_SLACK_WEBHOOK env var. */
  slack?: string;
}

export interface NotifyPayload {
  /** Short title line shown in the notification. */
  title: string;
  /** Optional body / subtitle text. */
  body?: string;
  /** true = success run, false = failure or challenge. */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a notification via all configured channels.
 * Errors from any channel are logged to stderr and do not propagate.
 */
export async function sendNotification(
  payload: NotifyPayload,
  options: NotifyOptions = {},
): Promise<void> {
  const useMac = options.mac ?? process.platform === "darwin";
  const slackUrl = options.slack ?? process.env.PHASE2S_SLACK_WEBHOOK;

  const promises: Promise<void>[] = [];
  if (useMac) promises.push(sendMacNotification(payload));
  if (slackUrl) promises.push(sendSlackNotification(payload, slackUrl));

  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[phase2s notify] ${String(result.reason)}`);
    }
  }
}

/**
 * Build a notification payload from a completed dark factory run.
 */
export function buildNotifyPayload(
  specFile: string,
  success: boolean,
  attempts: number,
  challenged: boolean,
  durationMs?: number,
): NotifyPayload {
  // Strip path and .md extension for a clean display name
  const name = basename(specFile).replace(/\.md$/i, "");
  const durationStr = durationMs !== undefined ? ` (${formatDurationMs(durationMs)})` : "";
  const attemptsStr = `${attempts} attempt${attempts !== 1 ? "s" : ""}`;

  if (challenged) {
    return {
      title: `⚠ ${name}: CHALLENGED — review required`,
      success: false,
    };
  }

  if (success) {
    return {
      title: `✓ ${name}: complete`,
      body: `${attemptsStr}${durationStr}`,
      success: true,
    };
  }

  return {
    title: `✗ ${name}: failed`,
    body: `${attemptsStr}${durationStr}`,
    success: false,
  };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

async function sendMacNotification(payload: NotifyPayload): Promise<void> {
  const message = payload.body
    ? `${payload.title}\n${payload.body}`
    : payload.title;
  const script = `display notification ${JSON.stringify(message)} with title "Phase2S"`;
  const result = spawnSync("osascript", ["-e", script]);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`osascript exited ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }
}

async function sendSlackNotification(payload: NotifyPayload, webhookUrl: string): Promise<void> {
  const icon = payload.success ? ":white_check_mark:" : ":x:";
  const text = payload.body
    ? `${icon} *${payload.title}*\n${payload.body}`
    : `${icon} *${payload.title}*`;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status} ${response.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
