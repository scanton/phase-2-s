/**
 * phase2s web dashboard — Express HTTP server (Sprint 94)
 *
 * Serves the React SPA from dist/web/ and exposes:
 *   GET /api/runs         — list all conduct-log entries (newest first)
 *   GET /api/runs/:id     — run detail by specHash
 *   GET /api/spec?path=   — read a spec file (path traversal guarded)
 */

import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startServer(port: number, cwd: string): Server {
  const app = express();
  // server.ts compiles to dist/src/web/server.js (rootDir:"." in tsconfig).
  // From dist/src/web/, go up 2 dirs to reach dist/, then into web/ where
  // Vite outputs the SPA (vite.config.ts outDir: "../dist/web").
  const distWeb = join(__dirname, "../../web");

  app.get("/api/runs", async (req, res) => {
    const { handleGetRuns } = await import("./api/runs.js");
    await handleGetRuns(req, res, cwd);
  });

  app.get("/api/runs/:id", async (req, res) => {
    const { handleGetRunDetail } = await import("./api/runs.js");
    await handleGetRunDetail(req, res, cwd);
  });

  app.get("/api/spec", async (req, res) => {
    const { handleGetSpec } = await import("./api/spec.js");
    await handleGetSpec(req, res, cwd);
  });

  app.use(express.static(distWeb));

  // SPA fallback — serve index.html for all non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(join(distWeb, "index.html"), (err) => {
      if (err) {
        res
          .status(503)
          .send(
            "Phase2S dashboard not built. Run: npm run build:web\n" +
              "(Or reinstall: npm install -g @scanton/phase2s)",
          );
      }
    });
  });

  // Bind to loopback only — conduct log data should not be accessible to
  // other machines on the local network. Use --host flag (future) to opt out.
  return app.listen(port, "127.0.0.1");
}
