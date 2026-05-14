/**
 * Client-side git root detection for project grouping (Sprint 99).
 *
 * Walks parent directories of a specPath string to find the nearest
 * ancestor whose name ends just before a "/.git" segment. Since this
 * runs in the browser, it works on the path string only (no fs access).
 *
 * The browser receives absolute specPaths from the server — e.g.
 * "/Users/alice/dev/my-app/.phase2s/specs/2026-05-13T10-00-00-abc123.md"
 * Walking to the parent of ".phase2s" gives the project root.
 *
 * Heuristic: the .phase2s directory is always one level inside the project
 * root, so dirname(dirname(specPath)) is the project root when specPath
 * is inside .phase2s/specs/. For any other layout, fall back to dirname.
 */
export function findGitRoot(specPath: string): string {
  if (!specPath) return "(unknown)";

  // Normalise separators (Windows paths unlikely but harmless)
  const p = specPath.replace(/\\/g, "/");

  // Fast path: .phase2s/specs/ is the canonical location
  const phase2sIdx = p.lastIndexOf("/.phase2s/");
  if (phase2sIdx !== -1) {
    return p.slice(0, phase2sIdx) || "/";
  }

  // Fallback: return the parent directory
  const lastSlash = p.lastIndexOf("/");
  if (lastSlash <= 0) return p || "/";
  return p.slice(0, lastSlash);
}
