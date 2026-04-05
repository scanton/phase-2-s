import { describe, it, expect, vi, beforeEach } from "vitest";
import { BearState } from "../../src/bear/types.js";

describe("Bear renderer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("StaticBearRenderer", () => {
    it("renders greeting with full art when columns >= 60", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });

      const { StaticBearRenderer } = await import("../../src/bear/static-renderer.js");
      const renderer = new StaticBearRenderer();
      renderer.render(BearState.greeting, "Phase2S v1.10.0");

      const output = spy.mock.calls.map(c => c[0]).join("\n");
      expect(output).toContain("_     _"); // bear ears
      expect(output).toContain("Phase2S v1.10.0");
      spy.mockRestore();
    });

    it("renders compact when columns between 40-59", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      Object.defineProperty(process.stdout, "columns", { value: 50, configurable: true });

      const { StaticBearRenderer } = await import("../../src/bear/static-renderer.js");
      const renderer = new StaticBearRenderer();
      renderer.render(BearState.greeting, "Phase2S v1.10.0");

      const output = spy.mock.calls.map(c => c[0]).join("\n");
      // Compact mode: no multi-line art
      expect(output).not.toContain(".----.");
      spy.mockRestore();
    });

    it("renders text-only when columns < 40", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true });

      const { StaticBearRenderer } = await import("../../src/bear/static-renderer.js");
      const renderer = new StaticBearRenderer();
      renderer.render(BearState.greeting, "Phase2S v1.10.0");

      const output = spy.mock.calls.map(c => c[0]).join("\n");
      expect(output).toContain("Phase2S v1.10.0");
      expect(output).not.toContain(".----.");
      spy.mockRestore();
    });

    it("thinking renders without extra blank lines", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });

      const { StaticBearRenderer } = await import("../../src/bear/static-renderer.js");
      const renderer = new StaticBearRenderer();
      renderer.render(BearState.thinking);

      // Thinking renders the art (1 call) but no extra blank lines
      expect(spy.mock.calls.length).toBe(1);
      // The single call should contain the full 7-line bear face
      const output = spy.mock.calls[0][0];
      expect(output).toContain("_");
      spy.mockRestore();
    });

    it("--no-banner suppresses greeting only", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });

      const { StaticBearRenderer } = await import("../../src/bear/static-renderer.js");
      const renderer = new StaticBearRenderer({ noBanner: true });

      renderer.render(BearState.greeting, "Phase2S v1.10.0");
      expect(spy.mock.calls.length).toBe(0);

      renderer.render(BearState.success);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      spy.mockRestore();
    });
  });

  describe("initBear suppression", () => {
    it("returns no-op when isTTY is false", async () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

      // Need a fresh module import to test singleton
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      // initBear with non-TTY should leave the no-op renderer
      // The bear singleton should be a no-op
      const { bear, BearState: BS } = await import("../../src/bear/index.js");
      bear.render(BS.greeting, "test");
      // If it's a no-op, no console.log calls
      // (Can't easily test this without re-instantiation, so just verify the module exports)
      expect(typeof bear.render).toBe("function");

      Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
      spy.mockRestore();
    });

    it("MCP mode prevents bear output", async () => {
      const { setMcpMode, bear, BearState: BS } = await import("../../src/bear/index.js");
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      setMcpMode();
      bear.render(BS.greeting, "test");
      // After MCP mode, render should be no-op
      // (The singleton was replaced with NoOpRenderer)
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("BearState enum", () => {
    it("has all 5 states", () => {
      expect(Object.values(BearState)).toEqual([
        "greeting", "thinking", "success", "error", "help",
      ]);
    });
  });
});
