/**
 * phase2s upgrade — self-update command.
 *
 * Checks npm registry for the latest published version and offers to install
 * it via `npm install -g @scanton/phase2s`.
 *
 * Pure functions (checkLatestVersion, isUpdateAvailable, parseVersion) are
 * exported for testing. runUpgrade() handles all IO.
 */

import { get } from "node:https";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse a semver string into major/minor/patch numbers.
 * Returns null if the string is not a valid semver.
 */
export function parseVersion(version: string): VersionParts | null {
  const clean = version.replace(/^v/, "");
  const parts = clean.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => isNaN(n) || n < 0)) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Returns true if `latest` is strictly newer than `current`.
 * Returns false if they are equal or `current` is newer.
 * Returns false (safe default) if either version is unparseable.
 */
export function isUpdateAvailable(current: string, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

/**
 * Fetch the latest published version of a package from the npm registry.
 * Returns null if the request fails or the response is unparseable.
 * Times out after 5 seconds.
 */
export function checkLatestVersion(
  packageName: string,
  registryBase = "https://registry.npmjs.org",
): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `${registryBase}/${encodeURIComponent(packageName)}/latest`;
    const req = get(
      url,
      { headers: { Accept: "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data) as { version?: string };
            resolve(typeof json.version === "string" ? json.version : null);
          } catch {
            resolve(null);
          }
        });
        res.on("error", () => resolve(null));
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
// runUpgrade — entry point
// ---------------------------------------------------------------------------

export async function runUpgrade(
  currentVersion: string,
  opts: { check?: boolean } = {},
): Promise<void> {
  process.stdout.write(chalk.dim("  Checking for updates...\n"));

  const latest = await checkLatestVersion("@scanton/phase2s");

  if (!latest) {
    console.log(chalk.yellow("  Could not reach npm registry. Check your network connection."));
    return;
  }

  if (!isUpdateAvailable(currentVersion, latest)) {
    console.log(
      chalk.green(`  You're on the latest version`) +
        chalk.dim(` (v${currentVersion})`),
    );
    return;
  }

  console.log(
    chalk.bold(`\n  phase2s v${currentVersion}`) +
      chalk.dim(" → ") +
      chalk.green(`v${latest} available`),
  );

  if (opts.check) {
    // --check: just report, don't prompt
    console.log(
      chalk.dim(`  Run: npm install -g @scanton/phase2s`),
    );
    return;
  }

  // Interactive prompt
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.cyan("  Upgrade now? [y/N] "), (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (answer !== "y" && answer !== "yes") {
    console.log(chalk.dim("  Skipped. Run `npm install -g @scanton/phase2s` when ready."));
    return;
  }

  console.log(chalk.dim("\n  Running: npm install -g @scanton/phase2s\n"));
  const result = spawnSync("npm", ["install", "-g", "@scanton/phase2s"], {
    stdio: "inherit",
    shell: false,
  });

  if (result.status === 0) {
    console.log(chalk.green(`\n  Upgraded to v${latest}. Restart phase2s to use the new version.`));
  } else {
    console.log(
      chalk.red("\n  npm install failed. Try running manually:") +
        chalk.bold("\n  npm install -g @scanton/phase2s"),
    );
    if (result.error) {
      console.log(chalk.dim(`  Error: ${result.error.message}`));
    }
  }
}
