/**
 * Secret pattern scanner for diffs.
 *
 * Scans added lines in a git diff for common secret patterns before sending
 * the diff to an LLM. Warn-not-block: callers decide how to handle matches.
 *
 * Patterns are conservative: designed to catch the most common accidental
 * leaks (AWS keys, OpenAI keys, GitHub tokens) without false-positive flooding.
 * Only added lines (starting with '+', excluding '+++' headers) are checked —
 * removed lines are already out of the codebase.
 */

export interface SecretMatch {
  /** Human-readable pattern name, e.g. "AWS Access Key". */
  name: string;
  /** 1-based line number in the diff output where the match was found. */
  lineNumber: number;
  /** The matched text (truncated for display). */
  preview: string;
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "AWS Access Key",       regex: /AKIA[A-Z0-9]{16}/g },
  { name: "AWS Secret Key",       regex: /[Aa][Ww][Ss]_?[Ss][Ee][Cc][Rr][Ee][Tt].{0,20}[A-Za-z0-9/+]{40}/g },
  { name: "OpenAI API Key",       regex: /sk-[A-Za-z0-9]{48,}/g },
  { name: "OpenAI Project Key",   regex: /sk-proj-[A-Za-z0-9_-]{80,}/g },
  { name: "Anthropic API Key",    regex: /sk-ant-[A-Za-z0-9_-]{80,}/g },
  { name: "GitHub Personal Token", regex: /ghp_[A-Za-z0-9]{36}/g },
  { name: "GitHub OAuth Token",   regex: /gho_[A-Za-z0-9]{36}/g },
  { name: "GitHub App Token",     regex: /ghs_[A-Za-z0-9]{36}/g },
  { name: "Slack Bot Token",      regex: /xoxb-[A-Za-z0-9-]{40,}/g },
  { name: "Slack User Token",     regex: /xoxp-[A-Za-z0-9-]{40,}/g },
  { name: "Private Key Block",    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY/g },
];

/**
 * Scan a git diff string for common secret patterns.
 *
 * @param diff - Raw output of `git diff --cached`
 * @returns Array of matches found in added lines. Empty array means no secrets detected.
 */
export function scanForSecrets(diff: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = diff.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Only check added lines. Skip diff headers ('+++ b/...') and context lines.
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    const lineNumber = i + 1;

    for (const { name, regex } of SECRET_PATTERNS) {
      regex.lastIndex = 0; // reset stateful regex before scanning the line
      let match: RegExpExecArray | null;
      // Use a while loop to catch multiple matches per line (e.g. two keys on one line)
      while ((match = regex.exec(line)) !== null) {
        // Truncate the matched value for display — show enough to identify, not expose
        const raw = match[0];
        const preview = raw.length > 16 ? raw.slice(0, 8) + "..." + raw.slice(-4) : raw;
        matches.push({ name, lineNumber, preview });
      }
    }
  }

  return matches;
}
