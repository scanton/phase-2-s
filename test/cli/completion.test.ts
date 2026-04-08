import { describe, it, expect } from "vitest";
import { main } from "../../src/cli/index.js";

// Capture stdout output from a main() invocation
async function runCompletion(shell: string): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await main(["node", "phase2s", "completion", shell]);
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
}

describe("phase2s completion bash", () => {
  it("outputs a bash completion function", async () => {
    const output = await runCompletion("bash");
    expect(output).toContain("_phase2s_complete");
    expect(output).toContain("complete -F _phase2s_complete phase2s");
  });

  it("bash script includes all subcommands", async () => {
    const output = await runCompletion("bash");
    expect(output).toContain("chat");
    expect(output).toContain("run");
    expect(output).toContain("skills");
    expect(output).toContain("mcp");
    expect(output).toContain("completion");
  });

  it("bash script includes skill name completion for run subcommand", async () => {
    const output = await runCompletion("bash");
    expect(output).toContain("phase2s skills --json");
  });
});

describe("phase2s completion zsh", () => {
  it("outputs a zsh compdef function", async () => {
    const output = await runCompletion("zsh");
    expect(output).toContain("#compdef phase2s");
    expect(output).toContain("_phase2s");
  });

  it("zsh script includes all subcommands", async () => {
    const output = await runCompletion("zsh");
    expect(output).toContain("chat");
    expect(output).toContain("run");
    expect(output).toContain("skills");
    expect(output).toContain("mcp");
    expect(output).toContain("completion");
  });

  it("zsh script includes skill name completion for run subcommand", async () => {
    const output = await runCompletion("zsh");
    expect(output).toContain("phase2s skills --json");
  });

  it("zsh script includes setup subcommand", async () => {
    const output = await runCompletion("zsh");
    expect(output).toContain("setup");
  });

  it("zsh script includes template subcommand", async () => {
    const output = await runCompletion("zsh");
    expect(output).toContain("template");
  });
});
