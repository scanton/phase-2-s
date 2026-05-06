/**
 * Tests for code_search tool registration in createDefaultRegistry().
 *
 * Verifies the Ollama-gated pattern: code_search registers only when
 * both ollamaBaseUrl and ollamaEmbedModel are present in RegistryOptions.
 */

import { describe, it, expect } from "vitest";
import { createDefaultRegistry } from "../../src/tools/index.js";

describe("createDefaultRegistry — code_search gating", () => {
  it("does NOT register code_search when ollamaBaseUrl and ollamaEmbedModel are absent", () => {
    const registry = createDefaultRegistry({ cwd: process.cwd() });
    const names = registry.list().map((t) => t.name);
    expect(names).not.toContain("code_search");
  });

  it("does NOT register code_search when only ollamaBaseUrl is set (no embedModel)", () => {
    const registry = createDefaultRegistry({
      cwd: process.cwd(),
      ollamaBaseUrl: "http://localhost:11434/v1",
    });
    const names = registry.list().map((t) => t.name);
    expect(names).not.toContain("code_search");
  });

  it("does NOT register code_search when only ollamaEmbedModel is set (no baseUrl)", () => {
    const registry = createDefaultRegistry({
      cwd: process.cwd(),
      ollamaEmbedModel: "nomic-embed-text:latest",
    });
    const names = registry.list().map((t) => t.name);
    expect(names).not.toContain("code_search");
  });

  it("registers code_search when both ollamaBaseUrl and ollamaEmbedModel are set", () => {
    const registry = createDefaultRegistry({
      cwd: process.cwd(),
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaEmbedModel: "nomic-embed-text:latest",
    });
    const names = registry.list().map((t) => t.name);
    expect(names).toContain("code_search");
  });

  it("still registers the 5 default tools regardless of Ollama config", () => {
    const registry = createDefaultRegistry({ cwd: process.cwd() });
    const names = registry.list().map((t) => t.name);
    // The 5 default tools are always present
    expect(names).toContain("file_read");
    expect(names).toContain("file_write");
    expect(names).toContain("shell");
    expect(names).toContain("glob");
    expect(names).toContain("grep");
  });
});
