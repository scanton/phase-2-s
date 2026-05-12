/**
 * phase2s serve — Web dashboard CLI handler (Sprint 94)
 *
 * Starts an Express HTTP server serving:
 *  - /api/runs          — list all conduct-log entries
 *  - /api/runs/:id      — run detail (entry + spec + runLog)
 *  - /api/spec          — read a spec file (with path traversal guard)
 *  - static files from  — dist/web/ (React SPA)
 */

import { exec } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

export interface ServeOptions {
  port: number;
  open: boolean;
  cwd: string;
}

export async function runServe(options: ServeOptions): Promise<void> {
  // Validate cwd is a real phase2s project before accepting it as a trust root.
  // Without this check, --cwd / would make assertInProject() pass for any path
  // on the entire filesystem (since everything is inside /).
  const phase2sDir = join(options.cwd, ".phase2s");
  try {
    await access(phase2sDir);
  } catch {
    console.error(
      `Not a phase2s project: ${options.cwd}\n` +
        `Expected a .phase2s/ directory. Run phase2s from your project root.`,
    );
    process.exit(1);
  }

  const { startServer } = await import("../web/server.js");
  const server = startServer(options.port, options.cwd);

  console.log(`Phase2S Dashboard running at http://localhost:${options.port}`);
  console.log(`Serving data from: ${options.cwd}`);

  if (options.open) {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${cmd} http://localhost:${options.port}`, (err) => {
      if (err) console.warn(`Could not open browser: ${err.message}`);
    });
  }

  const shutdown = () => {
    server.close(() => {
      console.log("\nDashboard stopped.");
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
