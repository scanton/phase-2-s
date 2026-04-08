/**
 * Notification gateway.
 *
 * Sends a post-run notification via:
 * 1. macOS system notification (osascript, zero deps, macOS-only)
 * 2. Slack webhook (PHASE2S_SLACK_WEBHOOK env var or config, uses native fetch)
 * 3. Discord webhook (PHASE2S_DISCORD_WEBHOOK env var or config, uses native fetch)
 * 4. Microsoft Teams webhook (PHASE2S_TEAMS_WEBHOOK env var or config, uses native fetch)
 * 5. Telegram bot (PHASE2S_TELEGRAM_BOT_TOKEN + PHASE2S_TELEGRAM_CHAT_ID env vars or config)
 *
 * All channels are fail-safe: errors are logged to stderr but never thrown.
 * Notifications should never block or fail a dark factory run.
 */

import { spawnSync } from "node:child_process";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramOptions {
  /** Bot token from BotFather (e.g. "123456:ABC-DEF..."). */
  token: string;
  /** Chat ID to send to (e.g. "-1001234567890"). */
  chatId: string;
}

export interface NotifyOptions {
  /** Show macOS system notification. Defaults to true on darwin, false elsewhere. */
  mac?: boolean;
  /** Slack incoming webhook URL. Overrides PHASE2S_SLACK_WEBHOOK env var. */
  slack?: string;
  /** Discord incoming webhook URL. Overrides PHASE2S_DISCORD_WEBHOOK env var. */
  discord?: string;
  /** Microsoft Teams incoming webhook URL. Overrides PHASE2S_TEAMS_WEBHOOK env var. */
  teams?: string;
  /** Telegram bot token + chat ID. Overrides PHASE2S_TELEGRAM_BOT_TOKEN / PHASE2S_TELEGRAM_CHAT_ID env vars. */
  telegram?: TelegramOptions;
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
  const discordUrl = options.discord ?? process.env.PHASE2S_DISCORD_WEBHOOK;
  const teamsUrl = options.teams ?? process.env.PHASE2S_TEAMS_WEBHOOK;

  // Telegram: prefer explicit options, fall back to env vars
  const telegramToken = options.telegram?.token ?? process.env.PHASE2S_TELEGRAM_BOT_TOKEN;
  const telegramChatId = options.telegram?.chatId ?? process.env.PHASE2S_TELEGRAM_CHAT_ID;
  const telegramOpts: TelegramOptions | undefined =
    (telegramToken && telegramChatId)
      ? { token: telegramToken, chatId: telegramChatId }
      : undefined;

  const promises: Promise<void>[] = [];
  if (useMac) promises.push(sendMacNotification(payload));
  if (slackUrl) promises.push(sendSlackNotification(payload, slackUrl));
  if (discordUrl) promises.push(sendDiscordNotification(payload, discordUrl));
  if (teamsUrl) promises.push(sendTeamsNotification(payload, teamsUrl));
  if (telegramOpts) promises.push(sendTelegramNotification(payload, telegramOpts));

  if (promises.length === 0) {
    console.warn(
      "[phase2s notify] --notify set but no channels are active." +
      " Set PHASE2S_SLACK_WEBHOOK, PHASE2S_DISCORD_WEBHOOK, PHASE2S_TEAMS_WEBHOOK," +
      " or PHASE2S_TELEGRAM_BOT_TOKEN + PHASE2S_TELEGRAM_CHAT_ID" +
      " for cross-platform notifications.",
    );
    return;
  }

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

async function sendDiscordNotification(payload: NotifyPayload, webhookUrl: string): Promise<void> {
  // Use embeds for rich formatting: green (#2ECC71) on success, red (#E74C3C) on failure
  const color = payload.success ? 0x2ECC71 : 0xE74C3C;
  const embed: Record<string, unknown> = { title: payload.title, color };
  if (payload.body) embed.description = payload.body;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook returned ${response.status} ${response.statusText}`);
  }
}

async function sendTeamsNotification(payload: NotifyPayload, webhookUrl: string): Promise<void> {
  // MessageCard format — supported by all Teams incoming webhook connectors
  const themeColor = payload.success ? "2ECC71" : "E74C3C";
  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor,
    summary: payload.title,
    title: payload.title,
  };
  if (payload.body) card.text = payload.body;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  if (!response.ok) {
    throw new Error(`Teams webhook returned ${response.status} ${response.statusText}`);
  }
}

/** Timeout in ms for each Telegram Bot API fetch call. */
const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;

/**
 * Telegram Bot API rejects messages >4096 bytes. We truncate at 4090 as a conservative
 * margin to leave headroom for overhead. Byte-aware (not character-aware) because emoji
 * and CJK text can produce >4096 bytes even when text.length ≤ 4090.
 */
const TELEGRAM_MAX_BYTES = 4090;

/** U+2026 HORIZONTAL ELLIPSIS — 3 bytes in UTF-8, appended after truncation. */
const TELEGRAM_ELLIPSIS = "\u2026";

/**
 * Bytes to subtract from TELEGRAM_MAX_BYTES before slicing the buffer.
 * Breakdown: 3 bytes for TELEGRAM_ELLIPSIS + 3 bytes worst-case U+FFFD expansion
 * (cutting a multi-byte sequence at the last byte produces one U+FFFD = 3 bytes,
 * replacing 1 byte — net +2 byte expansion; the extra 1 byte gives a safety margin).
 */
const TELEGRAM_TRUNCATION_GUARD_BYTES = 6;

/**
 * Send a Telegram notification via the Bot API.
 *
 * API: POST https://api.telegram.org/bot{TOKEN}/sendMessage
 * Body: { chat_id, text }
 */
/** Pattern for valid Telegram bot tokens issued by BotFather: {digits}:{alphanumeric_35+}. */
const TELEGRAM_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{35,}$/;

export async function sendTelegramNotification(
  payload: NotifyPayload,
  opts: TelegramOptions,
): Promise<void> {
  if (!TELEGRAM_TOKEN_PATTERN.test(opts.token)) {
    throw new Error(
      `Invalid Telegram token format. Expected format: 123456:ABCdef... Got: ${opts.token.slice(0, 8)}...`
    );
  }
  const text = payload.body
    ? `${payload.title}\n${payload.body}`
    : payload.title;
  const truncatedText = Buffer.byteLength(text, "utf8") > TELEGRAM_MAX_BYTES
    ? Buffer.from(text).subarray(0, TELEGRAM_MAX_BYTES - TELEGRAM_TRUNCATION_GUARD_BYTES).toString("utf8") + TELEGRAM_ELLIPSIS
    : text;
  const url = `https://api.telegram.org/bot${opts.token}/sendMessage`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TELEGRAM_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: opts.chatId, text: truncatedText }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Telegram API returned ${response.status} ${response.statusText}`);
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
