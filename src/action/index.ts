/**
 * Phase2S GitHub Action entry point.
 *
 * Runs as a Node.js 20 JavaScript action (using: node20, main: dist/action.js).
 * Bundled by ncc into a single file — @actions/* deps are inlined, not runtime deps.
 *
 * Flow:
 *   1. Validate credentials for the chosen provider
 *   2. Install @scanton/phase2s globally
 *   3. Run: phase2s run "/skill args"
 *   4. Write output to $GITHUB_STEP_SUMMARY
 *   5. Post PR comment (if pull_request event + GITHUB_TOKEN)
 *   6. Exit with code based on fail-on setting + skill verdict
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import { appendFileSync } from "node:fs";

const MAX_COMMENT_CHARS = 60_000;

export async function run(): Promise<void> {
  const skill = core.getInput("skill", { required: true });
  const args = core.getInput("args");
  const provider = core.getInput("provider") || "anthropic";
  const anthropicKey = core.getInput("anthropic-api-key");
  const openaiKey = core.getInput("openai-api-key");
  const failOn = core.getInput("fail-on") || "error";

  // --- Credential validation ---
  if (provider === "anthropic" && !anthropicKey) {
    core.setFailed(
      "anthropic-api-key is required when using the anthropic provider. " +
      "Add it as a secret: `anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}`"
    );
    return;
  }
  if (provider === "openai-api" && !openaiKey) {
    core.setFailed(
      "openai-api-key is required when using the openai-api provider. " +
      "Add it as a secret: `openai-api-key: ${{ secrets.OPENAI_API_KEY }}`"
    );
    return;
  }

  // --- Auto-install phase2s ---
  core.info("Installing @scanton/phase2s...");
  const installCode = await exec.exec(
    "npm",
    ["install", "-g", "@scanton/phase2s"],
    { ignoreReturnCode: true }
  );
  if (installCode !== 0) {
    core.setFailed(
      "Failed to install @scanton/phase2s. Check npm connectivity and try again."
    );
    return;
  }

  // --- Build prompt ---
  const normalizedSkill = skill.startsWith("/") ? skill : `/${skill}`;
  const prompt = args ? `${normalizedSkill} ${args}` : normalizedSkill;

  // --- Run phase2s ---
  let output = "";
  const exitCode = await exec.exec("phase2s", ["run", prompt], {
    env: {
      ...process.env,
      PHASE2S_PROVIDER: provider,
      NO_COLOR: "1",
      ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
      ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
    },
    listeners: {
      stdout: (data: Buffer) => { output += data.toString(); },
      stderr: (data: Buffer) => { output += data.toString(); },
    },
    ignoreReturnCode: true,
  });

  // --- Extract verdict ---
  const verdictMatch = output.match(/VERDICT:\s*(APPROVED|CHALLENGED|NEEDS_CLARIFICATION)/i);
  const verdict = verdictMatch?.[1]?.toUpperCase() ?? "";

  core.setOutput("result", output);
  core.setOutput("verdict", verdict);

  // --- Write to Step Summary ---
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [
      `## Phase2S: \`${normalizedSkill}\``,
      verdict ? `**Verdict:** ${verdict}` : "",
      "",
      "```",
      output.trim(),
      "```",
    ].filter(Boolean);
    appendFileSync(summaryPath, lines.join("\n") + "\n");
  }

  // --- Post PR comment ---
  const token = process.env.GITHUB_TOKEN;
  if (token && github.context.eventName === "pull_request") {
    const prNumber = github.context.payload.pull_request?.number;
    if (prNumber) {
      const commentOutput =
        output.length > MAX_COMMENT_CHARS
          ? output.slice(0, MAX_COMMENT_CHARS) +
            "\n\n_(output truncated — see Step Summary for full output)_"
          : output;
      const body = [
        `## Phase2S: \`${normalizedSkill}\``,
        verdict ? `**Verdict:** ${verdict}` : "",
        "",
        "```",
        commentOutput.trim(),
        "```",
      ]
        .filter(Boolean)
        .join("\n");
      try {
        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body,
        });
      } catch (err) {
        core.warning(
          `Could not post PR comment: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // --- Determine failure ---
  const isChallenged = verdict === "CHALLENGED";
  const shouldFail =
    (failOn === "error" && exitCode !== 0) ||
    (failOn === "challenged" && (isChallenged || exitCode !== 0));

  if (shouldFail) {
    core.setFailed(
      `Phase2S ${normalizedSkill} failed` +
      ` (exit: ${exitCode}${verdict ? `, verdict: ${verdict}` : ""})`
    );
  }
}

run().catch((err) =>
  core.setFailed(err instanceof Error ? err.message : String(err))
);
