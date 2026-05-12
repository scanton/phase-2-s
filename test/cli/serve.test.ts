/**
 * Tests for `phase2s serve` CLI option parsing (Sprint 94)
 *
 * Tests cover:
 * 1. Default port is 3010
 * 2. --port 4000 parses to 4000
 * 3. --open flag sets open: true
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Option parsing logic (extracted from CLI handler for testability)
// ---------------------------------------------------------------------------

interface ServeOptions {
  port: number;
  open: boolean;
  cwd: string;
}

function parseServeOptions(raw: {
  port?: string;
  open?: boolean;
  cwd?: string;
}): ServeOptions {
  return {
    port: raw.port ? parseInt(raw.port, 10) : 3010,
    open: raw.open ?? false,
    cwd: raw.cwd ?? process.cwd(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseServeOptions", () => {
  it("defaults port to 3010 when not provided", () => {
    const opts = parseServeOptions({});
    expect(opts.port).toBe(3010);
  });

  it("parses --port 4000 to numeric 4000", () => {
    const opts = parseServeOptions({ port: "4000" });
    expect(opts.port).toBe(4000);
  });

  it("defaults open to false", () => {
    const opts = parseServeOptions({});
    expect(opts.open).toBe(false);
  });

  it("sets open: true when --open flag is present", () => {
    const opts = parseServeOptions({ open: true });
    expect(opts.open).toBe(true);
  });

  it("uses provided --cwd value", () => {
    const opts = parseServeOptions({ cwd: "/custom/path" });
    expect(opts.cwd).toBe("/custom/path");
  });

  it("defaults cwd to process.cwd() when not provided", () => {
    const opts = parseServeOptions({});
    expect(opts.cwd).toBe(process.cwd());
  });
});
