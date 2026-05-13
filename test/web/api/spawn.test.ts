/**
 * Unit tests for src/web/api/spawn.ts helpers and src/web/api/lint.ts runLint (Sprint 98)
 *
 * Covers:
 * 1. tsSlug() — produces YYYY-MM-DDTHH-mm-ss format
 * 2. buildSpecContent() — includes goal and required markdown sections
 * 3. buildSpecContent() — truncates long goals in heading, keeps full goal in body
 * 4. runLint() — resolves {valid:true,errors:[]} when child exits 0
 * 5. runLint() — resolves {valid:false,errors:[...lines]} when child exits non-zero with output
 * 6. runLint() — resolves {valid:false,errors:["Lint failed"]} when exit non-zero + empty output
 * 7. runLint() — resolves {valid:false,errors:[...]} when child emits error event
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Pure-function helpers — no mocking needed
// ---------------------------------------------------------------------------

describe("tsSlug", () => {
  it("produces YYYY-MM-DDTHH-mm-ss-SSS format", async () => {
    const { tsSlug } = await import("../../../src/web/api/spawn.js");
    const slug = tsSlug();
    expect(slug).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/);
  });

  it("does not contain colons or dots", async () => {
    const { tsSlug } = await import("../../../src/web/api/spawn.js");
    const slug = tsSlug();
    expect(slug).not.toContain(":");
    expect(slug).not.toContain(".");
  });

  it("length is exactly 23 chars", async () => {
    const { tsSlug } = await import("../../../src/web/api/spawn.js");
    expect(tsSlug()).toHaveLength(23);
  });
});

describe("buildSpecContent", () => {
  it("includes ## Goal section with the full goal text", async () => {
    const { buildSpecContent } = await import("../../../src/web/api/spawn.js");
    const spec = buildSpecContent("Build a login page");
    expect(spec).toContain("## Goal");
    expect(spec).toContain("Build a login page");
  });

  it("includes required spec sections", async () => {
    const { buildSpecContent } = await import("../../../src/web/api/spawn.js");
    const spec = buildSpecContent("Do something");
    expect(spec).toContain("## Context");
    expect(spec).toContain("## Success");
    expect(spec).toContain("## Constraints");
  });

  it("truncates goal in heading but preserves full goal in body", async () => {
    const { buildSpecContent } = await import("../../../src/web/api/spawn.js");
    const longGoal = "A".repeat(120);
    const spec = buildSpecContent(longGoal);
    // Heading uses first 80 chars
    expect(spec).toContain("# Goal: " + "A".repeat(80));
    // Body has the full goal
    expect(spec).toContain(longGoal);
  });
});

// ---------------------------------------------------------------------------
// runLint — requires mocking node:child_process spawn
// ---------------------------------------------------------------------------

// Minimal fake child process with controllable stdout/stderr/events
function makeFakeChild(): {
  child: ChildProcess;
  emit: (event: string, ...args: unknown[]) => void;
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
} {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const stdout = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[`stdout:${event}`]) listeners[`stdout:${event}`] = [];
      listeners[`stdout:${event}`].push(cb);
    }),
  };

  const stderr = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[`stderr:${event}`]) listeners[`stderr:${event}`] = [];
      listeners[`stderr:${event}`].push(cb);
    }),
  };

  const childListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const child = {
    stdout,
    stderr,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (!childListeners[event]) childListeners[event] = [];
      childListeners[event].push(cb);
      return child;
    },
    kill: vi.fn(),
  };

  const emit = (event: string, ...args: unknown[]) => {
    if (event.startsWith("stdout:")) {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    } else if (event.startsWith("stderr:")) {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    } else {
      (childListeners[event] ?? []).forEach((cb) => cb(...args));
    }
  };

  return { child: child as unknown as ChildProcess, emit, stdout, stderr };
}

describe("runLint", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves {valid:true, errors:[]} when child exits with code 0", async () => {
    const { child, emit } = makeFakeChild();
    vi.doMock("node:child_process", () => ({ spawn: vi.fn(() => child) }));

    const { runLint } = await import("../../../src/web/api/lint.js");
    const promise = runLint("/tmp/spec.md");
    emit("close", 0);
    const result = await promise;

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("resolves {valid:false, errors:[lines]} when child exits non-zero with stdout content", async () => {
    const { child, emit, stdout } = makeFakeChild();
    vi.doMock("node:child_process", () => ({ spawn: vi.fn(() => child) }));

    const { runLint } = await import("../../../src/web/api/lint.js");
    const promise = runLint("/tmp/spec.md");

    // Fire stdout data event before close
    emit("stdout:data", Buffer.from("Missing ## Goal section\nEmpty constraints\n"));
    emit("close", 1);

    const result = await promise;
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing ## Goal section");
    expect(result.errors).toContain("Empty constraints");
    // Confirm stdout.on was called
    expect(stdout.on).toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("resolves {valid:false, errors:['Lint failed']} when child exits non-zero with empty output", async () => {
    const { child, emit } = makeFakeChild();
    vi.doMock("node:child_process", () => ({ spawn: vi.fn(() => child) }));

    const { runLint } = await import("../../../src/web/api/lint.js");
    const promise = runLint("/tmp/spec.md");
    emit("close", 1);

    const result = await promise;
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Lint failed"]);
  });

  it("resolves {valid:false} with error message when child emits error event", async () => {
    const { child, emit } = makeFakeChild();
    vi.doMock("node:child_process", () => ({ spawn: vi.fn(() => child) }));

    const { runLint } = await import("../../../src/web/api/lint.js");
    const promise = runLint("/tmp/spec.md");
    emit("error", new Error("ENOENT: no such file or directory"));

    const result = await promise;
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("phase2s not found");
  });
});
