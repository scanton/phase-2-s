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

export interface ServeOptions {
  port: number;
  open: boolean;
  cwd: string;
}

export async function runServe(options: ServeOptions): Promise<void> {
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
    exec(`${cmd} http://localhost:${options.port}`);
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
