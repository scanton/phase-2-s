import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildNotifyPayload, sendNotification, formatDurationMs } from "../../src/core/notify.js";

// ---------------------------------------------------------------------------
// Mock child_process so osascript never runs in tests
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0, error: null, stderr: null }),
}));

// ---------------------------------------------------------------------------
// buildNotifyPayload
// ---------------------------------------------------------------------------

describe("buildNotifyPayload", () => {
  it("success: title contains spec name and success is true", () => {
    const p = buildNotifyPayload("pagination.md", true, 2, false);
    expect(p.title).toContain("pagination");
    expect(p.success).toBe(true);
  });

  it("success: body contains attempt count", () => {
    const p = buildNotifyPayload("auth.md", true, 3, false);
    expect(p.body).toContain("3 attempts");
  });

  it("success: body includes formatted duration when provided", () => {
    const durationMs = 8 * 60 * 1000 + 12 * 1000; // 8m 12s
    const p = buildNotifyPayload("spec.md", true, 1, false, durationMs);
    expect(p.body).toContain("8m 12s");
  });

  it("failure: title indicates failure and success is false", () => {
    const p = buildNotifyPayload("rate-limit.md", false, 3, false);
    expect(p.title).toContain("failed");
    expect(p.success).toBe(false);
  });

  it("challenged: title indicates CHALLENGED regardless of success flag", () => {
    const p = buildNotifyPayload("my-spec.md", false, 0, true);
    expect(p.title).toContain("CHALLENGED");
    expect(p.success).toBe(false);
  });

  it("strips .md extension from spec name in title", () => {
    const p = buildNotifyPayload("my-feature.md", true, 1, false);
    expect(p.title).not.toContain(".md");
    expect(p.title).toContain("my-feature");
  });
});

// ---------------------------------------------------------------------------
// formatDurationMs
// ---------------------------------------------------------------------------

describe("formatDurationMs", () => {
  it("formats sub-minute durations as seconds only", () => {
    expect(formatDurationMs(45_000)).toBe("45s");
  });

  it("formats multi-minute durations as Xm Ys", () => {
    expect(formatDurationMs(8 * 60 * 1000 + 12 * 1000)).toBe("8m 12s");
  });

  it("handles exactly 1 minute", () => {
    expect(formatDurationMs(60_000)).toBe("1m 0s");
  });
});

// ---------------------------------------------------------------------------
// sendNotification — no-op paths
// ---------------------------------------------------------------------------

describe("sendNotification", () => {
  it("resolves without error when mac:false and no slack URL", async () => {
    await expect(
      sendNotification({ title: "test", success: true }, { mac: false }),
    ).resolves.toBeUndefined();
  });

  it("calls osascript when mac:true", async () => {
    const { spawnSync } = await import("node:child_process");
    const spy = spawnSync as ReturnType<typeof vi.fn>;
    spy.mockClear();
    await sendNotification({ title: "Phase2S done", success: true }, { mac: true });
    expect(spy).toHaveBeenCalledWith("osascript", ["-e", expect.stringContaining("Phase2S done")]);
  });

  it("calls fetch with correct Slack payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await sendNotification(
      { title: "Goal complete", body: "2 attempts", success: true },
      { mac: false, slack: "https://hooks.slack.com/test" },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { text: string };
    expect(body.text).toContain("Goal complete");
    expect(body.text).toContain(":white_check_mark:");

    vi.unstubAllGlobals();
  });

  it("logs to stderr but does not throw when osascript fails", async () => {
    const { spawnSync } = await import("node:child_process");
    const spy = spawnSync as ReturnType<typeof vi.fn>;
    spy.mockReturnValueOnce({ status: 1, error: null, stderr: Buffer.from("osascript not found") });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendNotification({ title: "done", success: true }, { mac: true }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
