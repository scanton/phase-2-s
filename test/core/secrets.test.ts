import { describe, it, expect } from "vitest";
import { scanForSecrets } from "../../src/core/secrets.js";

// ---------------------------------------------------------------------------
// Helper: build a fake unified diff with added lines containing the given text
// ---------------------------------------------------------------------------
function makeDiff(addedLine: string): string {
  return [
    "diff --git a/config.ts b/config.ts",
    "--- a/config.ts",
    "+++ b/config.ts",
    "@@ -1,3 +1,4 @@",
    " const x = 1;",
    `+${addedLine}`,
    " const y = 2;",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// AWS Access Key
// ---------------------------------------------------------------------------
describe("scanForSecrets — AWS Access Key", () => {
  it("detects AKIA-format AWS access key in added line", () => {
    const diff = makeDiff("const key = 'AKIAIOSFODNN7EXAMPLE';");
    const matches = scanForSecrets(diff);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].name).toBe("AWS Access Key");
  });

  it("does not flag removed lines", () => {
    const diff = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -1 +1 @@",
      "-const key = 'AKIAIOSFODNN7EXAMPLE';",
      "+const key = 'no-secret-here';",
    ].join("\n");
    const matches = scanForSecrets(diff);
    expect(matches.length).toBe(0);
  });

  it("does not flag diff header lines starting with +++", () => {
    const diff = [
      "diff --git a/AKIAIOSFODNN7EXAMPLE b/AKIAIOSFODNN7EXAMPLE",
      "+++ b/AKIAIOSFODNN7EXAMPLE",
      "@@ -1 +1 @@",
      "+const x = 1;",
    ].join("\n");
    const matches = scanForSecrets(diff);
    expect(matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// OpenAI API Key
// ---------------------------------------------------------------------------
describe("scanForSecrets — OpenAI API Key", () => {
  it("detects sk- format key in added line", () => {
    const key = "sk-" + "A".repeat(48);
    const diff = makeDiff(`const apiKey = '${key}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "OpenAI API Key")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GitHub Personal Token
// ---------------------------------------------------------------------------
describe("scanForSecrets — GitHub Token", () => {
  it("detects ghp_ format token in added line", () => {
    const token = "ghp_" + "A".repeat(36);
    const diff = makeDiff(`const token = '${token}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "GitHub Personal Token")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Private key block
// ---------------------------------------------------------------------------
describe("scanForSecrets — Private Key Block", () => {
  it("detects BEGIN RSA PRIVATE KEY header in added line", () => {
    const diff = makeDiff("-----BEGIN RSA PRIVATE KEY-----");
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "Private Key Block")).toBe(true);
  });

  it("detects BEGIN OPENSSH PRIVATE KEY in added line", () => {
    const diff = makeDiff("-----BEGIN OPENSSH PRIVATE KEY-----");
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "Private Key Block")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clean diff
// ---------------------------------------------------------------------------
describe("scanForSecrets — clean diff", () => {
  it("returns empty array when no secrets present", () => {
    const diff = makeDiff("const greeting = 'hello world';");
    expect(scanForSecrets(diff)).toEqual([]);
  });

  it("returns empty array for empty diff", () => {
    expect(scanForSecrets("")).toEqual([]);
  });

  it("includes line number in match", () => {
    const key = "AKIAIOSFODNN7EXAMPLE";
    const diff = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -1 +1 @@",
      ` const x = 1;`,
      `+const key = '${key}';`, // line 6 in the diff
    ].join("\n");
    const matches = scanForSecrets(diff);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].lineNumber).toBe(6);
  });

  it("includes a truncated preview of the matched text", () => {
    const key = "AKIAIOSFODNN7EXAMPLE";
    const diff = makeDiff(`const key = '${key}';`);
    const matches = scanForSecrets(diff);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].preview).toContain("...");
  });
});

// ---------------------------------------------------------------------------
// Multiple matches
// ---------------------------------------------------------------------------
describe("scanForSecrets — multiple matches", () => {
  it("finds multiple secrets across different lines", () => {
    const diff = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -1 +3 @@",
      "+const awsKey = 'AKIAIOSFODNN7EXAMPLE';",
      "+const githubToken = 'ghp_" + "B".repeat(36) + "';",
    ].join("\n");
    const matches = scanForSecrets(diff);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const names = matches.map((m) => m.name);
    expect(names).toContain("AWS Access Key");
    expect(names).toContain("GitHub Personal Token");
  });

  it("finds multiple secrets on the same line", () => {
    const key1 = "AKIAIOSFODNN7EXAMPLE";
    const key2 = "AKIAIOSFODNN7EXAMPLE";
    const diff = makeDiff(`const a = '${key1}', b = '${key2}';`);
    const matches = scanForSecrets(diff).filter((m) => m.name === "AWS Access Key");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Previously untested pattern families (coverage gaps found in eng review)
// ---------------------------------------------------------------------------
describe("scanForSecrets — AWS Secret Key", () => {
  it("detects AWS_SECRET_ACCESS_KEY pattern in added line", () => {
    const value = "A".repeat(40);
    const diff = makeDiff(`const key = 'aws_secret_access_key=${value}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "AWS Secret Key")).toBe(true);
  });
});

describe("scanForSecrets — OpenAI Project Key", () => {
  it("detects sk-proj- format key in added line", () => {
    const key = "sk-proj-" + "A".repeat(80);
    const diff = makeDiff(`const key = '${key}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "OpenAI Project Key")).toBe(true);
  });

  it("detects longer OpenAI legacy sk- keys (49+ chars) with {48,} pattern", () => {
    const key = "sk-" + "A".repeat(52); // 52 > 48
    const diff = makeDiff(`const key = '${key}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "OpenAI API Key")).toBe(true);
  });
});

describe("scanForSecrets — Anthropic API Key", () => {
  it("detects sk-ant- format key in added line", () => {
    const key = "sk-ant-" + "A".repeat(80);
    const diff = makeDiff(`const key = '${key}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "Anthropic API Key")).toBe(true);
  });
});

describe("scanForSecrets — GitHub OAuth and App Tokens", () => {
  it("detects gho_ format OAuth token in added line", () => {
    const token = "gho_" + "A".repeat(36);
    const diff = makeDiff(`const token = '${token}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "GitHub OAuth Token")).toBe(true);
  });

  it("detects ghs_ format App token in added line", () => {
    const token = "ghs_" + "A".repeat(36);
    const diff = makeDiff(`const token = '${token}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "GitHub App Token")).toBe(true);
  });
});

describe("scanForSecrets — Slack Tokens", () => {
  it("detects xoxb- Slack Bot token in added line", () => {
    const token = "xoxb-" + "A".repeat(40);
    const diff = makeDiff(`const token = '${token}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "Slack Bot Token")).toBe(true);
  });

  it("detects xoxp- Slack User token in added line", () => {
    const token = "xoxp-" + "A".repeat(40);
    const diff = makeDiff(`const token = '${token}';`);
    const matches = scanForSecrets(diff);
    expect(matches.some((m) => m.name === "Slack User Token")).toBe(true);
  });
});
