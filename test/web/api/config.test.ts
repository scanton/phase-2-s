/**
 * Server-side unit tests for /api/config handlers (Sprint 97)
 *
 * Tests handleGetConfig and handlePostConfig in isolation (no Express server).
 *
 * Covers:
 *   1.  GET 200 with masked keys when file exists
 *   2.  GET 404 when no config file
 *   3.  POST 200 writes valid changes
 *   4.  POST preserves ***SET*** fields
 *   5.  POST 400 on invalid payload (non-object body)
 *   6.  POST atomic write (tmp → rename pattern)
 *   7.  POST empty-string fields omitted from YAML (delete key)
 *   8.  POST creates file when absent
 *   9.  POST 400 when ***SET*** sent as literal for non-sensitive field
 *   10. GET 500 with clear message when YAML is malformed
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Request, Response } from "express";
import { handleGetConfig, handlePostConfig } from "../../../src/web/api/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpCwd(): string {
  return join(tmpdir(), `phase2s-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Minimal mock of Express Request */
function mockReq(body?: unknown): Request {
  return { body } as Request;
}

/** Minimal mock of Express Response that captures what was sent */
function mockRes(): { res: Response; status: () => number; body: () => unknown } {
  let _status = 200;
  let _body: unknown = undefined;
  const res = {
    status(code: number) {
      _status = code;
      return res;
    },
    json(data: unknown) {
      _body = data;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    status: () => _status,
    body: () => _body,
  };
}

const MASKED = "***SET***";

const SAMPLE_YAML = `
provider: anthropic
apiKey: sk-real-key-12345
anthropicApiKey: sk-ant-real-key
model: claude-3-5-sonnet-20241022
allowDestructive: false
verifyCommand: npm test
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/config", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = tmpCwd();
    await mkdir(cwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("1. returns 200 with masked keys when file exists", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status, body } = mockRes();
    await handleGetConfig(mockReq(), res, cwd);

    expect(status()).toBe(200);
    const b = body() as Record<string, unknown>;
    expect(b).toHaveProperty("config");
    const config = b.config as Record<string, unknown>;
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe(MASKED);
    expect(config.anthropicApiKey).toBe(MASKED);
    // Non-sensitive fields pass through
    expect(config.model).toBe("claude-3-5-sonnet-20241022");
    expect(config.allowDestructive).toBe(false);
  });

  it("2. returns 404 when no config file exists", async () => {
    const { res, status, body } = mockRes();
    await handleGetConfig(mockReq(), res, cwd);

    expect(status()).toBe(404);
    const b = body() as Record<string, unknown>;
    expect(typeof b.error).toBe("string");
  });

  it("10. returns 500 with clear message when YAML is malformed", async () => {
    const badYaml = "key: [\n  - broken\n  missing_colon\n";
    await writeFile(join(cwd, ".phase2s.yaml"), badYaml, "utf-8");
    const { res, status, body } = mockRes();
    await handleGetConfig(mockReq(), res, cwd);

    expect(status()).toBe(500);
    const b = body() as Record<string, unknown>;
    expect(typeof b.error).toBe("string");
    expect((b.error as string).toLowerCase()).toContain("yaml");
  });
});

describe("POST /api/config", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = tmpCwd();
    await mkdir(cwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("3. returns 200 and writes valid changes", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status, body } = mockRes();

    await handlePostConfig(mockReq({ provider: "openai-api", model: "gpt-4o" }), res, cwd);

    expect(status()).toBe(200);
    const b = body() as Record<string, unknown>;
    expect(b.ok).toBe(true);

    // Verify file was written with new values
    const written = await readFile(join(cwd, ".phase2s.yaml"), "utf-8");
    expect(written).toContain("provider: openai-api");
    expect(written).toContain("model: gpt-4o");
  });

  it("4. preserves ***SET*** fields (does not delete existing API keys)", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status } = mockRes();

    // Send ***SET*** for apiKey — means "don't change it"
    await handlePostConfig(
      mockReq({ provider: "anthropic", apiKey: MASKED, anthropicApiKey: MASKED }),
      res,
      cwd,
    );

    expect(status()).toBe(200);

    // Verify file still has the original keys
    const written = await readFile(join(cwd, ".phase2s.yaml"), "utf-8");
    expect(written).toContain("sk-real-key-12345");
    expect(written).toContain("sk-ant-real-key");
  });

  it("5. returns 400 on invalid payload (array body instead of object)", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status, body } = mockRes();

    // Array is valid JSON but not an object — our handler rejects it
    await handlePostConfig(mockReq([1, 2, 3]), res, cwd);

    expect(status()).toBe(400);
    const b = body() as Record<string, unknown>;
    expect(typeof b.error).toBe("string");
  });

  it("6. performs atomic write (creates .tmp file then renames)", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status } = mockRes();

    await handlePostConfig(mockReq({ provider: "openai-api" }), res, cwd);

    expect(status()).toBe(200);

    // .tmp file should be gone after successful write (renamed to target)
    const tmpExists = await readFile(join(cwd, ".phase2s.yaml.tmp"), "utf-8")
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);

    // Target should exist
    const targetExists = await readFile(join(cwd, ".phase2s.yaml"), "utf-8")
      .then(() => true)
      .catch(() => false);
    expect(targetExists).toBe(true);
  });

  it("7. empty-string fields are omitted/deleted from YAML", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status } = mockRes();

    // Send empty string for apiKey → should delete it from the file
    await handlePostConfig(mockReq({ apiKey: "" }), res, cwd);

    expect(status()).toBe(200);

    const written = await readFile(join(cwd, ".phase2s.yaml"), "utf-8");
    // apiKey should be gone from the file
    expect(written).not.toContain("sk-real-key-12345");
    expect(written).not.toMatch(/^apiKey:/m);
  });

  it("8. creates .phase2s.yaml when no config file exists", async () => {
    const { res, status, body } = mockRes();

    await handlePostConfig(mockReq({ provider: "anthropic", allowDestructive: false }), res, cwd);

    expect(status()).toBe(200);
    const b = body() as Record<string, unknown>;
    expect(b.ok).toBe(true);

    // File should now exist
    const written = await readFile(join(cwd, ".phase2s.yaml"), "utf-8");
    expect(written).toContain("provider: anthropic");
  });

  it("9. returns 400 when ***SET*** is sent as literal value for non-sensitive field", async () => {
    await writeFile(join(cwd, ".phase2s.yaml"), SAMPLE_YAML, "utf-8");
    const { res, status, body } = mockRes();

    // model is not a sensitive field — sending ***SET*** should be rejected
    await handlePostConfig(mockReq({ model: MASKED }), res, cwd);

    expect(status()).toBe(400);
    const b = body() as Record<string, unknown>;
    expect(typeof b.error).toBe("string");
  });
});
