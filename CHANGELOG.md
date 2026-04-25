# Changelog

## v1.47.0 — 2026-04-25

Sprint 73 — Security & Resilience Hardening v2.

### Added

- **Per-turn `[PHASE2S_LEARNINGS]` context messages** — Learnings are no longer baked into the system prompt at session start. Instead, `Conversation.upsertLearningsMessage()` injects a rolling `role: "user"` message containing the current learnings immediately before each LLM turn in the agent loop. This keeps the injected content up-to-date as learnings evolve within a session, and allows `agent.refreshLearnings()` to update the active learnings string mid-session (e.g., between REPL turns). Session save and compaction strip the marker message before persisting so the ephemeral injection does not bloat saved history.

- **`normalizeConfigError()`** — New exported helper in `config.ts` that converts raw `loadConfig()` errors (`ZodError`, YAML parse failures, ENOENT, EACCES) into human-readable CLI messages. Wired into all 5 `loadConfig()` call sites in `index.ts` and `mcp/server.ts`. Seven new tests covering all error branches.

- **`heuristicSort()`** — Keyword/recency hybrid sort exported from `memory.ts`. Used as the fallback ranking strategy in `loadRelevantLearnings()` for all Ollama failure paths (network error, empty embedding, no baseUrl configured). Score formula: `(matchedKeywords / totalKeywords) * recencyWeight(ts)`, where absent timestamps score 1.0.

### Changed

- **Provider enum consolidation** — `PROVIDERS`, `isValidProvider()`, and `getProviderKeyField()` are now imported from `provider-registry.ts` in `config.ts`, `doctor.ts`, and `init.ts`. Inline provider arrays deleted; double-cast `as unknown as [string, ...string[]]` handles Zod's literal-tuple requirement without generating a widened union type.

- **`buildSystemPrompt()` learnings param removed** — The `learnings` argument is gone; the system prompt no longer embeds learnings text. All callers updated. Existing tests updated to assert LEARNINGS content is absent from the system prompt.

### Fixed

- **Anthropic 400 from consecutive user messages** — `translateMessages()` now handles a Case 2 merge: when two consecutive plain-text `role: "user"` messages appear (e.g., the `[PHASE2S_LEARNINGS]` injection followed by the actual user turn), they are concatenated with `\n\n` instead of producing a rejected message sequence. Previously only `tool_result → plain` (Case 1) was handled.

- **`upsertLearningsMessage()` wrong insertion position** — In multi-turn conversations, the LEARNINGS message was anchored to index 1 (after system), which placed it before a historical user message rather than the current pending turn. Anthropic's consecutive-message folding then merged LEARNINGS permanently into that historical message. Fixed: the method now removes the old LEARNINGS entry (splice, not replace-in-place) and re-inserts immediately before the last `role: "user"` message.

### Tests

- `test/core/conversation.test.ts` — 6 new tests: `upsertLearningsMessage()` insertion position, no-system-message case, multi-call replacement, token-budget preservation, multi-turn position regression (adversarial finding), `LEARNINGS_MARKER` sentinel value.
- `test/core/agent.test.ts` — 5 new tests: `refreshLearnings()` updates injected string, `runOnce()` injects marker when learnings set, no injection when learnings absent, compaction/save filter removes marker messages, filter preserves messages without marker.
- `test/providers/anthropic.test.ts` — 2 new tests: plain→plain consecutive user message merge, separator between merged parts.
- `test/core/config.test.ts` — 7 new tests for `normalizeConfigError()` branches.
- `test/core/memory.test.ts` — `heuristicSort()` keyword/recency scoring covered.
- `test/utils/prompt.test.ts` — Updated to assert learnings are NOT in the system prompt (Sprint 73 behavior).

## v1.46.0 — 2026-04-25

Sprint 72 — Smart Learnings + Model Defaults.

### Added

- **Semantic learnings injection** — Phase2S now injects the most *relevant* learnings into each agent session rather than the most *recent*. When Ollama is configured, `loadRelevantLearnings()` generates embeddings via the native `/api/embed` endpoint, builds an incremental vector index at `.phase2s/search-index.jsonl`, and returns the top-K most semantically similar learnings for the current task. Falls back to the existing truncate-oldest strategy when Ollama is unavailable or no query text is provided.

- **Ollama embedding client** (`src/core/embeddings.ts`) — Calls the native Ollama `/api/embed` endpoint (not the OpenAI-compatible `/v1` path). Strips the `/v1` suffix from `ollamaBaseUrl` automatically, so your existing `ollamaBaseUrl` config works without changes. Returns `[]` on any error so callers always get a clean fallback to recency-based injection.

- **Incremental vector index** (`src/core/search-index.ts`) — Persisted at `.phase2s/search-index.jsonl`. Re-embeds only changed learnings on each run (SHA-256 content-hash detection); GCs deleted learnings automatically; writes atomically (temp file + rename) so parallel executor workers never read a partial index.

- **`ollamaEmbedModel` config field** — Point to a dedicated, lighter embedding model (e.g., `nomic-embed-text`) while keeping your main model for chat. Defaults to the main model when absent. Cleared on provider switch.

- **2000-char cap bypass for semantic results** — When semantic retrieval is active, the selected learnings bypass the 2000-char truncation. The selection is already relevance-filtered, so the cap would only discard relevant results.

### Changed

- **Codex-cli default model**: `gpt-4o` → `gpt-5.4` (matches the model Codex CLI uses by default in `~/.codex/config.toml`).

- **Ollama default model**: `llama3.1:8b` → `gemma4:latest`. Updated in `config.ts`, `init.ts` wizard output, `docs/configuration.md`, and `docs/getting-started.md`.

- **All 4 `loadLearnings` call sites** updated to `loadRelevantLearnings`: one-shot mode (uses prompt text as query), goal runner (uses spec title as query), parallel executor subtask workers (uses subtask name as query), parallel executor orchestrator level (uses combined job titles as query). REPL startup continues to use `loadLearnings` directly (no task text available at startup).

### Tests

- `test/core/embeddings.test.ts` — 4 tests: URL stripping, non-200 fallback, network error fallback, baseUrl without `/v1`.
- `test/core/search-index.test.ts` — 8 tests: new learnings embedded, updated learnings re-embedded, unchanged learnings skipped, deleted learnings GC'd, atomic writes, empty index, top-K cosine ranking, empty query/index edge cases.
- `test/core/memory.test.ts` — 5 new tests: `skipCharCap` bypasses truncation, `loadRelevantLearnings` semantic path, fallback on empty queryText, fallback on absent `ollamaBaseUrl`, fallback when embed returns `[]`.
- `test/cli/provider.test.ts` — 1 new test: provider switch clears `ollamaEmbedModel`.


## v1.45.1 — 2026-04-25

Post-review patch. Propagates `PromptInterrupt` (Ctrl+C) handling through the remaining unguarded `ask()` call sites in `commit.ts` and `spec-template.ts`, adds `readConfigRaw()` error guards to `runProviderList` and `runProviderLogout`, removes a dead catch branch in the `:commit` REPL handler, and adds 6 regression tests to lock in the new behavior.

### Fixed

- **`runCommitFlow` — Ctrl+C no longer unhandled at all four `ask()` sites** — The PromptInterrupt propagation fix in Sprint 71 covered `:commit` (REPL path) and `init.ts` but missed the standalone `phase2s commit` path. `commit.ts` now catches `PromptInterrupt` in the secret-warning prompt, the main accept/edit/cancel prompt, the null-model manual-message fallback, and the `openEditor` inline readline fallback. All four paths print "Commit cancelled." and return cleanly.

- **`runTemplateUse` — Ctrl+C during placeholder wizard now handled** — `spec-template.ts` was missing the same `PromptInterrupt` catch. The wizard now prints "Template wizard cancelled." and returns instead of propagating an unhandled rejection.

- **`runProviderList` / `runProviderLogout` — malformed config no longer crashes** — Sprint 71 added a `readConfigRaw()` guard inside `runProviderLogin` but missed the other two provider commands. `runProviderList` now silently falls back to showing all providers without an active marker when the config is unreadable. `runProviderLogout` exits with an actionable error message.

- **Dead `PromptInterrupt` catch removed from `:commit` REPL handler** — `buildCommitMessage()` makes no `ask()` calls and can never throw `PromptInterrupt`; the catch branch was dead code that obscured the actual control flow.

### Tests

- 4 new Ctrl+C regression tests in `test/cli/commit.test.ts` covering the main prompt, secret-warning prompt, null-model fallback, and `openEditor` readline fallback.
- 2 new malformed-config tests in `test/cli/provider.test.ts` covering `runProviderList` (swallow + show all) and `runProviderLogout` (exit with error).
- `vi.mock` factory in `commit.test.ts` fixed to export `PromptInterrupt` via `importOriginal` so the real class is available for test throws.
- 2 brittle `mtime`-based assertions in `provider.test.ts` replaced with file-content comparison (APFS 1-second granularity made them flaky).

## v1.45.0 — 2026-04-25

Sprint 71 — Quality and polish. No new features; four targeted fixes that make the tool safer and more communicative: a silent config-overwrite bug is closed, Ctrl+C inside `:commit` now saves the session instead of bypassing it, error messages on the top failure paths gain actionable "→ what to do next" hints, and provider test coverage jumps from 2 to 16 cases.

### Fixed

- **`readConfigRaw` silent overwrite bug closed** — If `.phase2s.yaml` contains valid but non-mapping YAML (e.g. a list like `- item`), `readConfigRaw` previously returned `{}` and provider commands would silently replace the file with an empty config. It now throws the same error that `loadConfig()` has always thrown, so provider login aborts instead of overwriting the file.

- **Ctrl+C inside `:commit` no longer bypasses session save** — `prompt-util.ts` was calling `process.exit(0)` from a readline SIGINT listener, which killed the process before the REPL's own SIGINT handler could run its session-save-and-cleanup path. The fix moves SIGINT handling into the `ask()` promise as a rejection (`PromptInterrupt`), and the `:commit` flow in `index.ts` catches it and prints "Commit cancelled." The main REPL's SIGINT handler runs independently and saves the session as intended.

- **Actionable error messages on top provider failure paths** — Errors in `phase2s provider login` and `logout` now include a `→ what to do next` hint:
  - Unknown provider: `→ Run \`phase2s provider login <provider>\` with one of the names above.`
  - Invalid YAML file: `→ Fix the file manually (it must be a key: value mapping), then re-run \`phase2s provider login\`.`
  - Empty API key: `→ Enter a non-empty key when prompted, or paste it directly.`
  - No config file: `→ Run \`phase2s init\` to create a config file, then \`phase2s provider login <provider>\`.`

### Tests

- **16 provider tests** (was 9) — Seven new cases cover all the gaps: invalid YAML parse failure, list-format YAML (silent-overwrite regression test), empty API key, re-login same provider (model fields NOT cleared), ollama login (no key prompt), logout with key field absent from config, and a permission assertion that `statSync(configPath).mode & 0o777 === 0o600`.

- **3 prompt-util tests** — `ask()` resolves on normal input, rejects with `PromptInterrupt` on SIGINT without calling `process.exit`, and `PromptInterrupt` is a proper `Error` subclass.

## v1.44.0 — 2026-04-24

Sprint 70 — Provider subcommand and compaction testability. Users can now inspect and switch providers without re-running `phase2s init`. The compaction rm cleanup path is now fully testable via an injectable `rmFileFn?` dependency.

### Added

- **`phase2s provider` subcommand** — Three actions for provider management without touching `init`:
  - `phase2s provider list` — shows all 7 supported providers, marks the config-file active one, and warns if `PHASE2S_PROVIDER` env var overrides it.
  - `phase2s provider login [--provider <name>]` — switches provider and saves credentials to `.phase2s.yaml`. Clears the `model`, `fast_model`, and `smart_model` fields when switching providers (model slugs are provider-scoped; preserves them on re-login to the same provider). Preserves all other config fields (webhooks, `systemPrompt`, `tools`, `deny`, etc.) via YAML parse/patch/serialize. Creates `.phase2s.yaml` if neither `.yaml` nor `.yml` exists.
  - `phase2s provider logout` — removes the active provider's API key from the config file. For providers with no file-stored credentials (codex-cli, ollama), prints an informational message with no file write.

- **`src/cli/provider-registry.ts`** — Centralized registry for provider names, key field mappings, and validation. New `provider.ts` code uses it exclusively; consolidating existing inline enums in `init.ts`, `config.ts`, and `doctor.ts` is a future follow-up.

### Fixed

- **`rmFileFn?` injectable in `PerformCompactionDeps`** — The `fs.rm()` call in the atomic backup error-recovery path is now injectable via `rmFileFn?` following the same pattern as `writeFileFn?` and `renameFileFn?`. Two new test cases verify: (1) `rmFileFn` is called with the tmp path when `renameFileFn` throws, (2) the diagnostic `console.warn` fires when `rmFileFn` itself rejects.

## v1.43.0 — 2026-04-24

Sprint 69 — Security and resilience hardening. Seven low-priority backlog items resolved in one sweep, leaving the codebase clean for future feature work. The most visible change: `@file` Tab completion now finds files at any depth (not just depth ≤ 4) because BFS visits shallow directories first.

### Changed

- **`@file` Tab completion uses BFS traversal** — `collectMatchingFiles` is rewritten as iterative breadth-first search. Files in shallow directories are always surfaced before deeper matches with the same basename, so `@agent<Tab>` reliably returns `src/core/agent.ts` rather than a deeper `goal/agent-result-types.ts`. Safety caps: 500 results and 5,000 directories visited. The `depth` parameter is kept for API compatibility but is no longer used.

- **`:compact` backup is now crash-safe** — The session backup written before compaction now uses a tmp-then-rename atomic pattern (`backup.json.tmp.<pid>` → `backup.json`). A crash or power loss mid-write leaves either a complete backup or nothing — never a corrupt half-written recovery file.

### Fixed

- **`--sandbox` shell injection surface closed** — All `execSync` calls that embed variable paths (`worktreePath`, `branchName`, `originalBranch`) in shell strings are replaced with `execFileSync` array form. No shell is involved; special characters in paths cannot be exploited.

- **`--sandbox` state (b) TOCTOU** — After `git worktree prune`, the code now re-checks whether the branch still exists before calling `git worktree add`. If the branch was deleted externally between prune and add, it falls through to a clean fresh create rather than a failed-and-unrecoverable error.

- **`plans_write` symlink escape blocked** — If `plans/` is a symlink pointing outside the project root, `plans_write` now detects this and blocks the write with "plans/ directory resolves outside the project — symlink escape blocked". The check is skipped when `plans/` doesn't yet exist (correct behavior on first write).

## v1.42.0 — 2026-04-24

Sprint 68 — Polish and CI hardening. Three improvements that tighten up Sprint 67's work: `:dump html` now produces properly rendered HTML with `marked` (real headings, formatted code blocks, readable structure — not a `<pre>` dump of raw markdown), `@file` Tab completions are ranked so the most likely match surfaces first (exact prefix beats substring, shorter path beats longer), and the flaky `clone.test.ts` ENOTEMPTY teardown race is fixed for good.

### Added

- **`marked` v18 rendering for `:dump html`** — `renderSessionHtml()` now uses `marked` to convert the markdown transcript to proper HTML: `##` headings become `<h2>`, `---` becomes `<hr>`, fenced code blocks become `<pre><code>` with language classes. HTML content from message bodies is pre-escaped before rendering so `<script>` tags stay inert. `javascript:` hrefs are neutralized post-render. Self-contained output with no CDN dependencies.

- **Ranked `@file` Tab completions** — `rankCompletions()` sorts completions in-place after collection: basename prefix match ranks above substring match (`agent.ts` before `my-agent.ts`), shorter path ranks above deeper path for the same prefix, alphabetical tiebreak. Applied in both the `/`-prefix directory branch and the recursive basename search branch of `makeCompleter()`.

### Fixed

- **`clone.test.ts` ENOTEMPTY flaky CI** — `cloneSession` calls `upsertSessionIndex` fire-and-forget (no await), which writes lock files and `index.json.tmp.<pid>` inside `tmpDir` after `cloneSession` resolves. The old `afterEach` called `rmSync` immediately, racing those writes. Fixed by stubbing `upsertSessionIndex` via `vi.spyOn` in `beforeEach` so the fire-and-forget index write never runs during tests — eliminating the race at its source rather than adding a timing settle.

## v1.41.0 — 2026-04-23

Sprint 67 — REPL UX polish. Three features that make the REPL feel finished: fuzzy `@file` Tab completion (type `@agent<Tab>` and get `src/core/agent.ts` without knowing the path), `:dump` conversation export (markdown or self-contained HTML opened in browser), and `:help` command reference (cheat-sheet for every colon command, always one keypress away).

### Added

- **Fuzzy `@file` Tab completion** — when a `@fragment` contains no `/`, the completer now does a recursive basename substring search (depth 4, 500 result cap) across the whole project tree. `@agent<Tab>` returns `src/core/agent.ts`. When the fragment contains `/`, existing directory-prefix behavior is preserved for backward compatibility. Empty `@<Tab>` returns nothing (no whole-tree dump). `node_modules`, `dist`, `.git`, and dotfiles are skipped automatically.

- **`:dump` conversation export** — exports the current REPL session as a markdown file to `.phase2s/exports/session-{timestamp}.md`. `:dump html` additionally writes a self-contained `.html` file (dark/light mode, system font, `<pre>` wrap) and opens it in the default browser via `open`/`start`/`xdg-open`. No new dependencies — markdown is HTML-encoded and placed in a `<pre>` block.

- **`:help` command reference** — prints a formatted cheat-sheet of all REPL colon commands with aligned descriptions. Driven by a static `COMMAND_REGISTRY` array in `colon-commands.ts`. Zero runtime overhead, always up to date.

- **`COMMAND_REGISTRY` exported from `colon-commands.ts`** — static array of `{ command, description }` entries for all documented REPL commands. Consumed by both the `:help` handler and future tooling.

- **28 new tests** — `test/cli/dump.test.ts` (render functions), `:dump`/`:help` routing in `colon-commands.test.ts`, and `collectMatchingFiles`/fuzzy completer in `file-attachment.test.ts`.

## v1.40.0 — 2026-04-22

Sprint 66 — `:goal` REPL command. You can now run a goal spec from inside the REPL with `:goal specs/auth.md`. The goal runs in-process (no REPL exit, no `process.exit(2)` on rate limit) and reports success, failure, or rate-limit pause inline. Smart model widened to cover all retry-loop LLM callers. Compaction last-message preservation completed.

### Added

- **`:goal <path>` REPL command** — run a goal spec file from within the interactive REPL. `:goal specs/auth.md` kicks off `runGoal()` without leaving the session. Reentrant calls are blocked: a second `:goal` while one is running prints a warning and does nothing. Supports quoted paths for files with spaces.

- **`throwOnRateLimit` flag in `GoalOptions`** — prevents `process.exit(2)` from killing the REPL when a goal hits a 429. All three rate-limit callsites in `goal.ts` respect this flag; when set, `RateLimitError` is re-thrown to the caller instead of exiting the process.

- **Reasoning override threading** — `:goal` passes the current `:re` session override as `reasoningEffort` into `runGoal()`, so `smart_model` calls inside the goal respect your active reasoning tier.

- **Smart model widened to all retry-loop callers** — `replan`, `checkCriteria`, `analyzeFailures`, and `identifyFailedSubtasks` now use `effectiveSatoriModel` (falls back to `smart_model`) instead of always defaulting to `fast_model`. Consistency with the main Satori loop.

- **`handleRunGoalCase` exported for testability** — the `:goal` REPL handler extracted from the switch block into `handleRunGoalCase()` in `src/cli/index.ts`. 12 tests added covering reentrancy guard, all four success branches, `RateLimitError` with/without `retryAfter`, and generic error paths.

### Fixed

- **`satoriModel` vs `effectiveSatoriModel` bug** — sequential execution path in `goal.ts` used `satoriModel` (the raw config value) instead of `effectiveSatoriModel` (which falls back to `smart_model` if unset). No visible effect for users who set `satori_model` explicitly; fixes a silent no-op for everyone else.

- **`RunLogger` fd leak on `throwOnRateLimit`** — all three `throwOnRateLimit` throw sites in `goal.ts` now call `logger.close()` before rethrowing `RateLimitError`. Previously the log file descriptor was leaked on every REPL-mode rate limit.

- **Compaction XML prompt injection via `&`** — `buildCompactionSummary` escaped `<` and `>` in the dropped user message before escaping `&`. That meant an `&` in user content could become `&amp;` whose `&` was then re-escaped to `&amp;amp;`. Fixed: `&` is now escaped first to `&amp;` before `<` and `>` are escaped.

- **`:goal` usage error duplication** — both the empty-path and empty-parse branches in `handleColonCommand` inlined the same usage string. Extracted to a `GOAL_USAGE` constant.

## v1.39.0 — 2026-04-22

Sprint 65 — `@file` one-shot + `@url` attachment. Completes the `@token` story end-to-end: file references now work in `phase2s run "..."` (one-shot mode), and any `@https://...` token fetches and inlines the URL content using Mozilla Readability for clean article extraction.

### Added

- **`@file` in one-shot mode** — `phase2s run "explain @src/core/agent.ts"` now works. `expandAttachments()` is called on the effective prompt in `oneShotMode()` before `agent.run()`. Same 20KB / 500-line limits as REPL mode.

- **`@url` attachment** — `@https://...` and `@http://...` tokens in any prompt (REPL or one-shot) fetch the URL and inline the content as a `<file path="https://...">` preamble block. HTML pages are parsed with Mozilla Readability to strip navigation, ads, and boilerplate — the model gets article-quality text. Non-HTML responses (JSON, plain text, etc.) are inlined as-is. 10s timeout. Same size limits as `@file`.

- **SSRF protection for `@url`** — delegates to `getUrlBlockReason()` from `browser.ts`. Private IP ranges (RFC 1918, link-local, loopback, AWS metadata endpoint) are rejected before any network request is made.

- **New dependencies** — `linkedom` (lightweight DOM for Node.js) and `@mozilla/readability` (Mozilla's article extraction algorithm, used by Firefox Reader View) added to `dependencies`.

- **URL regex** — `ATTACH_URL_RE = /(?<!\w)@(https?:\/\/[^\s<>"'{}|\\^`[\]]+)/g`. The existing file regex gains `(?!https?:\/\/)` negative lookahead so URL tokens are not also partially matched as file tokens.

- **512KB HTML pre-parse limit** — HTML responses are rejected before linkedom DOM parsing when they exceed 512KB, preventing memory spikes from large HTML files that produce small article extracts.

- **Trailing punctuation stripped from URL tokens** — `@https://example.com/page.` no longer captures the trailing period; common sentence-ending characters (`. , ; : ! ? ) ]`) are trimmed after the URL regex match.

- **18 new tests** — `parseAttachTokens` URL extraction and trailing-punctuation stripping, `fetchUrlWithSizeGuard` (SSRF block, 404, network error, plain text, HTML fallback, 512KB pre-parse limit, 5MB body limit, 20KB post-parse, truncation, warned, redirect SSRF re-check), `expandAttachments` URL inline, error-preserving, and trailing-punctuation cleanup paths.

### Fixed

- **Path XML attribute injection** — `formatAttachmentBlock` now calls `escapeXml(f.path)` on the path attribute. A URL containing `"` would have broken the `<file path="...">` wrapper and could inject prompt content.

- **Redirect SSRF bypass** — `fetchUrlWithSizeGuard` re-checks `getUrlBlockReason(response.url)` after fetch completes. A server at a public IP could redirect to a private IP (e.g. `192.168.x.x`) and bypass the pre-fetch SSRF guard. The redirect destination is now validated the same way as the original URL.

- **Trailing punctuation lingers in `cleanLine`** — the URL token cleanup regex in `expandAttachments` now uses a `[.,;:!?)\]]*` suffix to consume trailing punctuation that was stripped from the token during `parseAttachTokens`. Previously, `@url.` left a trailing `.` in `cleanLine`.

- **Whitespace normalization collapses newlines** — changed `/ \s{2,}/g` to `/ {2,}/g` in `expandAttachments`. Replacing all runs of whitespace collapsed newlines in multi-line one-shot prompts.

- **DRY extraction of `applyLineLimits`** — identical `sizeWarning` / truncation blocks in `readWithSizeGuard` and `fetchUrlWithSizeGuard` extracted into a shared `applyLineLimits(text, maxLines)` helper.

## v1.38.0 — 2026-04-22

Sprint 64 — `@file` Fuzzy Attachment for the REPL. Type `@src/core/agent.ts` in any REPL prompt and the file is inlined as context before your message. Tab-completes like a shell path. Path traversal is rejected via `assertInSandbox`. Files over 20KB or 500 lines are capped or truncated with a visible notice.

### Added

- **`@path` token attachment** — any `@token` in a REPL prompt (not a bare email address) is resolved against `cwd`, sandboxed via `assertInSandbox`, and injected as a `<file path="...">` preamble block before the user's message is sent to `agent.run()`. Supports dotfiles, extensionless files (`@Makefile`), and multi-token prompts. 14 tests added.

- **Tab completion for `@` fragments** — `createInterface` is now wired with `makeCompleter(() => process.cwd())`. Pressing Tab while typing `@src/core/ag` completes to matching filenames. Directories get a trailing `/` so you can keep typing. The active `@fragment` at the cursor end is the only thing replaced on Tab — mid-sentence tokens are not disturbed.

- **Size limits** — files over 20KB return a hard error (not inlined). Files 201–500 lines are inlined with a `sizeWarning: "warned"` flag; files over 500 lines are truncated to 200 lines with `[truncated]` appended.

- **Error token preservation** — if a `@token` fails to read (not found, is a directory, path traversal rejected), the error is written to stderr and the `@token` is left in the prompt so the user sees what failed.

- **Dispatch safety** — `cleanLine` (tokens stripped) drives all command dispatch (`:clone`, `:compact`, `:commit`, `/skills`, `/quit`, `/help`, `handleColonCommand`). `effectiveLine` (preamble + cleanLine) is passed only to `agent.run()`. Satori snapshot slugs use `cleanLine` for readability.

- **`src/cli/file-attachment.ts`** — new module exporting `parseAttachTokens`, `readWithSizeGuard`, `formatAttachmentBlock`, `makeCompleter`, `expandAttachments`.

### Fixed

- **XML escaping in `formatAttachmentBlock`** — file content containing `<`, `>`, or `&` is now HTML-entity-escaped before injection into the `<file>...</file>` preamble block. Prevents a malicious file from breaking out of the XML wrapper and injecting prompt content.

- **FIFO/socket/device file hang** — `readWithSizeGuard` now calls `stat.isDirectory()` and `stat.isFile()` before reading. Named pipes and device files have `size === 0` (bypassing the 20 KB guard) and would cause `readFileSync` to block forever. Both checks return an error immediately without touching the file descriptor.

- **Token-as-substring corruption** — `expandAttachments` used `replaceAll("@src", "")` to strip resolved tokens. This would corrupt `@src/core/agent.ts` when `@src` also appeared in the prompt. Fixed with a regex that uses a negative lookahead `(?![\w./\-_])` to only match complete tokens.

- **Duplicate token deduplication** — repeated `@token` references in a single prompt (e.g. `@foo.ts explain @foo.ts`) read and attached the same file twice. Fixed with `[...new Set(tokens)]` before the read loop.

- **Tab completer O(n) `statSync`** — `makeCompleter` called `statSync` on every entry in the directory to determine if it was a directory. Fixed by passing `{ withFileTypes: true }` to `readdirSync` so `entry.isDirectory()` is available without a second syscall.

## v1.37.0 — 2026-04-22

Sprint 63 — Orchestrator Sibling Cancellation. When any worker in a multi-agent orchestrator level hits a 429, its sibling jobs now receive an abort signal immediately instead of running to completion. This closes the last gap in rate-limit resilience: parallel workers got sibling cancellation in v1.35.0; orchestrator workers get it now.

### Added

- **AbortController sibling cancellation for orchestrator workers** — `executeOrchestratorLevel()` now creates a per-level `AbortController`. Each job promise is wrapped with a `.catch()` that fires `controller.abort()` on `RateLimitError`. The `signal` is threaded into every `agent.run()` call so siblings exit at their next turn boundary instead of burning API quota to completion. `Promise.allSettled` already preserves completed work (since v1.36.0); this sprint adds the early-exit signal to stop new work from starting. 4 tests added.

### For contributors

- **`.catch()` abort pattern** — `executeOrchestratorLevel` uses `jobPromises.map(p => p.catch(err => { if (err instanceof RateLimitError) controller.abort(); throw err; }))` rather than `onRateLimitDetected` callback (the pattern used in `executeLevel`). Both achieve the same result; the `.catch()` wrapper is simpler here because there is no separate `executeOrchestratorWorker` abstraction to thread a callback through.

## v1.36.0 — 2026-04-22

Sprint 62 — Orchestrator Rate-Limit Checkpoint + Resume. When the multi-agent orchestrator hits a 429 mid-level, it now saves a checkpoint to `GoalState` and exits gracefully. Re-running with `--resume` picks up where it left off — completed jobs are rehydrated (including architect context files), suspect jobs re-run, and failed/skipped jobs are propagated forward. A path-traversal guard was also added: `job.id` from on-disk checkpoints is validated against `SAFE_JOB_ID_RE` before any context file path construction.

### Added

- **Orchestrator checkpoint on 429** — `executeOrchestratorLevel()` now throws `OrchestratorLevelRateLimitError` carrying `partialResults: OrchestratorLevelResult[]` from workers that completed before the rate limit hit. The orchestrator catches this, saves `state.orchestrator: OrchestratorCheckpoint` (completedJobs with stdout, pendingJobs, failedJobIds, skippedJobIds, suspectJobIds, currentLevel), and exits with the standard rate-limit exit code. Completed work is never re-executed on resume.

- **Orchestrator resume path** — `goal.ts` detects `state.orchestrator` on `--resume` and passes it as `options.checkpoint` to the orchestrator. The orchestrator rehydrates `jobStatus`, `completedJobs`, `completedStdout`, and context files (re-extracting architect sentinel content from stored stdout). The resume display shows "Resuming (N completed, M remaining)" instead of sub-task counts for orchestrator checkpoints.

- **`OrchestratorCheckpoint` type in `GoalState`** — New interfaces `OrchestratorCompletedJobCheckpoint` and `OrchestratorCheckpoint` added to `src/core/state.ts`. The optional `orchestrator?` field on `GoalState` holds the checkpoint; it is cleared to `undefined` on successful completion.

### Fixed

- **Path traversal in checkpoint context file writes** — `job.id` sourced from on-disk checkpoint data was used unvalidated in `join(contextDir, 'context-${job.id}.md')` at three sites in `orchestrator.ts`. A job ID of `../../etc/cron.d/evil` would have escaped the context tmpdir. All three construction sites now guard with `SAFE_JOB_ID_RE` (exported from `types.ts`). The regex `^[a-z0-9][a-z0-9-]*$` rejects any path-traversal character.

### For contributors

- **`SAFE_JOB_ID_RE` exported** — `const SAFE_JOB_ID_RE` in `orchestrator/types.ts` changed to `export const` for reuse in `orchestrator.ts` guard sites.
- **`handleRateLimitExit` in `goal.ts`** — Now passes `checkpointed: state.orchestrator !== undefined` so the correct "checkpoint saved" vs. "progress lost" message appears after a 429 in orchestrator mode.

## v1.35.0 — 2026-04-21

Three resilience improvements that required prior foundation work: parallel workers now cancel each other when one hits a rate limit, auto-compaction stops cascading after a configurable cap, and `--reasoning-effort` gives you model-tier control on dark factory runs.

### Added

- **AbortController sibling cancellation** — When one parallel worker hits a rate limit, its siblings' HTTP streams are cancelled immediately instead of running to completion. Less wasted API budget when a batch has to pause. Completed work is preserved via `Promise.allSettled`; aborted workers return `{ status: "failed" }` so the retry loop handles them correctly.

- **Cascading auto-compaction cap** — Auto-compaction now stops after a configurable number of cycles. Add `max_auto_compact_count: 3` to `.phase2s.yaml` (or leave it unset — the default cap is 3). Previously, a verbose compaction summary could push context back over the threshold and trigger another compaction, degrading summary fidelity with each pass. Manual `:compact` doesn't count toward the cap.

- **`--reasoning-effort` flag** — `phase2s goal --reasoning-effort high|low|default <spec>` overrides the model tier for all unlabeled subtasks: `high` → `smart_model`, `low` → `fast_model`, `default` → no change. Applies to both parallel workers and orchestrator mode. Also available on `phase2s run --reasoning-effort <level>` as a per-invocation fallback when skill routing doesn't specify a model.

### Changed

- **`shouldCompact()`** — New optional `compactCount` and `maxAutoCompactCount` parameters. Backward-compatible: calling without them behaves identically to v1.34.0.
- **`executeOrchestratorLevel`** — New optional `modelOverride` parameter threads `effectiveSatoriModel` into orchestrator workers.

### Fixed

- **Auto-compact cap now counts only real compactions** — `auto_compact_count` was incrementing even when `performCompaction()` returned early due to a backup write failure or an empty summary. The cap could be exhausted silently without any actual compaction occurring. The counter now only increments when `onJustCompacted` fires (compaction actually replaced the conversation).
- **`--reasoning-effort` validates at parse time** — Invalid values like `--reasoning-effort medium` previously fell through the TypeScript cast and ran at default effort with no warning. Now they exit immediately with a clear error message.

## v1.34.0 — 2026-04-20

Sprint 60 — Skills Quality Audit. Six D-rated built-in skills rewritten to B+ standard: `review`, `ship`, `docs`, `investigate`, `tdd`, and `skill`. All six now have structured verify steps and save artifacts to `.phase2s/` with datetime-stamped filenames. The `skill` meta-skill now generates structural `## Output`, `## Verify`, and `## Save` sections so every new skill starts at B-quality minimum. Separately, 14 parameterized skills gain typed `inputs:` frontmatter with named MCP parameters and `{{param}}` body substitution — `adversarial`, `audit`, `autoplan`, `checkpoint`, `consensus-plan`, `debug`, `deep-specify`, `explain`, `freeze`, `land-and-deploy`, `qa`, `remember`, `satori`, and `slop-clean`.

### Changed

- **`/review`** — unconditional `npm test` verify step (always runs, not just after inline fixes). Scoped by optional `{{scope}}` path. Saves report to `.phase2s/review/<datetime>-<branch>.md`.

- **`/ship`** — reads `package.json` scripts to detect test command. Hard block on failure: "Tests failed — fix before shipping." Graceful skip if no test script: "No test script found — skipping test gate." Structured PRE-FLIGHT output block.

- **`/docs`** — optional `{{path}}` input; falls back to `git diff` when blank. `tsc --noEmit` verify with tsconfig.json guard (skip if not TypeScript). Saves summary to `.phase2s/docs/<datetime>-<slug>.md`.

- **`/investigate`** — `{{bug}}` input as problem statement. Saves log to `.phase2s/debug/<datetime>-investigate-<slug>.md` (`investigate-` prefix distinguishes from `/debug` outputs).

- **`/tdd`** — `{{feature}}` input for behavioral contract. Red → Green → Refactor protocol. Saves spec to `.phase2s/specs/<datetime>-<slug>.md`.

- **`/skill`** — four-question interview now asks whether the skill makes code changes or writes files; generated template includes structural `## Output` (always), `## Verify` (if code changes), and `## Save` (if file writes) sections. Documents `inputs:` block format for parameterized skills.

- **`/adversarial`** — `{{plan}}` input replaces "plan is in the conversation above" implicit behavior. Works correctly when called via MCP without conversational context.

- **`/audit`** — optional `{{scope}}` restricts scanning to a directory. Save path updated to `.phase2s/security-reports/<datetime>.md` with HHMM to avoid same-day collision.

- **`/autoplan`** — optional `{{plan_file}}` input; falls back to `TODOS.md` and recent commits when blank.

- **`/checkpoint`** — optional `{{note}}` for user-provided context; infers everything else from git state. Save path includes HHMM.

- **`/consensus-plan`** — `{{plan}}` input as the plan text to review.

- **`/debug`** — `{{bug}}` input replaces the "if no context: ask" conditional. Save path updated to `.phase2s/debug/<datetime>-<slug>.md` with HHMM.

- **`/deep-specify`** — `{{feature}}` input for the feature description; skips the opener question when provided.

- **`/explain`** — `{{target}}` already used in body; `inputs: target` frontmatter added to expose it as MCP parameter.

- **`/freeze`** — `{{directory}}` input replaces interactive prompt; confirms freeze immediately.

- **`/land-and-deploy`** — optional `{{description}}` used as PR title when provided.

- **`/qa`** — optional `{{path}}` focuses QA on a specific directory or file; falls back to git diff.

- **`/remember`** — `{{content}}` and `{{type}}` inputs (with enum) replace the two interactive questions; saves directly without prompting.

- **`/satori`** — `{{task}}` and `{{eval_command}}` inputs; eval command referenced in the run loop.

- **`/slop-clean`** — optional `{{path}}` replaces the argument-parsing prose at the bottom.

### Docs

- **`docs/memory.md`** — updated "What Phase2S writes to disk" table with new artifact paths: `.phase2s/review/`, `.phase2s/docs/`, `.phase2s/debug/<datetime>-investigate-*`, `.phase2s/security-reports/`. Updated date format notes (all paths now use YYYY-MM-DD-HHMM).

---

## v1.33.0 — 2026-04-20

Sprint 59 — Rate Limit Hardening. When the provider returns a 429, your session is now saved before exiting — including the message you just sent — so `--resume` picks up with full context and nothing is lost. Parallel runs now preserve completed workers' results when one worker hits a rate limit; only the interrupted worker re-runs on resume. Blocked providers (content policy or account-level refusals) now show ⛔ with a "Switch provider" hint instead of the standard ⏸ pause message. Backoff utilities and compaction logic extracted to standalone modules for better testability.

### Added

- **`src/providers/backoff.ts`** — shared auto-backoff constants and utilities extracted from `openai.ts`. Exports `MAX_RATE_LIMIT_RETRIES`, `MAX_RETRY_AFTER_SECONDS`, `sleep()`, and `parseRetryAfter()`. `openai.ts` re-exports for compatibility.

- **`src/core/compaction.ts`** — `performCompaction()` extracted from `index.ts` with injectable deps (`writeFileFn`, `buildCompactionSummaryFn`, `saveSessionFn`). Fully unit-tested with 5 error-path tests. `buildCompactionSummary()`, `buildCompactedMessages()`, `getCompactBackupPath()`, `shouldCompact()` also moved here.

- **`RateLimitError.kind` field** — `"rate_limited"` (transient 429) vs `"blocked"` (non-transient policy refusal). `printRateLimitAndExit` now branches on `kind`: blocked exits show ⛔ and "Switch provider" hint; rate-limited exits show ⏸ with retry timing.

- **`handleRateLimitExit()` helper** — consolidates 5 duplicated save-then-exit blocks in `index.ts` into a single `async (err) => { await saveSession(); return printRateLimitAndExit(...); }` closure.

- **`test/cli/rate-limit-session.test.ts`** — 4 new tests verifying that `saveSession()` correctly persists conversations including the latest user message before a rate-limit exit. Covers first-turn 429, later-turn 429, and directory auto-creation.

- **`test/core/rate-limit-error.test.ts`** — 10 tests for `RateLimitError` constructor covering `retryAfter`, `kind`, `providerName`, and message formatting for all constructor overload forms.

- **`test/providers/backoff.test.ts`** — 19 tests for `parseRetryAfter` (integer form, HTTP-date form, edge cases, overflow cap) and `sleep`.

- **`test/providers/codex.test.ts`** — 7 new tests for Codex rate-limit detection including the A3 fix: non-zero exit with partial text now correctly yields `rate_limited`.

- **`test/goal/parallel-executor.test.ts`** — 8 new tests verifying `Promise.allSettled` behavior: all sibling results are preserved when one worker 429s (A1 fix).

### Changed

- **`performCompaction` injection: `saveSessionFn` now required** — was optional, creating a silent no-op if omitted. Made required so TypeScript catches callers that forget to pass it. Existing callers already supplied it.

- **Parallel executor uses `Promise.allSettled`** — was `Promise.all`, which abandoned in-progress workers on the first rejection. Now collects all fulfilled results before re-throwing the first `RateLimitError`.

### Fixed

- **Session saved before every rate-limit exit** — 5 call sites in `index.ts` now `await saveSession()` before `printRateLimitAndExit()`. Previously the last user message was lost from the session file when a rate limit fired mid-turn. Now `--resume` always includes it.

- **Codex rate-limit detection on partial text** — removed a guard that suppressed 429 detection when the model had already started streaming text. Non-zero exit with partial text now correctly yields `rate_limited` and checkpoints cleanly.

---

## v1.32.0 — 2026-04-20

Sprint 58 — Rate Limit Resilience. All providers now detect HTTP 429 and emit a typed `rate_limited` event. Configurable auto-backoff retries before checkpointing. `phase2s goal` exits 2 (paused) on rate limit so CI can distinguish "problem" from "paused." The REPL silently checkpoints and exits 0.

### Added

- **`RateLimitError`** (`src/core/rate-limit-error.ts`) — typed Error subclass carrying optional `retryAfter: number | undefined` (seconds until reset) and `providerName: string | undefined`. Thrown by all provider wrappers when a rate limit is detected. Caught in `agent.ts`, `goal.ts`, and `index.ts` for differentiated handling.

- **`rate_limited` provider event** — new event type on the `ProviderEvent` union. All providers (OpenAI, Anthropic, Codex, Gemini, OpenRouter, Minimax) yield `{ type: "rate_limited", retryAfter?: number }` instead of throwing on 429 or process-level rate-limit detection.

- **Auto-backoff in OpenAI and Anthropic providers** — when `Retry-After` is present and ≤ `rate_limit_backoff_threshold` (default 60 s), the provider sleeps and retries transparently. Budget: up to 3 total attempts per `chatStream()` call. Budget exhausted or delay too long → yields `rate_limited` immediately.

- **`rate_limit_backoff_threshold` config field** — integer seconds (default 60). Set to `0` to disable auto-backoff entirely. Negative values rejected by schema.

- **`parseRetryAfter()`** (`src/providers/openai.ts`, exported) — parses both integer-seconds (`"47"`) and HTTP-date (`"Wed, 21 Oct 2025 07:28:00 GMT"`) Retry-After header values. Returns `undefined` on parse failure. Capped at 3600 s to prevent `setTimeout` 32-bit overflow. Shared by OpenAI and Anthropic providers.

- **`phase2s goal` exit 2 on rate limit** — `handleRateLimitExit()` in `goal.ts` prints a paused message with provider name, completed/total sub-task count, and `--resume` / `--provider` instructions, then calls `process.exit(2)`. Triggered from all three execution paths (sequential, parallel, orchestrator).

- **In-flight sub-task checkpointed on rate limit** — when the sequential executor hits a rate limit mid-sub-task, the interrupted sub-task is now written to state as `"failed"` (with partial failure context) before throwing. Previously it was silently skipped, so `--resume` lacked failure context for the interrupted sub-task.

- **REPL rate-limit handling** — `printRateLimitAndExit()` in `index.ts` saves the session, prints a paused message with `--resume` path, and exits 0. A rate limit in the REPL is treated as "pause, not failure."

### Changed

- **`codex.ts` `stderrBuffer` capped at 64 KB** — prevents unbounded memory growth when Codex emits excessive stderr (e.g., verbose debug output or error traces).

### Fixed

- **`parseRetryAfter` overflow guard** — integer Retry-After values larger than 3600 are clamped to 3600 s, preventing Node.js `setTimeout` 32-bit wrap-around with absurd server values.

- **Anthropic abort + 429 race** — `_chatStreamOnce` sets `doneEmitted = true` before re-throwing a 429 error so the `finally` block doesn't emit a spurious `done` event before the outer `chatStream()` catch handler can apply backoff.

- **`MAX_RATE_LIMIT_RETRIES` comment clarified** — the constant is an attempt ceiling (1 initial + 2 retries = 3 total), not a retry count. Comment now says so explicitly.

### For contributors

- **`sleep`, `parseRetryAfter`, `MAX_RATE_LIMIT_RETRIES` exported** from `src/providers/openai.ts` — shared by Anthropic provider and test suites; import from `openai.ts` until a dedicated `backoff.ts` utility is extracted (tracked in TODOS.md).

- **`RateLimitError` exported** from `src/core/rate-limit-error.ts` — carry `retryAfter` and `providerName` through the call stack without string-parsing.

---

## v1.31.0 — 2026-04-19

Parallel dark factory gets smarter retries: a replan agent reads the actual eval failure output and rewrites only the failing sub-tasks before each retry attempt. Plus tech stack discovery in `/deep-specify` and a REPL output formatting fix.

### Added

- **Replan agent** — when a parallel goal run fails acceptance criteria, a single-shot LLM agent reads what actually failed (the last 4096 chars of eval output, where test failures appear) and produces revised sub-task descriptions targeting the root cause. Only the implicated sub-tasks re-run on retry. If the agent can't produce actionable revisions, the retry proceeds with the original descriptions.

- **Parallel goal retry loop** — the parallel execution path now retries up to `--max-attempts` times, matching sequential mode behavior. Each retry calls the replan agent, resets level state, and tracks the real attempt count.

- **`/deep-specify` tech stack discovery** — three questions added before the main interview (language/runtime, framework, deployment target). Answers flow into the `Constraint Architecture` section as a `Tech Stack` field, so the generated spec already encodes what you're building on.

### Fixed

- **REPL newline injection** — when the model produces text before a tool call, a newline is now injected between that turn and the next. Previously, response paragraphs from back-to-back tool calls ran together without a separator.

### For contributors

- **`buildWorkerPrompt` exported** (`src/goal/parallel-executor.ts`) — pure function now exported for testability; accepts optional `revisedDescription` for retry paths.

## v1.30.0 — 2026-04-18

Sprint 56 — AGENTS.md completion: one-shot and MCP injection.

### Added

- **AGENTS.md in one-shot mode** — `phase2s run "..."` now loads AGENTS.md and injects it into the system prompt, matching REPL behavior. ENOENT is silent; other filesystem errors (EACCES, EISDIR) are surfaced as dim warnings.

- **AGENTS.md in MCP server** — The MCP server (`phase2s mcp`) loads AGENTS.md once at startup alongside config. Every tool call now receives the AGENTS.md block automatically. Changes to AGENTS.md during a running session require server restart (same behavior as `.phase2s.yaml` config changes).

### Changed

- **`handleRequest()` signature** — Added optional `agentsMdBlock?: string` as a 6th parameter. All existing callers continue to work without changes (param is optional).

- **`oneShotMode()` exported** — The function is now exported from `src/cli/index.ts` to support direct unit testing.

- **Error visibility for AGENTS.md load failures** — Non-ENOENT errors (permission denied, directory named AGENTS.md, etc.) now surface a warning instead of being swallowed silently.

### Docs

- **`docs/configuration.md`** — New `## AGENTS.md` section documents all three injection modes (REPL, one-shot, MCP) and the MCP server restart requirement.

---

## v1.29.0 — 2026-04-13

Sprint 55 — Context Compaction + AGENTS.md support.

### Added

- **Context compaction** — Long sessions can now be compacted on demand (`:compact` REPL command) or automatically when a token threshold is exceeded (`auto_compact_tokens` config). The session provider generates a structured summary covering files changed, decisions made, errors resolved, and current goal. The full conversation is replaced with a `[COMPACTED CONTEXT]` message, and a `.compact-backup.json` file is written before any destructive replacement. The `compact_count` field on `SessionMeta` tracks how many times a session has been compacted.

- **AGENTS.md injection** — Phase2S now reads `~/.phase2s/AGENTS.md` (user-global) and `{cwd}/AGENTS.md` (project-level) at startup and injects their contents into the system prompt. Both can coexist; user-global content is prepended, project content appended. Content is capped at 8 192 chars with a warning. Drop project conventions in `AGENTS.md` and every session picks them up automatically.

- **`auto_compact_tokens` config field** — Set a positive integer threshold (e.g. `auto_compact_tokens: 80000`) in `.phase2s.yaml` to trigger automatic compaction before each turn when estimated context exceeds the threshold. Unset disables auto-compaction (default).

- **Doctor AGENTS.md check** — `phase2s doctor` now reports whether user-global and/or project-level `AGENTS.md` files are present, and tips the user to create one if neither exists.

### Changed

- **Compaction utilities** — `shouldCompact`, `getCompactBackupPath`, `buildCompactedMessages`, and `COMPACTED_CONTEXT_MARKER` are exported from `src/core/compaction.ts` as testable pure functions. `index.ts` delegates to them rather than embedding inline logic.

- **`Agent.provider` getter** — The provider is now accessible via `agent.provider`. The private field was renamed `_provider` to avoid a naming conflict with the getter.

### Fixed

- **AGENTS.md drops on `--resume`** — Resuming a session with `--resume` previously discarded the AGENTS.md system prompt and replaced it with the stale one from the saved file. The agent now always rebuilds a fresh system prompt (including AGENTS.md) at construction time and uses `setConversation()` to merge resumed messages, leaving the current system prompt intact.

- **AGENTS.md drops on persona switch** — Switching agent personas with `:ask`, `:plan`, `:build`, or `:agent <id>` previously overwrote the system prompt entirely, losing any AGENTS.md content. AGENTS.md is now stored separately from the per-persona `systemPrompt` and re-combined on every persona switch.

- **Compaction backup overwrite on repeated `:compact`** — Compacting the same session twice overwrote the first backup with the second, destroying the earlier history snapshot. Backup paths are now stamped with the compaction count (`.compact-backup-1.json`, `.compact-backup-2.json`, ...), so each compaction writes a distinct file.

- **Silent split-state on compaction save failure** — If the session file could not be saved after compaction, the in-memory conversation was already replaced with the compacted version but the saved file was not updated, causing an inconsistency on next resume. The failure is now caught and displays: "Compact applied in memory, but session save failed — compaction will be lost on restart."

- **Token display off-by-1000x in compaction notice** — The status line showed e.g. "85000k tokens" because `estimateTokens()` returns raw tokens, not thousands. Now shows "85k tokens".

- **`auto_compact_tokens: 0` passed validation** — Setting `0` previously passed Zod schema validation and would fire compaction on every turn. The field now requires a positive integer (`min(1)`); `0` is rejected with a clear validation error. Omit the field entirely to disable auto-compaction.

- **`:compact` missing from `/help`** — The `:compact` REPL command was not listed in the `/help` output. It now appears alongside `/help`, `/quit`, and `/exit`.

## v1.28.0 — 2026-04-13

Sprint 54 — Housekeeping: watcher teardown, sandbox guard, test coverage.

### Added

- **`--sandbox` non-git guard** — Running `phase2s --sandbox` now exits immediately with a clear error message if the target directory doesn't exist or isn't a git repository, rather than producing a confusing "detached HEAD" error. Two cases distinguished: a missing directory says "does not exist"; an existing directory outside a repo says "not a git repository" and suggests `git init`.

- **Watcher teardown handle** — `setupSkillsWatcher()` now returns a `{ close(): void }` handle. The MCP server stores it and calls `watcher?.close()` on shutdown, cleaning up the debounce timer and stopping the fs.watch listener. Prevents watcher pile-up on repeated server restarts.

- **Test coverage catch-up** — 88 new tests across four files:
  - `test/providers/openai.test.ts` (new) — 14 tests for `OpenAIProvider` using constructor injection: streaming, tool calls, abort, rate limit, signal passthrough.
  - `test/mcp/tools.test.ts` (new) — 25 tests for `skillToTool`, `toolNameToSkillName`, `STATE_TOOLS`, `GOAL_TOOL`, `REPORT_TOOL`, and `buildNotification`.
  - `test/mcp/handler.test.ts` (new) — 12 tests for `handleRequest` in isolation: skill dispatch, state tools, goal/report validation, session persistence.
  - `test/mcp/watcher.test.ts` (extended) — 6 new tests for the watcher handle return value and debounce-timer cancellation on close.
  - `test/cli/sandbox.test.ts` (extended) — 8 new tests for `listWorktreePaths` error discrimination and `startSandbox` non-git preflight.

### Fixed

- **`listWorktreePaths` now rethrows non-ENOENT errors** — Previously it swallowed all errors, which could silently misclassify a registered worktree as absent. Now only ENOENT (cwd does not exist) returns `[]`; any other error (git lock, permission denied, non-zero exit) is rethrown so callers fail loudly. Note: with string-form `execSync`, ENOENT signals a missing working directory, not an absent git binary (a missing git binary produces exit code 127 instead).

- **Watcher debounce timer cleared on close** — Calling `close()` on the watcher handle now cancels any pending 80ms debounce before stopping the fs.Watcher. Previously a timer started just before shutdown could fire once more and attempt to write to a closed stream.

## v1.27.0 — 2026-04-13

Sprint 53 — SIGINT Cooperative Cancellation + `phase2s sandboxes` + MCP Correctness.

### Added

- **`phase2s sandboxes`** — New command that lists all active sandbox worktrees for the current repository. Shows sandbox name, worktree path, and short commit hash in a padded table. Prints `(none)` when no sandbox worktrees exist. The missing "ls" for `--sandbox`.

- **Cooperative SIGINT cancellation** — Ctrl-C during an active provider call now cancels the in-flight request rather than waiting for it to finish. `AbortSignal` is threaded through `agent.run()` → `chatStream()` → all 7 providers. Codex processes receive `SIGTERM`; SDK-based providers (OpenAI, Anthropic, Ollama, OpenRouter, Gemini, MiniMax) pass the signal to the SDK's HTTP layer. Abort errors from the SDK are suppressed cleanly — no spurious error messages on voluntary cancel.

### Fixed

- **MCP underscore skill names** — A custom skill named `my_skill` (with native underscores) previously resolved to `my-skill` via the `toolNameToSkillName` round-trip, causing `-32601 Tool not found` for any MCP invocation. `skillToTool()` now stores the original skill name in `_skillName` on the tool descriptor; `handleRequest` uses it directly instead of reversing the hyphen→underscore transform.

## v1.26.0 — 2026-04-13

Sprint 52 — MCP Server Decomposition + `--sandbox` flag.

### Added

- **`phase2s --sandbox <name>`** — Start an isolated REPL session inside a fresh git worktree (`sandbox/<name>` branch, `.worktrees/sandbox-<name>` path). When you exit, you're asked whether to merge back into your original branch. Four-state detection handles resume, stale entry recovery, orphaned directory cleanup, and fresh creation. Uncommitted changes inside the sandbox trigger a warning and second confirmation before merge cleanup — your work is never silently discarded. Use it for spikes, experiments, or risky refactors you want to try before touching your main branch.

- **MCP session persistence** — Conversation history now persists across multiple calls to the same skill within a Claude Code session. The MCP server maintains a `sessionConversations` map (one `Conversation` per skill, keyed by skill name). Multi-turn skills like `/satori` and `/consensus-plan` resume where they left off rather than starting cold on each invocation.

- **MCP crash guard** — Uncaught errors in `handleRequest` are now caught at the server loop level and returned as JSON-RPC `-32603` internal errors. Previously, a filesystem error (e.g., EACCES on disk full) during `state_write` could crash the MCP server and require a Claude Code project reload.

### Changed

- **`src/mcp/server.ts`** decomposed into four focused modules:
  - `src/mcp/tools.ts` — MCP tool descriptors, type definitions, and conversion utilities (`skillToTool`, `toolNameToSkillName`, `STATE_TOOLS`, `GOAL_TOOL`, `REPORT_TOOL`)
  - `src/mcp/watcher.ts` — Skills directory hot-reload watcher with debounce (`WATCHER_DEBOUNCE_MS = 80`)
  - `src/mcp/handler.ts` — JSON-RPC request handler (`handleRequest`) with all protocol logic
  - `src/mcp/server.ts` — Slim barrel entry point: stdin loop, config pre-loading, session conversation map

- **Config pre-loading** — `loadConfig()` is called once at MCP server startup and forwarded to `handleRequest` as an optional `preloadedConfig` parameter. Eliminates one disk read per tool call.

### Tests

- `test/cli/sandbox.test.ts` (new, 28 assertions) — full sandbox state machine: slugify, four-state detection, merge-back flows, uncommitted work warning, resume forwarding, checkout vs merge failure distinction
- `test/mcp/server.test.ts` — crash guard: mocked `state_write` throws EACCES, server returns JSON-RPC error instead of crashing

## v1.25.0 — 2026-04-12

Sprint 51 — Decompose index.ts: pure refactor that extracts colon command dispatch and model resolvers out of the 1,444-line `src/cli/index.ts` god file.

### Changed

- **`src/cli/colon-commands.ts`** (new) — `handleColonCommand(trimmed, ctx)` returns a `ColonAction` discriminated union (`not_handled | show_reasoning | set_reasoning | list_agents | switch_agent | unknown_agent | unknown_command | error`). Pure function: no side effects, no console output. The REPL loop switches on the return value and applies state + output.
- **`src/cli/model-resolver.ts`** (new) — `resolveReasoningModel(override, config)` and `resolveAgentModel(agentModel, config)` extracted from `interactiveMode()`. Both are stateless pure functions.
- **`src/cli/index.ts`** — Inline `:re`, `:agents`, agent-switching, and unknown-command dispatch (~81 lines) replaced with a `handleColonCommand` switch (~30 lines). `resolveReasoningModel` and `resolveAgentModel` are now imported. Net: 1,444 → 1,392 lines.
- **`set_reasoning` warning fix** — `:re high` when `smart_model` is not configured now correctly shows `⚠ smart_model not configured` (was silently skipped in the refactored path).
- **Bare-id agent switching preserved** — `ares`, `apollo`, `athena` without colon prefix continue to work as documented in `docs/agents.md`.

### Tests

- `test/cli/colon-commands.test.ts` (new, 29 assertions) — unit tests for `handleColonCommand`: not_handled, `:re` variants, `:agents`, agent switching (bare ids, colon aliases, `:agent <id>`), unknown commands
- `test/cli/model-resolver.test.ts` (new, 13 assertions) — unit tests for both resolver functions including unconfigured-model and empty-string config guard cases
- `test/cli/integration.test.ts` — added `writeReplState on agent switch` (2 tests) as regression guard for persistence side effects
- `test/cli/cwd-and-re.test.ts` — removed 4 stale inline tests superseded by model-resolver.test.ts

## v1.24.0 — 2026-04-10

Sprint 50 — Named Agents: three built-in agent personas with hard tool registry enforcement, REPL switching, and resume persistence.

### Added

- **Named agent personas** — Three built-in agents, each with a constrained tool registry enforced at the registry level (not the system prompt level):
  - **Apollo** (`:ask` alias, `fast` model) — Read-only Q&A. Tools: `glob`, `grep`, `file_read`, `browser`. No write access.
  - **Athena** (`:plan` alias, `smart` model) — Planning assistant. Tools: `glob`, `grep`, `file_read`, `browser`, `plans_write`. Cannot execute shell or overwrite source files.
  - **Ares** (`:build` alias, `smart` model) — Full-access default agent. Full tool registry including `shell`, `file_write`, and all read tools.
- **`plans_write` tool** — Sandboxed write tool for Athena that restricts writes to the `plans/` directory. Separator-aware path check prevents `plans-evil/` bypass. Refuses to truncate existing files to empty content. Auto-creates `plans/` on first write.
- **`:agents` REPL command** — Lists all available agents with their id, aliases, model tier, and tool count.
- **Agent switching commands** — Type `:apollo`, `:ask`, `:athena`, `:plan`, `:ares`, `:build`, or `:agent <id>` to switch agent mid-session. Preserves conversation history; only the tool registry and system prompt change.
- **`--resume` agent persistence** — Active agent is saved to `ReplState` (`session.ts`) and restored on `phase2s --resume`. If the saved agent no longer exists, falls back to default with a warning.
- **Project agent overrides** — Place `.phase2s/agents/<name>.md` to override a built-in agent's system prompt. Override-restrict policy: project overrides may only narrow the tool list, never expand it. `tools: []` in an override is treated as explicit deny-all (not "no restriction").
- **Custom agents** — Any `.phase2s/agents/<name>.md` with a new id (not overriding a built-in) is loaded as an unrestricted custom agent.
- **`src/utils/frontmatter.ts`** — Shared YAML frontmatter parser used by both skill loader and agent loader. Handles CRLF line endings, malformed YAML (returns empty meta rather than throwing), and trims the body.

### Fixed

- **Skill and agent loaders now share one YAML parser** — `src/skills/loader.ts` was duplicating the frontmatter parsing logic that `agent-loader.ts` also needed. Both now use `parseFrontmatter()` from `src/utils/frontmatter.ts`. One less place to update if the format ever changes.

## v1.23.0 — 2026-04-10

Sprint 49 — Vegetables Sprint: five deferred items shipped before the next architecture sprint.

### Added

- **`phase2s doctor --fix`** — Rebuilds the session index from disk and runs the DAG integrity check. Surfaces orphaned or stale index entries, reports recovered sessions, and exits 1 on any failure (write error, permission denied on sessions directory, or DAG integrity warnings). Previously the only way to recover a corrupted index was to delete it by hand.
- **`-C <path>` global flag** — Run any phase2s command as if started in `<path>`. Evaluated before any subcommand runs (`process.chdir()` via Commander `preAction` hook), so `phase2s -C ~/my-project conversations` works without wrapping in a `cd`. Error messages distinguish "no such directory" from "not a directory."
- **`:re [high|low|default]` REPL command** — Switch reasoning effort in the current session without editing `.phase2s.yaml`. `:re high` routes normal turns through `smart_model`, `:re low` through `fast_model`, `:re default` resets to config. `:re` with no args shows the current tier and model. Applies to normal turns only; skill invocations keep their declared model tier.
- **Tool error reflection in satori** — When a tool call fails during a satori subtask attempt, a structured three-question reflection fragment is injected before the next retry. Fires on attempt 1 only to avoid double-reflection noise from the doom-loop protocol. Disable with `PHASE2S_TOOL_ERROR_REFLECTION=off`.
- **Bash `:()` limitation warning in `phase2s setup --bash`** — The setup output now documents the known incompatibility between the `:` function override and `${VAR:=default}` expansion patterns in `.bash_profile`. Includes the safe replacement (`${VAR:-default}`). The same content is in `docs/getting-started.md`.

### Fixed

- **`rebuildSessionIndexStrict` lock contention** — When the session index lock was held by a concurrent process, the strict variant silently returned an in-memory index without writing it to disk, causing `doctor --fix` to report success when nothing was actually repaired. Now throws so the caller can exit 1 with a clear error.
- **`doctor --fix` stale-entry count** — When session files had been deleted since the last index write, the recovered count was negative and the output misleadingly said "index was current." Now correctly reports "Cleaned up: N stale entries."
- **`-C` validation TOCTOU** — The `-C` hook previously called `existsSync` then `statSync` separately, creating a race window. Collapsed to a single `statSync` call with ENOENT handling.
- **`:re` case sensitivity** — `:re HIGH` now works; arguments are lowercased before matching.
- **Anthropic consecutive-user-message 400** — `translateMessages()` in the Anthropic provider now merges a trailing plain user message into the preceding synthetic tool-result user message as a `text` block, instead of emitting a second `user`-role message. Without this fix, enabling tool error reflection with the Anthropic provider caused a 400 "consecutive user messages" rejection on every tool-failure retry.
- **`doctor --fix` silently swallowed EACCES** — `scanSessionsDir()` previously caught all `readdir` errors and returned `null`, causing a permission-denied error on the sessions directory to masquerade as "Cleaned up N stale entries" and exit 0. Now only `ENOENT` returns null; other errors propagate so `doctor --fix` exits 1 with the real error.
- **`doctor --fix` DAG failure did not exit 1** — DAG integrity warnings were logged but the process still exited 0, contradicting the documented "exits 1 on failure" contract. Now exits 1 immediately after logging DAG warnings.
- **`doctor --fix` fresh-install messaging** — On a clean install with no sessions and no index, the output previously said "index was current — 0 entries," which is confusing when there is nothing to index. Now says "Nothing to repair — no sessions found."

## v1.22.3 — 2026-04-09

Sprint 48 — Lock correctness closure + doom-loop prevention.

### Fixed

- **PID-suffixed tmp files in `writeReplState` and `cloneSession`** — Both functions now use `path + ".tmp." + process.pid` instead of the bare `path + ".tmp"`. Without the suffix, two concurrent processes that both lost the migration lock could race on the same `.tmp` file and silently corrupt `state.json` or a cloned session file.
- **SIGKILL stale migration lock recovery** — If Phase2S was killed mid-migration (SIGKILL, power loss), previous versions silently skipped migration on every subsequent startup until you manually deleted `.phase2s/sessions/migration.json.lock`. Now `migrateAll` reads the PID from the lock file and calls `process.kill(pid, 0)` to check liveness. Dead process (ESRCH) → steal the lock and finish the migration. Privilege boundary (EPERM) or corrupt PID → conservative skip. No more stuck lock files.
- **Symlink escape guard in `migrateAllLocked`** — Two-phase path guard: Phase 1 uses `resolve()` (lexical, catches `../` traversal); Phase 2 uses `realpathSync()` (follows symlinks, catches symlinks that point outside the sessions directory). Only Phase 2 runs when the file exists. Phase 1 and Phase 2 use separate baseline directory paths to avoid false-skip on macOS where `/tmp` is a symlink to `/private/tmp`.
- **`saveSession` tmp suffix clarified** — Added a code comment explaining why `saveSession` deliberately keeps the bare `.tmp` suffix (no PID): it is always called inside a held `acquirePosixLock()` guard, so only one caller can proceed at a time.

### Added

- **`phase2s doctor` Bash shell integration check** — `checkBashPlugin()` follows the exact structure of `checkShellPlugin()`: N/A for non-Bash shells, checks plugin file existence, write permission on `~/.phase2s`, and source line in `~/.bash_profile` or `~/.bashrc` (either file, absolute or `$HOME`-relative form). Bash users previously saw a false-clean doctor report.
- **Doom-loop reflection protocol in `buildSatoriContext`** — When a sub-task fails and is retried, satori now receives a structured three-question reflection protocol instead of the original one-liner "Fix this specifically." The protocol asks for root cause, reasoning flaw, and a meaningfully different new approach. If the model cannot identify a different approach, it is instructed to stop and explain rather than repeat. Set `PHASE2S_DOOM_LOOP_REFLECTION=off` to revert to the one-liner (escape hatch for LLM regression).


## v1.22.2 — 2026-04-09

Sprint 47 post-review — session lock correctness sweep: ABA lock fix, stale path filtering, index lock on rebuild.

### Fixed

- **ABA lock race in `releasePosixLock`** — Before unlinking a lock file, the function now reads the file's PID and only proceeds if it matches the current process. Without this guard, a stale-lock cleanup by a second process (combined with a third acquiring a new lock) could cause the original holder's `finally` block to silently delete a live lock. The fix also adds a `Number.isInteger` guard so empty or corrupt lock files are treated as not-owned and left for the stale timeout to handle.
- **`listSessions` stale path filter** — Both the index fast path and the rebuild slow path now filter results with `existsSync` before returning. Sessions deleted from disk since the index was written are silently skipped instead of returning paths that no longer exist.
- **`rebuildSessionIndex` lock starvation closed** — The function previously held `.index.lock` for the entire scan-and-readFile loop (O(N) async I/O), starving concurrent `upsertSessionIndex` callers when sessions were numerous. Restructured: all `readdir` + `readFile` calls happen before lock acquisition; the lock is held only for the O(1) `renameSync`. Lock contention now returns the built-but-unpersisted index (not `null`) so callers always get valid data. Return type changed from `Promise<SessionIndex | null>` to `Promise<SessionIndex>`.
- **`migrateAll` ABA hole closed** — The migration lock previously wrote an empty string to the lock file (instead of the current PID), making it indistinguishable from an abandoned lock. The `finally` block used a bare `unlinkSync` rather than the ABA-safe `releasePosixLock`. Both fixed: lock now writes `process.pid.toString()`, and `finally` calls `releasePosixLock(lockPath)`.
- **`releasePosixLock` decimal PID guard** — `parseInt("3.7", 10)` returns 3, which `Number.isInteger(3)` would pass, potentially treating a decimal PID as a valid match. Changed to `Number(content.trim())` so `"3.7"` produces 3.7, which `Number.isInteger` correctly rejects.
- **`writeReplState` temp file permissions** — Temp file is now created with `mode: 0o600` (owner-read/write only) matching the permissions on the final `state.json`.
- **NFS lock atomicity documented** — `acquirePosixLock` now has a JSDoc note that `{ flag: "wx" }` is atomic on local POSIX filesystems but not on NFSv2/v3 mounts. The same note appears in `CONTRIBUTING.md`.
- **`checkSessionDag` concurrency caveat documented** — JSDoc clarifies that the function takes a point-in-time snapshot; false-positive dangling-parentId warnings are possible during concurrent session creation but self-resolve on the next `doctor` run.

## v1.22.1 — 2026-04-09

Sprint 47 — Session infrastructure: atomic state lock, O(1) conversation listing, DAG integrity check.

### Added

- **POSIX exclusive-create lock for `state.json`** — `writeReplState` is now async and serializes concurrent writes via `.phase2s/.state.lock` (`{ flag: "wx" }`, atomic on POSIX). Stale locks older than 30 s (crashed processes) are removed automatically. Retries once after 50 ms on contention; proceeds without the lock if still blocked, preserving liveness.
- **Session index at `.phase2s/sessions/index.json`** — `listSessions` reads from an O(1) index instead of scanning every session file. The index is updated fire-and-forget on every `saveSession` and `cloneSession` call. If the index is missing or corrupt, `listSessions` falls back to a full disk scan and rebuilds the index automatically.
- **Index lock (`.phase2s/sessions/.index.lock`)** — `upsertSessionIndex` is protected by the same POSIX lock pattern as `writeReplState`, preventing concurrent REPL instances from losing index updates to last-writer-wins races.
- **`phase2s doctor` DAG integrity check** — `checkSessionDag` reads all session files, builds the id set, and flags any session whose `parentId` references a non-existent session. Reported as a warning (not a blocking error).

### Fixed

- **`conversations` O(n) disk reads eliminated** — The browser previously read every session file to extract the first message preview. It now reads a single index file instead, making startup fast regardless of session count.
- **`writeReplState` call sites updated** — Three `await`-less calls in `src/cli/index.ts` now correctly `await` the async function.
- **Index upsert errors surfaced** — Fire-and-forget index upserts now emit a `chalk.dim` warning to stderr on failure instead of swallowing errors silently.

## v1.22.0 — 2026-04-09

Sprint 46 — AI-generated commit messages (`phase2s commit`).

### Added

- **`phase2s commit`** — Run it after `git add`. Reads your staged diff, writes a Conventional Commits message using the fast model tier, and walks you through accept / edit / cancel. `--auto` for CI (non-interactive), `--preview` to inspect the proposed message without committing. Scans for secrets (AWS keys, OpenAI/Anthropic keys, GitHub tokens, Slack tokens, private key blocks) before the diff leaves your machine; warns interactively or fails hard in `--auto` mode.
- **Conventional Commits format** — Generates `<type>(<scope>): <subject>` format by default. Configurable via `format: conventional` in `.phase2s.yaml` under the `commit:` key.
- **`:commit` REPL command** — Generates a commit message from staged changes without entering a sub-flow; runs `git commit` directly if accepted.
- **`scanForSecrets(diff)`** — Exported from `src/core/secrets.ts`. Scans only added lines (`+` prefix, excludes `+++` headers). Detects: AWS Access Key, AWS Secret Key, OpenAI API Key, OpenAI Project Key, Anthropic API Key, GitHub Personal/OAuth/App tokens, Slack Bot/User tokens, Private Key blocks.

### Fixed

- **`spawnSync` silent truncation** — Default 1MB buffer can silently truncate large diffs before sending to the LLM. All 5 `spawnSync` calls in `commit.ts` now use `maxBuffer: 100MB`.
- **OpenAI key regex too narrow** — `sk-[A-Za-z0-9]{48}` (exact) missed newer longer keys. Changed to `{48,}` (48 or more).
- **LLM multi-line output** — Model occasionally returns multi-line responses despite prompt instructions. Commit message now takes only the first non-empty line, preventing unexpected commit bodies and NUL byte errors.
- **Temp file permissions** — Editor temp file was created with `0o666` (world-readable minus umask). Now uses `{ mode: 0o600 }`.

## v1.21.1 — 2026-04-09

Sprint 45 — `:clone` correctness fixes and bash shell integration.

### Fixed

- **`:clone` conversation corruption** — After cloning a session, the agent was loading the cloned conversation verbatim, which replaced the live tool list (from the current system prompt) with the snapshot baked into the cloned session. Fixed via `Agent.setConversation()`: strips any system message from the incoming conversation, re-prepends the agent's own current system prompt, then sets the merged message list. Tool calls now work correctly after `:clone`.
- **`:clone` timestamp drift** — The `:clone` REPL handler was calling `new Date()` to set `sessionMeta.createdAt`/`updatedAt` after `cloneSession()` already wrote different timestamps to disk. The two timestamps could differ by milliseconds. Fixed by extending the `cloneSession()` return value to include `createdAt` and `updatedAt` from the written metadata, and using those values directly in the handler.
- **`migrateAll` concurrent execution** — Two Phase2S processes starting simultaneously on the same project could both run the migration. Fixed with a POSIX exclusive-create lockfile (`{ flag: "wx" }`): the second process detects `EEXIST` and skips with a dim console message. The lock is always released in a `finally` block.
- **`migrateAll` path traversal** — A crafted migration manifest entry (e.g., `originalName: "../../etc/passwd"`) could escape the sessions directory. Fixed with `resolve()` + `startsWith(resolvedDir + "/")` guard on `originalName` and a UUID regex guard on `newId`. Suspicious entries are skipped with a yellow console warning.
- **SIGINT data loss on exit** — The previous `writeFileSync` in the SIGINT handler was not atomic: a crash mid-write would leave a truncated session file. Fixed with a tmp-file+rename pattern. If the rename fails, the tmp file is removed and a warning is written to stderr. The session file on disk is never left in a partial state.

### Added

- **Bash shell integration** — `phase2s setup --bash` installs a bash integration script to `~/.phase2s/phase2s-bash.sh` and sources it from `~/.bash_profile`. Provides the same `: <prompt>` shorthand and `p2` alias as the ZSH integration, plus bash tab completion for all subcommands. Idempotent (safe to re-run). Login shell caveat documented: for non-login bash (VS Code integrated terminal, etc.), also source from `~/.bashrc`.
- **`Conversation.fromMessages()`** — New static factory for creating a `Conversation` directly from a messages array, without JSON parsing. Used by `Agent.setConversation()` internally; available for other callers that construct conversations programmatically.
- **`Agent.setConversation()`** — Public method to replace the agent's current conversation while preserving its system prompt. Strips any system message from the incoming conversation before merging.

---

## v1.21.0 — 2026-04-09

Sprint 44 — Git for Conversations. Sessions are now a DAG you can browse and fork.

### What's new

- **`phase2s conversations`** — Browse every past session. Launches an [fzf](https://github.com/junegunn/fzf) interactive browser if available; falls back to a plain-text table. Each row shows date, branch name, and a preview of your first message. Session UUID is shown in the fzf preview pane for easy copying.
- **`:clone <uuid>` REPL command** — Fork any past session into a new branch. The new session inherits the full message history. Future saves go to the new UUID file; the original is untouched. Use `phase2s conversations` to find UUIDs.
- **DAG session storage** — Sessions now use schema v2: `{schemaVersion: 2, meta: {id, parentId, branchName, createdAt, updatedAt}, messages: [...]}`. Every session knows its parent, enabling branched conversation history.
- **Automatic migration** — On first launch after upgrading, Phase2S migrates legacy `YYYY-MM-DD.json` sessions to UUID format. Migration is resumable: a manifest file tracks per-file progress so a crash mid-migration doesn't leave the directory permanently half-migrated. A backup copy is created before any rename.
- **`state.json` session tracking** — `.phase2s/state.json` records the active session UUID so `--resume` always loads the right session regardless of the date.

### Changed

- `--resume` now loads the session from `state.json` instead of scanning for the most recent date-named file.
- Session files written with mode `0o600` (owner-read/write only) for privacy on shared machines.
- `Conversation.load()` handles both v1 (legacy array) and v2 formats transparently — no breaking change for callers.

---

## v1.20.2 — 2026-04-08

Two bug fixes for the ZSH shell integration shipped in v1.20.0.

### Fixed

- **Glob expansion in `: <prompt>` arguments** — ZSH expands glob patterns (`?`, `*`, `!`) in command arguments before looking up the function to call. A prompt like `: what does this codebase do?` would fail with `zsh: no matches found: do?` because ZSH tried to match `do?` as a filename. Fixed by switching from `function : ()` to `alias ':=noglob __phase2s_run'` — aliases are expanded before glob processing, so the `noglob` precommand modifier suppresses filename generation for all `:` arguments. Same fix applied to the `p2` alias.
- **Setup instructions** — `phase2s setup` previously told users to run `source ~/.zshrc` to activate the plugin in the current shell. Re-sourcing `.zshrc` can fail silently if it has guards (e.g., `[[ -o login ]] || return`) or produce unexpected side effects. Updated to `source ~/.phase2s/phase2s.plugin.zsh`, which directly loads only the plugin. README and docs updated to match.

---

## v1.20.1 — 2026-04-08

Patch release: `phase2s setup` now tells users to run `source ~/.phase2s/phase2s.plugin.zsh` instead of `source ~/.zshrc` to activate the plugin in the current shell. Re-sourcing `.zshrc` can fail silently or produce unexpected side effects. See v1.20.2 for the companion glob fix.

---

## v1.20.0 — 2026-04-07

Sprint 43 — ZSH shell integration. Enables `: fix the bug` syntax directly from any ZSH terminal without entering the REPL.

### What's new

- **`: <prompt>` syntax** — Shadow ZSH's null command with a function that delegates to `phase2s run`. Works from any directory after setup. Guard prevents `: # comments` and bare `:` from reaching phase2s.
- **`p2` alias** — Short ZSH alias for `phase2s run`. `p2 "summarize this PR"` works after sourcing the plugin.
- **`phase2s setup`** — New command that copies the bundled ZSH plugin to `~/.phase2s/phase2s.plugin.zsh` and appends a `source` line to `~/.zshrc`. Idempotent (safe to re-run). `--dry-run` flag shows what would happen without writing anything.
- **Inline ZSH tab completion** — `_phase2s()` function embedded in the plugin to avoid 100-400ms Node.js cold-start cost per shell tab. Completion covers all 13 subcommands including `setup` and `template`.
- **`phase2s doctor` shell check** — `checkShellPlugin()` verifies the ZSH plugin is installed and sourced in `~/.zshrc`.
- **Bundled plugin file** — `.phase2s/shell/phase2s.plugin.zsh` shipped inside the npm package. `bundledShellPluginPath()` in `loader.ts` resolves it using the same 3-levels-up calculation as `bundledTemplatesDir()`.

### Fixed

- **ZSH `$SHELL` detection** — `phase2s setup` warns if the detected shell is not ZSH, since v1.20.0 is ZSH-only. Bash support tracked in TODOS.md.

### Tests

893 → 917 (+24). New test files: `plugin.test.ts` (7 tests: plugin file existence, function content, ZSH syntax validation), `setup.test.ts` (11 tests: install flow, idempotency, trailing-newline guard, dry-run, shell detection). Extended `doctor.test.ts` (+4 tests for `checkShellPlugin`), `completion.test.ts` (+2 tests for setup/template subcommands).

---

## v1.19.0 — 2026-04-07

Sprint 42 bug sweep (4 adversarial findings from v1.18.0) + spec template library (`phase2s template list` / `phase2s template use <name>`). Pre-landing adversarial review caught a critical template format bug and three additional code quality fixes.

### What's new

- **`phase2s template list`** — lists 6 bundled spec templates with title and description.
- **`phase2s template use <name>`** — interactive wizard: prompts for ≤4 placeholders, substitutes `{{tokens}}` in a single pass (no cascade injection), writes spec to `.phase2s/specs/`, runs lint.
- **6 bundled templates** — `auth`, `api`, `refactor`, `test`, `cli`, `bug`. Each has a realistic 4–5 subtask decomposition in the exact format `phase2s goal` expects.
- **`phase2s doctor` templates check** — `checkTemplatesDir()` verifies bundled templates directory is present and non-empty.
- **`prompt-util.ts`** — shared readline wizard helper extracted from `init.ts`. `createRl()` + `ask()` available across CLI commands.

### Fixed

- **Template format incompatibility (CRITICAL)** — all 6 bundled templates used wrong markdown headings (`## Constraints`, `### 1. Name`, bare `Input:` text). The spec-parser would parse 0 subtasks, making `phase2s goal <generated>` a silent no-op. Rewritten to use the correct format (`## Constraint Architecture`, `### Sub-task N: Name`, `- **Input:**`, `## Eval Command` section). Caught by Codex adversarial review.
- **`alias.startsWith(p)` regression** — `resolveSubtaskModel()` created an `alias = annotation.toLowerCase()` variable for case-insensitive comparison but the KNOWN_MODEL_PREFIXES check on line 529 still used the original `annotation`. Model IDs like `GPT-4O` bypassed the "unknown model" warning. Fixed.
- **Cascade placeholder injection** — sequential `replaceAll` loop allowed a user-entered value containing `{{token}}` to be re-substituted when that token was processed next. Replaced with a single-pass regex replacement.
- **Frontmatter regex required trailing newline** — closing `---` regex required `\r?\n` immediately after. Files without a trailing newline were silently dropped from `template list`. Made the trailing newline optional; body defaults to `""`.
- **Duplicate `node:fs` import in `doctor.ts`** — `readFileSync` was imported separately on line 15 from an already-present `node:fs` import. Merged.
- **Telegram truncation constants inside function body** — `TELEGRAM_MAX_BYTES`, `TELEGRAM_ELLIPSIS`, `TELEGRAM_TRUNCATION_GUARD_BYTES` moved to module level for visibility and testability.
- **`resolveSubtaskModel` case normalization** — `.toLowerCase()` before alias comparison. `model: Fast` → `config.fast_model`.
- **`resp.json()` SyntaxError isolation** — separated into own try/catch in `init.ts` Telegram wizard. Emits a clear "unexpected response (non-JSON)" message instead of raw SyntaxError.
- **`TRUNCATION_HEADROOM_BYTES` JSDoc** — updated to document worst-case U+FFFD expansion correctly.

### Tests

850 → 893 (+43). New test files: `spec-template.test.ts` (27 tests: cascade injection prevention, trailing-newline regression, call-through coverage for `runTemplateList`/`runTemplateUse`), `template-format.test.ts` (6 format-compatibility tests), `notify.test.ts` (+70 lines), `doctor.test.ts` (+40 lines), `parallel-executor.test.ts` (+12 lines).


## v1.18.0 — 2026-04-07

Sprint 41 small backlog sweep: Telegram notifications, byte-aware truncation fix, multi-provider parallel workers via `model:` spec annotation, tiktoken marked won't-fix.

### What's new

- **Telegram notification channel** — `sendTelegramNotification()` added to `notify.ts`. Configurable via `PHASE2S_TELEGRAM_BOT_TOKEN` + `PHASE2S_TELEGRAM_CHAT_ID` env vars or `notify.telegram` in `.phase2s.yaml`.
- **`phase2s init --telegram-setup` wizard** — interactive wizard that calls `getUpdates`, picks the most recent chat by `update_id`, prints the chat ID and ready-to-paste YAML snippet. Handles invalid tokens, empty results (up to 3 retries), and multiple chats.
- **`model:` spec annotation for parallel workers** — subtasks can declare `model: fast`, `model: smart`, or a literal model name. `resolveSubtaskModel()` maps aliases to configured tiers and falls back to the outer `--model` flag.
- **Byte-aware context truncation** — `level-context.ts` now uses `Buffer.from(context,'utf8').subarray(0,limit).toString('utf8')` instead of `String.slice()`. Fixes silent byte overrun with emoji or CJK filenames.

### Fixed

- `level-context.ts` truncation used JS string code units, not bytes. Emoji filenames could push output past `MAX_CONTEXT_BYTES`.

### Closed as wont-fix

- `conversation.ts` token estimation: errs conservatively (safe direction). 2MB wasm dep not worth marginal precision gain.

### Tests

820 → 850 (30 new tests across `level-context`, `notify`, `spec-parser`, and `parallel-executor`).


## v1.17.0 — 2026-04-07

Test hygiene: `level-context.test.ts` is now fully isolated — all tests run against temp repos instead of the live project repo. TODOS.md housekeeping.

### Changed

- **`level-context.test.ts` fully isolated** — all 6 tests now use `withTempRepo()` instead of `process.cwd()`. The two describe blocks are consolidated into one. No live-repo dependency remains in the file. Test count: 821 → 820 (one duplicate HEAD-equals-HEAD test removed during consolidation).
- **TODOS.md housekeeping** — orchestrator auto-detect warning marked complete (was shipped in v1.15.0 but left open); `level-context.test.ts` migration marked complete.

## v1.16.0 — 2026-04-06

Live re-planning after subtask failure, structured architect context JSON, and path-traversal hardening for LLM-generated job IDs.

### What's new

- **Live re-planning** — when a subtask fails, the orchestrator calls the LLM with a structured prompt describing the failure, remaining jobs, and architect context. The revised plan (a `delta` of new or updated jobs) is validated with 2 retries, merged back, and re-leveled — execution continues rather than stopping. New jobs added by the LLM are registered immediately so skip-sync and downstream DFS see them.
- **Validated LLM output (`schemaGate<T>`)** — new `src/core/schema-gate.ts` utility. Extracts JSON from the LLM response, validates it with a type predicate, and retries up to N times with the previous error injected. The re-planner uses this to get a structurally valid delta before accepting it.
- **Structured architect context** — architect workers now emit a ` ```context-json ` block with a typed JSON summary of their design decisions. `parseArchitectContext()` extracts and validates the block. The re-planner receives a structured `ArchitectContext` object instead of freeform text, making re-plan prompts more reliable.
- **`context-json` sentinel replaces `<!-- CONTEXT -->`** — all role prompts updated. Backward-compatible: the old sentinel still works for downstream file injection.
- **Backward contamination flagging** — after re-planning, the orchestrator walks backward from the failed job through completed ancestors (DFS) and flags them as `suspect`. Suspect count is logged to `orchestrator_replan_result.suspectCount` and returned in the final result. Useful for post-run audits when a failure may have consumed unreliable upstream output.
- **`filteredCompletedCount` on re-plan result** — `orchestrator_replan_result` now includes `filteredCompletedCount: number` (how many completed IDs the model included in delta, filtered server-side). Replaces a misleading `orchestrator_replan_failed` event that was previously emitted for this case.
- **Named re-plan constants** — `REPLAN_REMAINING_SHOWN_JOBS = 5` and `REPLAN_SCHEMA_GATE_RETRIES = 2` replace magic numbers.

### Security

- **`isDeltaResponse` slug validation** — delta job `id` fields are now validated against `/^[a-z0-9][a-z0-9-]*$/` before acceptance. LLM-generated IDs containing `../`, absolute paths, or spaces are rejected, preventing path traversal when the ID is used in context file construction.
- **`dependsOn` element typing** — `isDeltaResponse` now validates that every element of `dependsOn` is a `string` (previously only checked `Array.isArray`).

### Fixed

- `allJobs` staleness — orchestrator now uses `[...jobById.values()]` instead of the original `allJobs` parameter for DFS, skip-sync, and remaining-pending filtering. Delta-added jobs are visible to all post-re-plan operations.
- Dead `orchestrator_replan` event removed from `RunEvent` union (replaced by `orchestrator_replan_result` and `orchestrator_replan_failed`).
- `OrchestratorResult` and `orchestrator_completed` now include `suspectCount`.

### Stats

| Metric | Value |
|--------|-------|
| New source files | 2 (`schema-gate.ts`, `architect-context.ts`) |
| New test files | 2 (`replan.test.ts`, `types.test.ts`) |
| Tests | 821 (+60 from v1.15.0) |

## v1.15.0 — 2026-04-06

Multi-agent orchestrator: role-aware spec compilation, deterministic state machine routing, and architect context passing.

### What's new

- **Multi-Agent Orchestrator** — new `src/orchestrator/` module routes subtasks to role-appropriate workers (architect, implementer, tester, reviewer). Each role gets a tailored system prompt. The orchestrator is a deterministic state machine, not an LLM.
- **Role annotations in specs** — add `**Role:** architect` (or `implementer`, `tester`, `reviewer`) to any subtask body. `phase2s goal` auto-detects role annotations and activates orchestrator mode. Use `--orchestrator` to force it regardless.
- **Architect context passing** — architect workers emit a `<!-- CONTEXT -->` sentinel in their output. The orchestrator extracts the content, caps it at 4096 bytes, and injects it into downstream workers' system prompts as `Prior context from upstream subtask '...'`. Missing sentinel triggers an `orchestrator_context_missing` log event.
- **Transitive failure skipping** — when a job fails, DFS traversal marks all transitively dependent jobs as `skipped`. Independent subtasks are unaffected. `replanOnFailure()` stub logs `orchestrator_replan` event (Sprint 39: LLM call).
- **`phase2s goal --orchestrator`** — explicit flag to activate orchestrator mode on any spec, even without role annotations (all jobs default to `implementer`).
- **6 new run-log events** — `orchestrator_started`, `job_promoted`, `job_routed`, `orchestrator_context_missing`, `orchestrator_replan`, `orchestrator_completed` in the JSONL run log.
- **Backward compatible** — specs without `**Role:**` annotations run exactly as v1.14.0. Orchestrator only activates when annotations are present or `--orchestrator` is passed.
- **59 new tests** — spec-compiler (16), role-prompts (5), orchestrator (26), plus role parsing in spec-parser (7) and executeOrchestratorLevel in parallel-executor (5). Total: 761.

### Fixed

- Shell injection hardening in `executeOrchestratorLevel` — `git add -A` and `git diff --cached --quiet` now use `execFileSync` array form alongside the existing `git commit` call. No shell-expanded paths.
- UTF-8 multibyte boundary safe truncation — context content truncated with `Buffer.slice()` instead of `String.slice()` to avoid splitting codepoints.
- DFS cycle guard — `computeSkippedIds` uses a visited set to prevent infinite loop on invariant-violating `dependsOn` cycles.
- `symlinkNodeModules` errors in orchestrator workers now return `status: 'failed'` instead of rejecting the whole `Promise.all`.
- `mkdtempSync` for context temp dir — replaced deterministic `tmpdir/phase2s-context-<hash>-<timestamp>` with `mkdtempSync` to prevent concurrent process collision on the same spec.
- Orchestrator context path uses `job.id` (safe slug) instead of `result.subtaskId` (caller-supplied via injected `executeLevelFn`) — closes a theoretical path traversal vector in the context file name.
- `activeJobs` filter now also excludes `failed` and `completed` jobs in addition to `skipped` — defensive guard against re-running jobs on resume or unexpected level replay.
- Removed unnecessary `CONTEXT_SENTINEL` alias — `ARCHITECT_CONTEXT_SENTINEL` from `role-prompts.ts` is the single source of truth and is now used directly in the orchestrator.
- `slugify()` fallback — returns `'subtask'` for names that produce an empty slug (e.g. `"---"`), preventing empty-string `job.id` collisions in the `jobById` map.
- Worker timeout message — now emits `"Worker timeout after Xs"` consistent with `executeWorker`, making run logs grep-consistent.
- `goal_completed` log event — `success` field now uses `totalFailed === 0 && totalSkipped === 0`, matching `GoalResult.success`. Previous: log said success even when subtasks were skipped.
- Total system prompt cap — `job.systemPromptPrefix` is now capped at 16 KB across all injected upstream context chunks (each chunk was already capped at 4 KB, but accumulation was unbounded).

## v1.14.0 — 2026-04-06

Score your spec against the diff, and three bug fixes for parallel dark factory runs.

### What's new

- **Spec Eval Judge** — reads your spec's acceptance criteria, compares them against a git diff, and produces a per-criterion coverage map with a derived 0-10 score (`src/eval/judge.ts`). Score formula: `(met×1.0 + partial×0.5) / total × 10`. Never throws, returns `score: null` on any failure. Diff truncated at 40,000 chars to stay within model context.
- **`phase2s judge <spec.md> --diff <file>`** — Standalone CLI subcommand. Prints a JUDGE REPORT block to stdout. Exits 1 if score < 7 (for CI integration). Also accepts diff via stdin: `git diff HEAD~1 | phase2s judge spec.md`.
- **`phase2s goal --judge`** — Runs the judge automatically after each attempt. Captures `baseRef` before any agent execution, computes `git diff baseRef..HEAD`, calls `judgeRun`, and logs an `eval_judged` JSONL event.
- **`eval_judged` event in run logs** — New event type in `RunEvent` union: `score`, `verdict`, `criteria[]`, `diffStats`. Rendered as a JUDGE REPORT block by `phase2s report`.
- **Fix: timer leak in `executeWorker()`** — `clearTimeout(timeoutHandle)` now always called in `finally` block. Previous: successful workers left a live 10-minute timer, delaying `process.exit` in CI.
- **Fix: `unstash()` popping wrong stash entry** — Now uses named stash (`git stash push --message "phase2s-<runId>"`) and pops by ref (`stash@{N}`) instead of always popping `stash@{0}`. User's pre-existing stash entries are never touched.
- **Fix: concurrent `git worktree prune` race** — Promise-chain mutex (`Map<string, Promise<void>>`) serializes prune+add per repo. Multiple workers racing on the same repo no longer cause one to fail with "worktree already exists".

### Stats

| Metric | Value |
|--------|-------|
| Version | v1.14.0 |
| Tests | 702 (+41) |
| New files | 4 (`src/eval/judge.ts`, `test/eval/judge.test.ts`, `test/cli/goal-judge.test.ts`, `test/cli/judge-cli.test.ts`) |
| Modified files | 6 (`parallel-executor.ts`, `merge-strategy.ts`, `run-logger.ts`, `goal.ts`, `index.ts`, `report.ts`) |

## v1.13.0 — 2026-04-05

Integration test coverage for the parallel infrastructure + `--resume --parallel` hardening.

### What's new

- **`--resume --parallel` now works reliably** — `makeWorktreeSlug()` is now deterministic (`ph2s-<specHash8>-<index>` instead of a random suffix). Worktree paths are written to state on creation, so a resumed run finds existing worktrees instead of creating new ones with different names.
- **Shared integration test harness** (`test/goal/helpers.ts`) — `makeTempRepo()`, `commitFile()`, `commitManyFiles()`, `makeConflictingBranches()`, `withTempRepo()`. Real git repos, not mocked `execSync`. All future parallel test suites get these helpers for free.
- **`executeParallel()` behavior tests** — timeout rejection, level failure halts, `completedLevels` skip on resume, `unstash` called in finally.
- **`mergeWorktree()` conflict detection tests** — two branches modifying the same file → `status: "conflict"` + `conflictFiles`, `git merge --abort` restores clean state.
- **`stashIfDirty` / `unstash` integration tests** — dirty tracked file → stash created, clean tree → no stash, unstash restores content, unstash on clean tree is a no-op.
- **`buildLevelContext()` real-repo tests** — filename + "files changed" in output, truncation at 4096 bytes with `(truncated)` marker, empty diff returns `""`.
- **`updateWorkerPane` / `updateStatusBar` tests** — inactive dashboard no-throw, double-quote escaping verification.

### Stats

| Metric | Value |
|--------|-------|
| Version | v1.13.0 |
| Tests | 661 (+15) |
| New files | 1 (`test/goal/helpers.ts`) |
| Modified files | 6 |

### Upgrade note

In-progress `phase2s goal --parallel` runs from v1.12.0 are not resumable across this upgrade. Worktree slugs changed from random to deterministic — a v1.12.0 state file references slugs that no longer match. Restart interrupted runs from scratch after upgrading.

## v1.12.0 — 2026-04-05

Parallel dark factory execution. Spec-aware parallelism with dependency analysis, git worktrees, and optional tmux dashboard.

### What's new

- **Parallel execution** — `phase2s goal --parallel spec.md` or auto-detected when 3+ independent subtasks. Subtasks run in parallel inside git worktrees, merged at level boundaries. Max 3 default workers (`--workers N` to override, 1-8 range).
- **Dependency graph** — Hybrid file-reference detection: explicit `files:` annotation in spec (highest priority) or regex heuristic from subtask descriptions. Kahn's algorithm for topological sort with cycle detection.
- **Auto-detect** — When a spec has 3+ independent subtasks, parallel mode is enabled automatically. Use `--sequential` to force sequential mode.
- **Dry-run visualization** — `phase2s goal --parallel --dry-run spec.md` shows the execution plan as an ASCII diagram with levels and dependencies.
- **Level context injection** — Each parallel worker receives a git diff summary of what prior levels changed, compensating for the loss of shared conversation history.
- **Merge conflict detection** — Same-file conflicts halt the pipeline with clear error reporting. Different-file changes merge cleanly.
- **tmux dashboard** (optional) — `--dashboard` flag shows live progress per worker in tmux panes.
- **Parallel run reports** — `phase2s report` shows per-level timing, merge timing, and wall-clock savings vs sequential estimate.
- **Resume** — `--resume --parallel` resumes from the last completed level.
- **Doctor checks** — `phase2s doctor` now checks for tmux and git worktree support.

### Spec format addition

Subtasks can now include an optional `**Files:**` annotation for explicit dependency declaration:

```markdown
### Sub-task 1: Create API routes
- **Input:** API spec
- **Output:** Route handlers
- **Success criteria:** Tests pass
- **Files:** src/api/routes.ts, src/api/middleware.ts
```

When present, `files:` overrides the regex heuristic for dependency analysis.

### Stats

| Metric | Value |
|--------|-------|
| Version | v1.12.0 |
| Tests | 646 (+51) |
| New files | 5 (src/goal/) |
| Modified files | 7 |

## v1.11.0 — 2026-04-05

MiniMax provider + README refresh (bear mascot removed).

### What's new

- **MiniMax provider** — `provider: minimax` in `.phase2s.yaml` (or `PHASE2S_PROVIDER=minimax`). Connects to MiniMax's OpenAI-compatible API at `api.minimax.io/v1/`. Default model `MiniMax-M2.5`. Set `MINIMAX_API_KEY` or `minimaxApiKey` in config. `phase2s init` wizard option 7 and `phase2s doctor` both handle MiniMax. 7 providers total.
- **README refresh** — Providers comparison table. Features in Depth section covering: `phase2s lint`, `--dry-run`, live progress display, `phase2s report`, MCP state server, MCP report tool, headless browser, `--system` flag, `verifyCommand` config.

### Removed

- Bear mascot (shipped in v1.10.0, removed in v1.11.0). The ASCII art didn't meet the quality bar.

### Usage

```bash
# Bear greets you at startup (disable with --no-banner or bear: false in config)
phase2s
phase2s --no-banner

# MiniMax provider
export MINIMAX_API_KEY="your-key"
phase2s init  # choose option 7
```

---

## v1.9.0 — 2026-04-05

Dark factory visibility: dry-run mode, live progress, and richer lint checks.

### What's new

- **`phase2s goal <spec.md> --dry-run`** — parse and display the spec decomposition tree without making a single LLM call. Prints the spec title, eval command, sub-task list (with inputs, outputs, and success criteria), and acceptance criteria. Exits in under a second. Useful before committing to a 20-minute dark-factory run. 3 tests.
- **Live progress display** — the dark factory now shows `[1/3] Running: Sub-task name` (cyan) or `[1/3] Retrying: Sub-task name` (yellow) as each sub-task starts, and `Done in Xs` when it finishes. Skipped sub-tasks (passed in a prior attempt) are shown in dim. Makes it clear where you are in a long run.
- **`phase2s lint`: >8 sub-task warning** — if your spec has more than 8 sub-tasks, lint warns. Large specs are unreliable; retry combinatorics grow fast. Break into multiple smaller specs and run sequentially. 1 test.
- **`phase2s lint`: evalCommand PATH check** — if your spec specifies an eval command (e.g., `pytest tests/`) and the binary isn't on PATH, lint warns immediately instead of failing 20 minutes into a run. Skipped for the default `npm test` (most machines have npm). 3 tests.

### Usage

```bash
# Preview what a dark-factory run would do
phase2s goal specs/add-rate-limiting.md --dry-run

# Validate + preview before committing to a long run
phase2s lint specs/add-rate-limiting.md && phase2s goal specs/add-rate-limiting.md --dry-run

# Run with live progress
phase2s goal specs/add-rate-limiting.md
# [1/2] Running: Token bucket core
# Done in 8s
# [2/2] Running: Express middleware
# Done in 11s
```

---

## v1.8.0 — 2026-04-05

Spec linting + Google Gemini provider.

### What's new

- **`phase2s lint <spec.md>`** — validates a 5-pillar spec file before you commit 20 minutes to a dark-factory run. Catches 4 structural errors (missing title, empty problem statement, no decomposition sub-tasks, no acceptance criteria) and 2 advisory warnings (default evalCommand still set to `npm test`, subtask missing success criteria). Exits 0 when the spec is runnable (warnings OK), exits 1 on errors. Designed to integrate into CI before `phase2s goal`. 8 tests.
- **Gemini provider** — `provider: gemini` in `.phase2s.yaml` (or `PHASE2S_PROVIDER=gemini` env var). Connects to Google's OpenAI-compatible API at `generativelanguage.googleapis.com/v1beta/openai/` — no new SDK dependency. Default model `gemini-2.0-flash`. Free tier available. Set `GEMINI_API_KEY` (starts with `AIza`) or `geminiApiKey` in config. Optional `geminiBaseUrl` override. `phase2s init` wizard option 6 and `phase2s doctor` both handle Gemini. 5 tests.

### Usage

```bash
# Validate a spec before running it
phase2s lint specs/add-rate-limiting.md

# Run only after lint passes
phase2s lint specs/add-rate-limiting.md && phase2s goal specs/add-rate-limiting.md

# Configure Gemini
export GEMINI_API_KEY="AIza..."
phase2s init  # choose option 6
# or in .phase2s.yaml:
# provider: gemini
# model: gemini-2.5-pro   # upgrade from the default gemini-2.0-flash
```

---

## v1.7.0 — 2026-04-05

Self-update command + skills search.

### What's new

- **`phase2s upgrade`** — checks npm registry for the latest version and offers to install it. Runs `npm install -g @scanton/phase2s` with live output when you say yes. `--check` flag for CI / non-interactive use (reports whether an update is available without prompting). Fails gracefully if the registry is unreachable. 12 tests.
- **`phase2s skills [query]`** — optional search query on the `skills` command. Filters by skill name and description (case-insensitive substring match). `phase2s skills quality` returns `/health`, `/qa`, `/audit`. `phase2s skills ship` returns `/ship` and `/land-and-deploy`. Works with `--json` for scripting. When no skills match, prints a helpful message pointing back to `phase2s skills` for the full list. Fully backward compatible — no args still lists all skills. 7 tests.

### Usage

```bash
# Check for updates and upgrade
phase2s upgrade

# Just check without prompting (CI-friendly)
phase2s upgrade --check

# Find skills related to a topic
phase2s skills quality
phase2s skills security
phase2s skills deploy
phase2s skills search    # try partial names too

# JSON output with filter (for scripts)
phase2s skills --json security
```

---

## v1.6.0 — 2026-04-05

Installation health check + OpenRouter provider.

### What's new

- **`phase2s doctor`** — new diagnostic command that runs 5 health checks and tells you exactly what's wrong and how to fix it. Checks Node.js version (>= 20), provider binary availability (codex, ollama), API key / auth state for all providers, `.phase2s.yaml` validity, and `.phase2s/` working directory writability. Prints `✓`/`✗` per check with one-line fix instructions. Exits with a summary: "All checks passed" or "N issues found."
- **OpenRouter provider** — `provider: openrouter` in `.phase2s.yaml` (or `PHASE2S_PROVIDER=openrouter` env var). Routes requests through [openrouter.ai](https://openrouter.ai) to 50+ models under a single API key. Model names use provider-prefixed slugs: `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`, `google/gemini-pro-1.5`. Set `OPENROUTER_API_KEY` or `openrouterApiKey` in config. Optional `openrouterBaseUrl` for custom deployments. `phase2s init` wizard supports OpenRouter setup with prerequisite check and next-steps guidance.

### Usage

```bash
# Run the health check
phase2s doctor

# OpenRouter via env vars
export PHASE2S_PROVIDER=openrouter
export OPENROUTER_API_KEY=sk-or-...
phase2s run "explain this file"

# OpenRouter with a specific model
phase2s -m anthropic/claude-3-5-sonnet run "review src/core/agent.ts"

# Set up interactively
phase2s init
# (select OpenRouter when prompted for provider)
```

```yaml
# .phase2s.yaml — OpenRouter config
provider: openrouter
openrouterApiKey: "sk-or-..."
model: "openai/gpt-4o"        # any OpenRouter model slug
fast_model: "openai/gpt-4o-mini"
smart_model: "anthropic/claude-3-5-sonnet"
```

---

## v1.5.0 — 2026-04-05

Notification channels expansion + glob tool filtering.

### What's new

- **Discord notifications** — `notify.discord` in `.phase2s.yaml` or `PHASE2S_DISCORD_WEBHOOK` env var. Rich embeds with green/red color coding for success/failure. Works on macOS, Linux, and Windows.
- **Microsoft Teams notifications** — `notify.teams` in `.phase2s.yaml` or `PHASE2S_TEAMS_WEBHOOK` env var. MessageCard format with color-coded `themeColor`. Works on macOS, Linux, and Windows.
- **`phase2s init` wizard** — two new prompts for Discord and Teams webhook URLs. Pre-fills from existing config. `--discord-webhook` and `--teams-webhook` flags for non-interactive CI mode.
- **Glob pattern matching in `tools` and `deny`** — `*` is now a wildcard in the tool allow/deny lists. `tools: ["file_*"]` allows `file_read` and `file_write` without listing them individually. `deny: ["*"]` blocks everything. Patterns that match no known tool produce a startup warning. Exact names still work as before — fully backward compatible.

### Usage

```bash
# Discord via env var
export PHASE2S_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
phase2s goal my-spec.md --notify

# Teams via env var
export PHASE2S_TEAMS_WEBHOOK=https://outlook.office.com/webhook/...
phase2s goal my-spec.md --notify

# Set up interactively
phase2s init

# Non-interactive CI setup
phase2s init --non-interactive --provider codex-cli \
  --slack-webhook https://hooks.slack.com/... \
  --discord-webhook https://discord.com/api/webhooks/... \
  --teams-webhook https://outlook.office.com/webhook/...
```

```yaml
# .phase2s.yaml — glob tool filtering
tools:
  - file_*   # file_read + file_write
  - glob
  - grep
# shell is not listed, so it's blocked
```

### Tests

516 passing (was 503, +13 new tests):
- `test/core/registry.test.ts` — +5 glob matching tests: `file_*` allow, `*` allow-all, `file_*` deny, deny-overrides-allow with globs, no-match warns
- `test/core/notify.test.ts` — +6 notification tests: Discord embed payload, Discord success/failure color, Teams MessageCard payload, Teams success/failure color, no-channel warning mentions all three env vars
- `test/cli/init.test.ts` — +3 init tests: `discordWebhook` in formatConfig, `teamsWebhook` in formatConfig, all three webhooks together

---

## v1.4.0 — 2026-04-05

Interactive onboarding wizard — get from zero to configured in under 60 seconds.

### What's new

- **`phase2s init`** — interactive setup wizard that writes `.phase2s.yaml` for you. Asks up to 4 questions: provider choice (codex-cli / openai-api / anthropic / ollama), API key, optional fast/smart model tiers, optional Slack webhook. Pre-fills from an existing config file if one exists. Validates prerequisites (checks binaries, key formats) and prints tailored next steps per provider.
- **Non-interactive mode** — `phase2s init --non-interactive --provider openai-api --api-key sk-...` for CI scripting and automated setup. Zero prompts.
- **Existing config pre-fill** — if `.phase2s.yaml` already exists, all prompts default to the current values. Rerunning `init` is safe — it's an update wizard, not just a first-run tool.
- **Prerequisite validation** — checks that `codex` is on PATH (codex-cli provider), validates API key prefix format (`sk-` for OpenAI, `sk-ant-` for Anthropic), checks that `ollama` is on PATH (ollama provider). Reports warnings post-write so the config is always saved even if setup isn't complete.

### Usage

```bash
# Interactive (recommended for first-time setup)
phase2s init

# Non-interactive (CI / automation)
phase2s init --non-interactive --provider openai-api --api-key sk-your-key
phase2s init --non-interactive --provider anthropic --api-key sk-ant-your-key
phase2s init --non-interactive --provider codex-cli --fast-model gpt-4o-mini --smart-model o3
```

### Tests

503 passing (was 483, +20 new tests):
- `test/cli/init.test.ts` (new) — 20 tests covering `formatConfig` (all 4 providers, model tiers, Slack block), `checkPrerequisites` (binary detection, API key format validation, missing key warnings), `readExistingConfig` (parse, missing file, invalid YAML, non-object YAML)

---

## v1.3.0 — 2026-04-05

Notification gateway + run report viewer — complete the fire-and-forget story for the dark factory.

### What's new

- **`phase2s goal --notify`** — after a dark factory run completes (success, failure, or challenged), send a notification. macOS system notification via `osascript` (no new deps). Optional Slack webhook via `PHASE2S_SLACK_WEBHOOK` env var or `notify.slack` in `.phase2s.yaml`. Both channels are fail-safe: errors go to stderr and never block the run.
- **`phase2s report <logfile.jsonl>`** — parse and display a chalk-colored summary of a dark factory run log: spec filename, per-attempt sub-task timeline with durations (✓/✗), eval command, criteria verdicts, and total run time. Pass the path printed by `phase2s goal` as `Run log:`.
- **`phase2s__report` MCP tool** — same report viewer exposed as an MCP tool. After Claude Code triggers `phase2s__goal`, it can call `phase2s__report` with the returned `runLogPath` to see exactly what happened.
- **`GoalResult.durationMs`** — total wall-clock run duration now included in all goal results. Used by notifications and available to MCP callers.
- **`notify` config block** — `.phase2s.yaml` accepts `notify: { mac: true, slack: "https://hooks.slack.com/..." }`. The `--notify` CLI flag enables the configured channels. `PHASE2S_SLACK_WEBHOOK` env var provides the Slack URL without config file changes.

### Usage

```bash
# Run a spec with notifications enabled
phase2s goal my-spec.md --notify --review-before-run

# View a run log
phase2s report .phase2s/runs/2026-04-05T10-30-00-a3f1b2c4.jsonl

# Slack webhook via env var
PHASE2S_SLACK_WEBHOOK=https://hooks.slack.com/services/... phase2s goal spec.md --notify
```

```yaml
# .phase2s.yaml
notify:
  mac: true
  slack: "https://hooks.slack.com/services/..."
```

### Tests

483 passing (was 453, +30 new tests):
- `test/core/notify.test.ts` (new) — 11 tests covering buildNotifyPayload variants, formatDurationMs, sendNotification no-op, osascript call, Slack fetch payload, error handling
- `test/cli/report.test.ts` (new) — 11 tests covering parseRunLog, buildRunReport (sub-task durations, criteria, challenged, error), formatRunReport (success, failure, challenged)
- `test/mcp/server.test.ts` — 4 new tests: REPORT_TOOL in tools/list, required logFile, empty logFile error, valid logFile returns report

---

## v1.2.0 — 2026-04-05

Dark factory as MCP tool — run logs + pre-execution adversarial review.

### What's new

- **`phase2s__goal` MCP tool** — Claude Code can now trigger the dark factory directly. Call `phase2s__goal` with a spec file path and get back the run summary + an absolute path to the structured JSONL run log. No terminal required. Long-running by design (20+ min); the MCP 2024-11-05 spec has no timeout requirement at the transport level.
- **Structured JSONL run logs** — every dark factory run now writes a log to `<specDir>/.phase2s/runs/<timestamp>-<hash>.jsonl`. One event per line: `goal_started`, `subtask_started/completed`, `eval_started/completed`, `criteria_checked`, `goal_completed`. Claude can read it with `file_read` to see exactly what happened at each sub-task without guessing.
- **Pre-execution adversarial review** — `phase2s__goal` accepts `reviewBeforeRun: true` (and `phase2s goal --review-before-run` on the CLI). Before a single line of code is written, the spec is challenged by a fresh GPT agent using the adversarial SKILL.md template. `CHALLENGED` or `NEEDS_CLARIFICATION` → halts and returns the full challenge response. `APPROVED` → proceeds. The review agent is a fresh `Agent` instance (not the satori implementation agent) to prevent context contamination.
- **`runGoal()` no longer calls `process.exit()`** — it throws `Error` on failure instead. The CLI entry point in `index.ts` wraps it in try/catch and calls `process.exit()` there. `runGoal()` is now a proper function that can be called from both CLI and MCP without leaking process lifecycle.
- **`GoalResult` extended** — `runLogPath: string`, `summary: string`, `challenged?: boolean`, `challengeResponse?: string` added. CLI prints `Run log: <path>` on exit.

### Behavior details

- Run logs live at `<specDir>/.phase2s/runs/<YYYY-MM-DDTHH-MM-SS>-<hash.slice(0,8)>.jsonl` relative to the spec file directory.
- Log writes are synchronous and throw on failure (never silently dropped).
- `reviewBeforeRun` is opt-in (default false). Quick iteration cycles are not slowed down.
- `NEEDS_CLARIFICATION` is treated identically to `CHALLENGED` — both halt execution and set `challenged: true`.
- The `phase2s__goal` MCP response includes the absolute run log path so Claude can call `file_read` directly without guessing cwd.
- `buildAdversarialPrompt()` injects the spec's decomposition names + acceptance criteria as the "plan" to challenge, then appends the adversarial SKILL.md template.

### Tests

453 passing (was 433, +20 new tests):
- `test/core/run-logger.test.ts` (new) — 10 tests covering RunLogger lazy init, JSONL format, close() path, filename format, throw on write failure
- `test/cli/goal.test.ts` — 6 new tests: missing spec throws Error, buildAdversarialPrompt content, CHALLENGED halts run, NEEDS_CLARIFICATION halts run
- `test/mcp/server.test.ts` — 3 new tests: GOAL_TOOL in tools/list, required specFile, empty specFile returns error

## v1.1.0 — 2026-04-05

MCP state server + dark factory resumability.

### What's new

- **`phase2s goal --resume <spec.md>`** — resume a goal run from the last completed sub-task after interruption, crash, or non-retriable failure. State is written atomically after each sub-task completes or fails. Keyed by SHA-256 of spec file content (not path) so renamed specs resume cleanly and modified specs don't resume stale state.
- **MCP state tools** — three new tools available in every Phase2S MCP session:
  - `phase2s__state_write(key, value)` — write any JSON-serializable value to `.phase2s/state/<key>.json`
  - `phase2s__state_read(key)` — read a stored value, returns `null` if not found
  - `phase2s__state_clear(key)` — delete a stored value, no-op if not found
- **`src/core/state.ts`** — pure state functions shared by goal.ts and server.ts. Atomic writes via tmp-file + rename pattern.
- **Tests:** 433 passing (was 399, +34 new tests covering state.ts, goal resume behavior, MCP state tool round-trips).

### Behavior details

- State lives at `.phase2s/state/<hash>.json` relative to the **spec file directory** (not invocation cwd).
- `phase2s goal --resume spec.md` with no existing state: starts fresh silently. No error, no warning.
- Concurrent runs against the same spec: last-writer-wins. Documented constraint, no file locking.
- Sub-tasks interrupted mid-execution (process killed during satori): treated as not started on resume, retried from the beginning.
- On clean completion (all criteria pass): state is cleared automatically.
- `failureContext`: last 4096 bytes of satori output captured for failed sub-tasks, injected as prior failure context on resume.

## v1.0.0 — 2026-04-05

Feature complete. Full QA pass. Zero open roadmap items.

### What changed from v0.26.0

- **Security:** Updated `@actions/core` (v3), `@actions/github` (v9), and transitive `@actions/http-client` (v4) to resolve 3 CVEs in `undici` (1 high, 2 moderate). Action bundle rebuilt.
- **Docs: `advanced.md`** corrected — no longer claims Codex CLI can't stream. Codex now shows step-by-step messages for multi-step tasks (since v0.26.0).
- **Docs: version strings** updated in `getting-started.md`, `memory.md`, `workflows.md` example output blocks.
- **Docs: `PHASE2S_BROWSER`** environment variable added to `configuration.md`.
- **`package.json`:** Added `repository`, `homepage`, `bugs`, `author` fields for npm page. Expanded keywords to include `anthropic`, `claude`, `chatgpt`, `mcp`, `coding-assistant`, `dark-factory`.
- **README:** Roadmap test count corrected (389 → 399).

### Stability contract

What is stable at v1.0.0 and will not break without a major version bump:

| Surface | Stable? | Notes |
|---------|---------|-------|
| `phase2s` CLI commands (`chat`, `run`, `mcp`, `skills`, `goal`, `completion`) | ✓ | Command names, flag names, exit codes |
| `phase2s run "/skillname args"` routing | ✓ | Skill routing in one-shot mode |
| `phase2s run --dry-run` | ✓ | |
| `phase2s goal <spec.md>` | ✓ | Spec format, `--max-attempts` flag |
| `.phase2s.yaml` config keys | ✓ | All documented keys in `docs/configuration.md` |
| Environment variables (`PHASE2S_*`) | ✓ | All documented in `docs/configuration.md` |
| SKILL.md frontmatter format | ✓ | `name`, `description`, `model`, `triggers`, `inputs` fields |
| MCP tool names (`phase2s__<skill_name>`) | ✓ | Naming convention stable |
| Session file format (`.phase2s/sessions/*.json`) | ✓ | Forward-compatible |
| Learnings file format (`.phase2s/memory/learnings.jsonl`) | ✓ | Append-only JSONL |
| Provider interface (`chatStream` async iterable) | internal | Not a public API — can change in minor versions |
| `ProviderEvent` types | internal | Not a public API |

### What "stable" means

- **CLI:** No flags renamed or removed without a deprecation period.
- **Config:** No keys renamed without a migration path.
- **SKILL.md:** Skills written for v1.0.0 will continue to load and run.
- **MCP tools:** Existing `phase2s__*` tool names will continue to exist. New tools may be added.
- **Breaking changes** (when they happen) get a major version bump and a migration note in CHANGELOG.

---

## v0.26.0 — 2026-04-04

Sprint 22: Real Codex streaming — JSONL stdout parsing replaces the `--output-last-message` temp file approach.

### What changed

- **Real-time step-by-step feedback** — For multi-step Codex tasks (where Codex runs shell commands between messages), each intermediate `agent_message` is now yielded immediately as it arrives. Previously all output was held until the entire run finished. With `/satori` or `phase2s goal` running a long spec, you now see progress live instead of waiting for the final message.

- **Temp file machinery removed** — `--output-last-message`, `mkdtemp`, `activeTempDirs`, `cleanupTempDirs`, and the SIGTERM/SIGINT signal handlers are all gone. The provider is ~70 lines shorter and has no filesystem side effects.

- **Silent JSONL fallback** — Malformed JSONL lines are silently skipped. If a Codex CLI version changes its event format, Phase2S degrades gracefully rather than crashing.

- **Error events surface cleanly** — `{"type":"error","message":"..."}` events from the Codex JSONL stream now throw immediately with the error message, rather than waiting for a non-zero exit code.

- **399 tests** — up from 389 (+10: JSONL streaming unit tests, updated hardening tests).

### JSONL event format (documented via spike)

```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"Running that now."}}
{"type":"item.started","item":{"type":"command_execution","command":"npm test",...}}
{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":0,...}}
{"type":"item.completed","item":{"type":"agent_message","text":"All 23 tests pass."}}
{"type":"turn.completed","usage":{"input_tokens":500,"output_tokens":20}}
```

Only `item.completed` events with `type: "agent_message"` produce output. `command_execution` items are consumed silently (Codex runs the command and we see the result in the next agent_message).

---

## v0.25.0 — 2026-04-04

Sprint 21: Dark Factory v1 — `phase2s goal <spec.md>` executes a spec autonomously using your ChatGPT subscription.

### What you can do now

- **`phase2s goal <spec.md>`** — give Phase2S a spec file and have it run to completion. It reads your spec, executes each sub-task through `/satori` (implement + test + retry), runs your eval command, checks acceptance criteria, and retries failing sub-tasks with failure context. Stops when all criteria pass or max attempts are exhausted. No manual intervention during the loop.
- **`--max-attempts <n>`** — control how many outer retry loops the executor runs (default: 3). Combined with satori's inner retries (3x per sub-task), a single spec execution can drive up to 9 implementation passes per sub-task.
- **5-pillar spec format** — `/deep-specify` now outputs the structured 5-pillar format (Problem Statement, Acceptance Criteria, Constraint Architecture, Decomposition, Evaluation Design) saved to `.phase2s/specs/`. Any spec produced by `/deep-specify` is directly consumable by `phase2s goal` with no manual editing.
- **Adversarial routing fixed** — CLAUDE.md now explicitly prohibits falling back to `codex exec` for adversarial review. `phase2s__adversarial` is always the correct tool. Codex CLI requires browser OAuth and fails silently in automated contexts.
- **389 tests** — up from 365 (+24: spec parser, goal executor helpers, and runCommand).

### Example

```bash
# Write a spec
phase2s
you > /deep-specify add pagination to the search endpoint

# Execute it autonomously (uses your ChatGPT subscription)
phase2s goal .phase2s/specs/2026-04-04-11-00-pagination.md
```

```
Goal executor: Pagination for search endpoint
Eval command: npm test
Sub-tasks: 3
Max attempts: 3

=== Attempt 1/3 ===
Running sub-task: Cursor-based pagination logic
...
Running evaluation: npm test
  ✗ Returns correct next_cursor on paginated results
  ✓ Returns 20 items per page by default

Retrying 1 sub-task(s): Cursor-based pagination logic

=== Attempt 2/3 ===
Running sub-task: Cursor-based pagination logic
...
Running evaluation: npm test
  ✓ Returns correct next_cursor on paginated results
  ✓ Returns 20 items per page by default

✓ All acceptance criteria met after 2 attempt(s).
```

### Spec format

```markdown
# Spec: {{title}}

## Problem Statement
{{what we're building and why}}

## Acceptance Criteria
1. {{testable criterion}}

## Constraint Architecture
**Must Do:** {{hard requirements}}
**Cannot Do:** {{explicit non-goals}}
**Should Prefer:** {{preferences}}
**Should Escalate:** {{when to stop and ask}}

## Decomposition
### Sub-task 1: {{name}}
- **Input:** {{input}}
- **Output:** {{output}}
- **Success criteria:** {{how to know done}}

## Evaluation Design
| Test Case | Input | Expected Output |
|-----------|-------|-----------------|

## Eval Command
npm test
```

## v0.24.0 — 2026-04-04

Sprint 20: published GitHub Action — `uses: scanton/phase2s@v1`.

### What you can do now

- **GitHub Action** — add Phase2S to any workflow with `uses: scanton/phase2s@v1`. No install step, no setup — it auto-installs `@scanton/phase2s` at runtime, runs your skill, and surfaces results three ways: `result` + `verdict` outputs, a GitHub Step Summary, and a PR comment (when `GITHUB_TOKEN` is set on `pull_request` events).
- **Skill routing** — the `skill:` input accepts any Phase2S skill name with or without a leading `/` (`review`, `/adversarial`, etc.). Optional `args:` are appended to the prompt.
- **Multi-provider** — `provider:` accepts `anthropic` (default), `openai-api`, or `ollama`. Pass your key as a secret via `anthropic-api-key:` or `openai-api-key:`.
- **Verdict extraction** — for `/adversarial` (and any skill that emits `VERDICT: APPROVED|CHALLENGED|NEEDS_CLARIFICATION`), the `verdict` output is set automatically. Use it in downstream `if:` conditions.
- **`fail-on` control** — `error` (default) fails on non-zero exit; `challenged` also fails when verdict is `CHALLENGED`; `never` always passes (useful for advisory runs).
- **PR comments** — set `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and the action posts the full skill output as a PR comment. Long outputs (>60k chars) are truncated with a pointer to the Step Summary.
- **Floating `v1` tag** — `uses: scanton/phase2s@v1` always points to the latest v0.x release. Updated automatically on every publish.

### Example

```yaml
- uses: scanton/phase2s@v1
  with:
    skill: adversarial
    args: "Evaluate the plan in PLAN.md"
    provider: anthropic
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on: challenged
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### For contributors

- **`src/action/index.ts`** — new file. JS action entry point: credential validation, `npm install -g @scanton/phase2s`, skill execution, verdict extraction, Step Summary, PR comment, fail-on logic. Exported `run()` for testability.
- **`action.yml`** — new file. `using: node20`, `main: dist/action/index.js`. Defines `skill`, `args`, `provider`, `anthropic-api-key`, `openai-api-key`, `fail-on` inputs and `result`, `verdict` outputs.
- **`package.json`** — `build:action` script (`ncc build src/action/index.ts -o dist/action`). `@actions/core`, `@actions/exec`, `@actions/github`, `@vercel/ncc` added as devDependencies. `!dist/action/` excluded from npm package files.
- **`tsconfig.json`** — `src/action` excluded so tsc doesn't emit a broken stub into `dist/action/`.
- **`.gitignore`** — `!dist/action/` un-ignores the ncc bundle so GitHub can run the action from the committed artifact.
- **`.github/workflows/build-action.yml`** — new CI workflow: verifies `dist/action/index.js` is committed and up-to-date on any PR touching `src/action/**`.
- **`.github/workflows/publish.yml`** — builds action bundle and force-pushes the floating `v1` tag after every npm publish.
- **365 tests** (up from 341). New: +24 action tests covering skill normalization, verdict extraction, fail-on logic, Step Summary, PR comments, env vars, auto-install, output truncation.

## v0.23.0 — 2026-04-04

Sprint 19: headless browser tool via Playwright.

### What you can do now

- **Browser tool** — a new `browser` tool powered by headless Chromium (via Playwright). Navigate to URLs, click elements, fill forms, take screenshots, and evaluate JavaScript in the page context. The `/qa` skill can now actually drive a running web app — not just inspect files.
- **Localhost first** — dev servers on `http://localhost:*` are the primary use case. `navigate` to your Next.js app, click a button, screenshot the result.
- **SSRF protection** — private IP ranges (RFC 1918: 10.x.x.x, 172.16-31.x.x, 192.168.x.x), link-local (169.254.x.x, AWS metadata), and non-HTTP schemes (chrome://, data://) are blocked. Only localhost and public internet addresses are allowed.
- **file:// sandboxed** — file:// URLs are allowed, but only for paths within the project directory (same sandbox as the existing file tools).
- **Screenshots to disk** — screenshots save to `.phase2s/screenshots/<timestamp>-<label>.png` and the tool returns both the file path and an 800×600 viewport thumbnail as base64 so the model can see what the page looks like.
- **Opt-in** — the browser tool is disabled by default (Playwright is ~170MB of Chromium). Enable in `.phase2s.yaml` with `browser: true`, or `PHASE2S_BROWSER=true` env var. If you enable it without Playwright installed, you get a clear error with install instructions.

### Setup

```bash
npm install -g playwright
npx playwright install chromium
```

Then in `.phase2s.yaml`:
```yaml
browser: true
```

Or one-shot:
```bash
PHASE2S_BROWSER=true phase2s run "/qa test the login page"
```

### For contributors

- **`src/tools/browser.ts`** — new file. `createBrowserTool(cwd)` factory. `disposeBrowser()` exported for process cleanup. `getUrlBlockReason()` exported (used in tests). Single active-page model — each `navigate` closes the previous page before opening a new one.
- **`src/tools/index.ts`** — new `RegistryOptions` interface. `createDefaultRegistry()` accepts both the legacy boolean signature and the new options object (`{ allowDestructive, cwd, browserEnabled }`). Browser tool registered when `browserEnabled: true`.
- **`src/core/config.ts`** — new `browser?: boolean` field (default `false`). Reads `PHASE2S_BROWSER` env var.
- **`src/core/agent.ts`** — new `cwd?` field on `AgentOptions`. Passes `cwd` and `browserEnabled` to `createDefaultRegistry`.
- **`src/cli/index.ts`** — imports `disposeBrowser`. Calls it on SIGINT (before `process.exit`) and registers a `process.once("exit")` hook for normal exits.
- **341 tests** (up from 300). New: +10 browser tool tests (URL blocking, mocked playwright for all 7 actions, missing Playwright graceful error path).

## v0.22.0 — 2026-04-04

Sprint 18: shell completion, tool allow/deny docs, version path fix.

### What you can do now

- **Shell completion** — `phase2s completion bash` and `phase2s completion zsh` output completion scripts. Add `eval "$(phase2s completion bash)"` to `~/.bashrc` (or zsh equivalent) and `phase2s run "/exp<TAB>"` completes to `/explain`. Subcommand completion and `--json` / `--dry-run` flags included.
- **Tool allow/deny documented** — `tools:` and `deny:` in `.phase2s.yaml` have been live since Sprint 13 but were undocumented. Full reference and two "Common setups" examples added to `docs/configuration.md`: read-only agent (no `file_write` or `shell`) and no-shell agent (`deny: [shell]`).

### For contributors

- **`src/cli/index.ts`** — `completion <shell>` subcommand added. Outputs bash or zsh completion scripts that call `phase2s skills --json` dynamically so completions stay current as skills are added.
- **`docs/configuration.md`** — `tools:` and `deny:` fields added to the YAML reference. Two new Common setups examples.
- **320 tests** (up from 314). New: +6 completion tests.

## v0.21.0 — 2026-04-04

Sprint 17: Multi-turn skills via `{{ASK:}}` inline prompts. Skills can now embed questions directly in their prompt template body.

### What you can do now

- **`{{ASK:}}` in SKILL.md templates** — embed a question anywhere in your skill's prompt body: `{{ASK: What concern should I focus on?}}`. In the REPL, Phase2S pauses and asks before sending to the model. Multiple questions are asked sequentially. Duplicate questions (same text appearing twice) are asked once and the answer is reused.
- **Non-interactive safety** — `phase2s run` (one-shot), MCP tool calls, and non-TTY stdin all strip `{{ASK:}}` tokens automatically. One-shot and non-TTY warn to stderr. MCP surfaces a `PHASE2S_NOTE` in the tool result so Claude Code sees that interactive prompts were skipped.
- **`--version` permanently fixed** — reads from `package.json` at runtime by walking up from the current file. Works from source (vitest / ts-node) and compiled output. No more hardcoded constant that drifts on bumps.

### For contributors

- **`src/skills/template.ts`** — four new exports: `extractAskTokens()`, `substituteAskValues()`, `stripAskTokens()`, plus the `AskToken` interface. Grammar: `{{ASK: prompt text}}` ends at first `}}`, no nesting, leading/trailing whitespace trimmed, duplicates deduplicated.
- **`src/cli/index.ts`** — REPL path: extracts tokens, prompts user for each via readline, checks `process.stdin.isTTY` before entering the loop (non-TTY → strip + warn). One-shot path (`resolveSkillRouting`): strips tokens + warns to stderr.
- **`src/mcp/server.ts`** — `tools/call` strips `{{ASK:}}` tokens and adds a `PHASE2S_NOTE` content item to the result when tokens were present, so the MCP caller sees degradation explicitly.
- **314 tests** (up from 295). New: +13 template tests (`ask-tokens.test.ts`), +4 one-shot routing tests, +2 MCP degradation tests.

## v0.20.0 — 2026-04-04

Sprint 16: `phase2s skills --json`, clean install (no deprecation warnings), accurate test counts.

### What's new

- **`phase2s skills --json`** — machine-readable skill list: name, description, model tier, inputs with types. Pipe into `jq`, scripts, or anything else. `phase2s skills --json | jq '.[] | select(.model=="fast") | .name'` to list fast skills.
- **No more install warnings** — `npm install -g @scanton/phase2s` now runs clean. The `node-domexception` deprecation warning (from `openai` → `formdata-node`) is gone via an `overrides` entry forcing `formdata-node@^6`.
- **Accurate test counts** — vitest was discovering test files in `.claude/worktrees/` and reporting 861 tests instead of 291. Fixed by adding `vitest.config.ts` with explicit `include`/`exclude`. `npm test` now runs in ~1.3s instead of ~2.7s.
- **`/plan` saves to disk with timestamp** — plans are saved to `.phase2s/plans/YYYY-MM-DD-HH-MM-<slug>.md` so multiple plans in a day don't collide. Path is reported after saving.
- **`--version` reads from `package.json` at runtime** — no more hardcoded version constant that gets out of sync on bumps.

### For contributors

- `vitest.config.ts` (new) — explicit include/exclude replaces vitest's default glob
- `package.json` — `overrides.formdata-node: ^6.0.0`; version `0.20.0`
- `src/cli/index.ts` — `skills` command gains `--json` option; `VERSION` now read from `package.json` via `createRequire`
- `.phase2s/skills/plan/SKILL.md` — updated plan file path format and instructions
- **295 tests** (up from 291). New: +4 `--json` serialisation tests.

## v0.19.1 — 2026-04-04

Patch: sync `VERSION` constant with `package.json` (was reporting 0.18.0 after v0.19.0 publish).

## v0.19.0 — 2026-04-04

Sprint 15 polish: `--dry-run` flag, typed input hints in REPL, model tier badges in skill list.

### What you can do now

- **`phase2s run --dry-run "/explain src/auth.ts"`** — preview which skill and model would be used without running anything. Useful when debugging `fast_model`/`smart_model` config. Shows "Would route to skill: explain (model: gpt-4o-mini)" or "No skill named 'X'. Would run as plain prompt."
- **Typed input hints in REPL** — when a skill asks you for an input, the prompt now shows the expected format inline. Boolean inputs show `(yes/no)`, enum inputs show `[low/medium/high]`. No more guessing valid values.
- **Model tier badges in skill list** — `phase2s skills` now shows `[fast]` or `[smart]` next to each skill name so you can see at a glance which model tier each skill uses. Skills without a declared tier show no badge.

### For contributors

- **`src/cli/index.ts`** — `run` command gains `--dry-run` option. Skills command gains tier badge display. REPL input prompting appends `typeHint` based on `SkillInput.type`.
- **291 tests** (up from 279). New: +12 tests for dry-run routing, tier badges, and typed input hints.

## v0.18.0 — 2026-04-04

Sprint 15: Model tier dogfooding, one-shot skill routing, typed inputs v2.

### What you can do now

- **Model tier routing actually works** — 28 of 29 built-in skills now declare their model tier. Quick skills (`/explain`, `/diff`, `/checkpoint`, `/remember`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/skill`) run on `fast_model`. Deep skills (`/review`, `/satori`, `/debug`, `/investigate`, `/audit`, `/health`, `/qa`, `/tdd`, `/slop-clean`, `/plan`, `/plan-review`, `/scope-review`, `/deep-specify`, `/ship`, `/retro`, `/land-and-deploy`, `/docs`, `/adversarial`, `/consensus-plan`) run on `smart_model`. If you've configured `fast_model` and `smart_model` in `.phase2s.yaml`, this now actually does something.
- **One-shot skill routing** — `phase2s run "/explain src/auth.ts"` now routes through the explain skill and applies its model tier. Previously `phase2s run` treated everything as a plain prompt regardless of `/` prefix. REPL and one-shot mode now behave consistently. Routing is logged to stderr: `Routing to skill: explain (model: fast)`.
- **Typed MCP tool parameters** — Skills with `inputs:` can now declare `type: boolean | enum | number` on individual inputs. Claude Code presents boolean inputs as checkboxes, enum inputs as dropdowns, and number inputs as number fields. All values are stringified before template substitution. See [docs/writing-skills.md](docs/writing-skills.md).
- **glob upgraded to v13** — The `glob` package used for the file search tool has been upgraded from v11 (deprecated) to v13. No behavior changes.

### New SKILL.md frontmatter fields

```yaml
inputs:
  feature:
    prompt: "What feature are you planning?"
    type: string      # default, MCP: string field
  include_tests:
    prompt: "Include test tasks?"
    type: boolean     # MCP: boolean checkbox
  format:
    prompt: "Output format"
    type: enum
    enum: [prose, bullets, table]  # MCP: dropdown
  max_items:
    prompt: "Max items"
    type: number      # MCP: number field
```

### For contributors

- **`src/skills/types.ts`** — `SkillInput` gains optional `type?: "string" | "boolean" | "enum" | "number"` and `enum?: string[]`.
- **`src/skills/loader.ts`** — Parses `type:` and `enum:` from YAML inputs. Validates type values (unknown → warn + fallback to "string"). Coerces `enum: "string"` → `["string"]` (YAML parser edge case). Warns on invalid `model:` values that look like misspelled tiers.
- **`src/mcp/server.ts`** — `skillToTool()` emits typed JSON Schema: `boolean` → `{ type: "boolean" }`, `enum` → `{ type: "string", enum: [...] }`, `number` → `{ type: "number" }`. Input values are coerced to strings via `String()` before template substitution.
- **`src/cli/index.ts`** — New exported `resolveSkillRouting()` function detects `/skillname` prefix, looks up the skill, calls `substituteInputs()` (not a direct string replace), applies `modelOverride`. `oneShotMode()` delegates to it. Logs routing and unknown-skill warnings to stderr.
- **`package.json`** — `glob` updated from `^11.0.0` to `^13.0.0`.
- **279 tests** (up from 267). New: +6 loader tests (type/enum parsing and validation), +3 server tests (typed schema generation), +3 cli tests (one-shot routing).

## v0.17.0 — 2026-04-04

Sprint 14: Multi-provider support — Anthropic and Ollama.

### What you can do now

- **Run skills on Claude** — set `provider: anthropic` in `.phase2s.yaml` and every one of the 29 skills runs on Claude 3.5 Sonnet (or any Claude model you specify). Same `/adversarial`, `/satori`, `/consensus-plan` — now with Anthropic's API. Reads `ANTHROPIC_API_KEY` from env automatically.
- **Run skills locally, free, private** — set `provider: ollama` and `model: qwen2.5-coder:7b` (or any model you have pulled) and the entire skill library runs on your machine. No API keys. Works offline. Free after the initial model pull.
- **Switch providers with one line** — the only change needed is `provider:` in `.phase2s.yaml`. No other config required.

### New config fields

- `provider: anthropic | ollama` — two new values alongside the existing `codex-cli` and `openai-api`
- `anthropicApiKey` — Anthropic API key (falls back to `ANTHROPIC_API_KEY` env var)
- `anthropicMaxTokens` — max tokens for Anthropic responses (default `8192`)
- `ollamaBaseUrl` — Ollama server base URL (default `http://localhost:11434/v1`)
- Default models: `anthropic` → `claude-3-5-sonnet-20241022`, `ollama` → `llama3.1:8b`

### For contributors

- **`src/providers/anthropic.ts`** — New `AnthropicProvider` implementing `Provider`. Translates Anthropic streaming events (`content_block_delta`, `tool_use` blocks, `message_stop`) to the shared `ProviderEvent` format. Exports `translateMessages()` for direct testing — handles system message extraction, assistant tool-call turns, and consecutive tool-result folding into single synthetic user messages.
- **`src/providers/ollama.ts`** — `createOllamaProvider()` factory. Reuses `OpenAIProvider` with `baseURL` injection — Ollama's OpenAI-compatible API requires no new class.
- **`src/providers/index.ts`** — `createProvider()` extended for `"anthropic"` and `"ollama"` cases.
- **`src/core/config.ts`** — Provider enum extended to 4 values. New optional fields: `anthropicApiKey`, `anthropicMaxTokens`, `ollamaBaseUrl`. `ANTHROPIC_API_KEY` env var wired. `resolveDefaultModel()` returns correct defaults per provider.
- **267 tests** (up from 249). New: `test/providers/anthropic.test.ts` (12 tests), `test/providers/ollama.test.ts` (4 tests), +2 config tests.
- **Review hardening** (follow-up commit): stream error safety (`try/catch/finally` with `doneEmitted` guard), Anthropic preflight check in CLI, `anthropicMaxTokens` integer validation, `isLocalUrl()` SSRF warning for remote Ollama URLs, multi-system-message warning in `translateMessages()`.

## v0.15.0 — 2026-04-04

Sprint 12: MCP hot-reload and session persistence.

### What you can do now

- **Skills hot-reload** — create a new skill with `/skill` during a Claude Code session and it becomes available as a Claude Code tool automatically, without restarting the MCP server. The server watches `.phase2s/skills/` for new entries and sends `notifications/tools/list_changed` to the client per MCP spec.
- **MCP session persistence** — multi-turn skills like `/satori` and `/consensus-plan` now maintain conversation history across multiple `tools/call` invocations in the same Claude Code session. Each skill gets its own `Conversation` that lives for the lifetime of the `phase2s mcp` subprocess. Previously every call started cold.

### For contributors

- **`src/mcp/server.ts`** — Added `MCPNotification` interface, `buildNotification()` helper, `setupSkillsWatcher()` (exported, tested in isolation). `handleRequest()` gains optional `sessionConversations?: Map<string, Conversation>` fourth parameter — backward-compatible. `initialize` response now includes `capabilities: { tools: { listChanged: true } }`. `runMCPServer()` creates the session map and wires the watcher.
- **`test/mcp/server.test.ts`** — Updated `MockAgent` to include `getConversation()`. 6 new tests: capabilities advertisement, `buildNotification` format, session map population, conversation reuse, per-skill isolation, stateless fallback.
- **`test/mcp/watcher.test.ts`** — New file. 4 tests for `setupSkillsWatcher`: watcher registration, debounced reload + notify, debounce coalescing, missing-directory error handling. Mocks `node:fs` in isolation.
- **220 tests total** (up from 209).

## v0.13.0 — 2026-04-04

Sprint 11: `/land-and-deploy` skill — push, PR, CI wait, merge.

### What you can do now

- **`/land-and-deploy`** — the missing link between `/ship` (commit) and production. Push the current branch, create or find the PR via `gh` CLI, wait for CI checks to pass, merge, delete the remote branch, and confirm the land. Handles the common failure paths cleanly: uncommitted changes, push conflicts, CI failures, merge conflicts — stops with a clear message at each, no silent failures, no force-push without instruction. Requires `gh` CLI installed and authenticated.

### For contributors

- **`.phase2s/skills/land-and-deploy/SKILL.md`** — new skill file. 7-step process covering state check, push, PR creation/discovery, CI wait, merge, and post-merge confirmation.
- **`test/skills/built-in-skills.test.ts`** — 3 new tests (name/triggers, prompt coverage, total count ≥ 29). **208 tests total** (up from 205).
- **`docs/skills.md`** — `/land-and-deploy` section added under Planning and shipping. Count updated to 29.
- **`docs/workflows.md`** — Step 5 (land-and-deploy) added to the "Starting a new feature" workflow.
- **`README.md`** — skill count updated to 29, `/land-and-deploy` added to highlights and roadmap.

## v0.12.0 — 2026-04-04

Sprint 10: Persistent memory, meta-skill (/skill), session security hardening, and signal handler guard.

### What you can do now

- **Persistent memory** — Phase2S now remembers your project preferences, decisions, and lessons across sessions. On startup, it loads `.phase2s/memory/learnings.jsonl` and injects up to 2000 characters of learnings into the system prompt. The agent knows your project's conventions without you having to re-explain them every session.
- **`/remember`** — save a learning to memory with one command. Ask Phase2S to remember anything: "remember this: we use vitest not jest", "remember that the codex binary is at /opt/homebrew/bin/codex". Two follow-up questions (what to remember, what type), then it appends a JSON line to `.phase2s/memory/learnings.jsonl`. The next session picks it up automatically.
- **`/skill`** — create a new Phase2S skill from inside Phase2S. Three questions (what it does, what phrases trigger it, which model tier), then Phase2S writes the SKILL.md to `.phase2s/skills/<name>/SKILL.md`. No manual YAML editing required. Phase2S can now extend itself.
- **Session file security** — session files (`.phase2s/sessions/*.json`) are now written with `mode: 0o600` (owner-read/write only). On shared or multi-user systems, conversation history is no longer world-readable. Both write paths (normal save after each turn + SIGINT emergency save) are fixed.

### For contributors

- **`src/core/memory.ts`** — new file. `loadLearnings(cwd)`: reads JSONL, skips invalid lines silently, returns `Learning[]`. `formatLearningsForPrompt(learnings)`: formats for system prompt injection, trims oldest first if over 2000 chars.
- **`src/utils/prompt.ts`** — `buildSystemPrompt()` gains optional `learnings?: string` third parameter. Appended after custom prompt if non-empty.
- **`src/core/agent.ts`** — `AgentOptions` gains `learnings?: string`. Passed to `buildSystemPrompt()` in constructor.
- **`src/core/conversation.ts`** — `save()` gains optional `mode?: number` parameter. Passed to `writeFile()` options when specified.
- **`src/cli/index.ts`** — `interactiveMode()` and `oneShotMode()` both call `loadLearnings(process.cwd())` and pass formatted string to `new Agent(...)`. Async save uses `mode: 0o600`. Sync SIGINT save uses `{ encoding: "utf-8", mode: 0o600 }`. VERSION bumped to `"0.12.0"`.
- **`src/providers/codex.ts`** — `_signalHandlersRegistered` guard flag wraps all three signal handler registrations (`exit`, `SIGTERM`, `SIGINT`). Prevents `MaxListenersExceededWarning` when vitest re-evaluates the module across test files.
- **2 new SKILL.md files** — `.phase2s/skills/remember/SKILL.md`, `.phase2s/skills/skill/SKILL.md`.
- **5 new test files/sections** — `test/core/memory.test.ts` (9 tests), `test/utils/prompt.test.ts` (3 tests), built-in skills Sprint 10 section (5 tests), conversation persistence mode tests (2 tests), codex hardening guard test (1 test). **205 tests total** (up from 186).

### MCP backlog (deferred to Sprint 11)

- **MCP skills reload** — skills added mid-session via `/skill` aren't visible to Claude Code until restart. Future: `tools/reload` method.
- **MCP tool calls stateless** — each `tools/call` creates a fresh agent. Multi-turn MCP skills start cold every call. Future: per-session conversation persistence in MCP server.

## v0.11.0 — 2026-04-04

Sprint 9: Claude Code MCP integration — Phase2S skills as Claude Code tools, `/adversarial` skill, and cross-model review.

### What you can do now

- **`phase2s mcp`** — start Phase2S as an MCP server. Claude Code spawns it automatically when `.claude/settings.json` is present in your project root. Every Phase2S skill becomes a `phase2s__<name>` Claude Code tool, loaded dynamically at startup. Add a SKILL.md, get a new tool. No code changes required.
- **`/adversarial`** — cross-model adversarial review designed for AI-to-AI invocation. Paste a plan or decision as input. Get back a structured verdict: `VERDICT: APPROVED | CHALLENGED | NEEDS_CLARIFICATION`, plus `STRONGEST_CONCERN`, `OBJECTIONS` (up to 3, specific and falsifiable), and `APPROVE_IF`. No interactive questions. Machine-readable output. When Claude Code (Claude, Anthropic) calls this via MCP, Phase2S (GPT-4o via Codex CLI) does the challenging. Different model, different training, no stake in agreeing.
- **Claude Code routing** — `CLAUDE.md` in the project root tells Claude Code when to invoke Phase2S tools automatically: adversarial review before significant plans, plan-review on engineering specs, health checks after sprints, etc.

### For contributors

- **`src/mcp/server.ts`** — new file. Exports `runMCPServer(cwd)`, `handleRequest(request, skills, cwd)` (testable without stdio), `skillToTool(skill)`, `toolNameToSkillName(toolName)`, and `MCP_SERVER_VERSION`. Uses same manual event-queue pattern as the CLI REPL to avoid the readline async iterator issue.
- **`src/cli/index.ts`** — `phase2s mcp` subcommand added. VERSION bumped to `"0.11.0"`.
- **`.claude/settings.json`** — project-level MCP server config. `command: "phase2s", args: ["mcp"]`. No env vars.
- **`CLAUDE.md`** — routing rules for Phase2S MCP tools added alongside existing gstack skill routing.
- **`.phase2s/skills/adversarial/SKILL.md`** — `model: smart`, no retries, no interactive steps. Output format enforced in prompt: VERDICT / STRONGEST_CONCERN / OBJECTIONS / APPROVE_IF.
- **11 new tests** — MCP server (7 in `test/mcp/server.test.ts`), adversarial skill (4 in `test/skills/built-in-skills.test.ts`). **186 tests total** (up from 175).

## v0.10.0 — 2026-04-04

Sprint 8: OMX Infrastructure — satori persistent execution loop, consensus-plan, agent tier routing (fast_model/smart_model), context snapshots, and underspecification gate.

### What you can do now

- **`/satori`** — persistent execution until verified complete. Runs a task, verifies with `npm test` (or `verifyCommand`), retries on failure (up to 3 times), injects failure context on each retry. Writes a context snapshot to `.phase2s/context/` before starting and a satori log to `.phase2s/satori/` after each attempt. Stops when tests are green.
- **`/consensus-plan`** — consensus-driven planning. Three sequential passes: Planner (concrete implementation plan), Architect (structural review, flags CONCERN/SUGGESTION), Critic (adversarial objections). Loops back to Planner with objections as constraints (max 3 loops). Outputs APPROVED / APPROVED WITH CHANGES / REVISE.
- **Agent tier routing** — skills (and callers) can now specify `model: fast` or `model: smart` in SKILL.md frontmatter. The agent resolves aliases to `config.fast_model` / `config.smart_model`, falling back to `config.model` if not configured. Set via `PHASE2S_FAST_MODEL` / `PHASE2S_SMART_MODEL` env vars or `.phase2s.yaml`.
- **Underspecification gate** — when `requireSpecification: true` in config, short prompts without file paths are rejected with a warning. Override with `force:` prefix.
- **Satori mode in agent** — `agent.run()` now accepts `maxRetries`, `verifyCommand`, `verifyFn` (for testing), `preRun`, and `postRun` options. The satori loop injects failure output back into the conversation and calls postRun after each attempt.

### For contributors

- **`src/core/agent.ts`** — full rewrite. `run()` now accepts `AgentRunOptions` (backward compatible: old `(message, onDelta)` signature still works). Inner `runOnce()` extracted so `addUser()` stays in the outer `run()` — satori retries inject new failure messages, not re-add the original user message. `verifyFn?` in options enables test injection without a real shell.
- **`src/core/config.ts`** — added `fast_model`, `smart_model`, `verifyCommand` (default: `"npm test"`), `requireSpecification` (default: `false`). Env vars: `PHASE2S_FAST_MODEL`, `PHASE2S_SMART_MODEL`, `PHASE2S_VERIFY_COMMAND`.
- **`src/providers/types.ts`** — `ChatStreamOptions` interface added. `chatStream()` now accepts optional third arg `options?: ChatStreamOptions` with `model?` field.
- **`src/providers/openai.ts`** and **`src/providers/codex.ts`** — updated to accept and pass through `options?.model`.
- **`src/skills/types.ts`** — `model?` and `retries?` fields added to `Skill` interface.
- **`src/skills/loader.ts`** — `model` and `retries` frontmatter fields parsed and attached to skill objects.
- **2 new SKILL.md files** in `.phase2s/skills/` — satori, consensus-plan.
- **18 new tests** — config Sprint 8 (4), loader Sprint 8 (3), agent satori loop (7), built-in skills Sprint 8 (4). **175 tests total** (up from 157).
- **`UNDERSPEC_WORD_THRESHOLD = 15`** — named constant, not a magic number.
- **VERSION** — fixed from stale `"0.7.0"` to `"0.10.0"`.

## v0.9.0 — 2026-04-03

Sprint 7: 5 execution skills — workflows for the actual work of writing, debugging, cleaning, and documenting code. Two ported from oh-my-codex (`/deep-specify` from `$deep-interview`, `/slop-clean` from `$ai-slop-cleaner`), three original.

### What you can do now

- **`/debug`** — systematic debugging end-to-end. Reproduce the bug, isolate the smallest failing case, form root cause hypotheses, implement the fix, verify with tests. Different from `/investigate` (which traces root cause only) — `/debug` goes all the way to a verified fix. Saves a debug log to `.phase2s/debug/`.
- **`/tdd`** — test-driven development. Red (write failing tests) → Green (minimal implementation) → Refactor (clean up). Detects your test framework from `package.json`. Accepts a target file or behavior description. Reports coverage delta.
- **`/slop-clean`** — anti-slop refactor pass, ported from oh-my-codex's `$ai-slop-cleaner`. Five-smell taxonomy: dead code, duplication, needless abstraction, boundary violations, missing tests. Runs on git-changed files or a specified path. Baseline tests before any changes. One smell category at a time. Tests after each pass.
- **`/deep-specify`** — structured spec interview before coding, ported from oh-my-codex's `$deep-interview`. Identifies the 3-5 highest-risk ambiguities, asks Socratic questions one at a time, synthesizes answers into a spec with Intent / Boundaries / Non-goals / Constraints / Success criteria. Saves to `.phase2s/specs/`. Gates at the end with a pointer to `/plan` or `/autoplan`.
- **`/docs`** — inline documentation generation. Writes JSDoc/TSDoc into the code itself (not an explanation to you). Priority: public API first (full `@param`/`@returns`/`@throws`/`@example`), then complex logic inline comments, then interface field annotations, then module headers. Runs `tsc --noEmit` after to catch annotation errors.

### For contributors

- **5 new SKILL.md files** in `.phase2s/skills/` — debug, tdd, clean, deep-specify, docs.
- **OMX adaptation strategy** — `/deep-specify` and `/slop-clean` are ported from oh-my-codex with two changes: (1) OMX infrastructure dependencies removed (no MCP state, no tmux workers, no `.omx/` paths), (2) paths remapped to `.phase2s/`. The smell taxonomy and Socratic question protocol are preserved intact.
- **Artifact directories** — new skills persist to `.phase2s/debug/` and `.phase2s/specs/` (consistent with existing `.phase2s/sessions/`, `.phase2s/checkpoints/`).
- **6 new tests** in `test/skills/built-in-skills.test.ts` — covers all 5 new skills (name, description, trigger phrases, prompt content checks) plus a sanity check that total loaded skill count is >= 23. **157 tests total** (up from 151).
- **OMX infrastructure backlog** — the power features from oh-my-codex that require Phase2S core changes (agent tier routing, `$ralph` persistent execution, `$ralplan` consensus planning, tmux teams, MCP state server, notification gateway) are documented in TODOS.md Long-term section for a future infrastructure sprint.

## v0.8.0 — 2026-04-03

Sprint 6: 11 new skills ported from gstack, stripped of YC marketing, renamed where startup connotations didn't fit.

### What you can do now

- **`/retro`** — weekly engineering retrospective. Runs `git log` across the last 7 days, reports velocity (commits, LOC, fix ratio, test ratio), identifies patterns and churn, ends with one concrete improvement to focus on next week. Saves to `.phase2s/retro/`.
- **`/health`** — code quality dashboard. Auto-detects your tooling (tsc, vitest/jest, eslint, knip). Runs each check, scores on a 0–10 weighted rubric (tests 40%, types 25%, lint 20%, dead code 15%). Shows trend across last N runs. Persists to `.phase2s/health/history.jsonl`. Reports only — does not fix.
- **`/audit`** — multi-phase security scan. Covers: secrets in code and git history, dependency vulnerabilities (`npm audit`), input validation and injection paths, sandbox enforcement review, shell command safety, and session/persistence security. Each finding includes severity (CRIT/HIGH/MED/LOW), confidence (VERIFIED/UNVERIFIED), and an exploit scenario.
- **`/plan-review`** — engineering plan review. Six sections: scope validation, architecture critique, code quality, test coverage map (ASCII diagram of which paths are tested vs. not), performance flags, and one adversarial outside challenge. Ends with APPROVE / APPROVE WITH CHANGES / REVISE AND RESUBMIT.
- **`/scope-review`** — scope and ambition challenge. Four modes: Expand (what's the 10x version?), Hold (max rigor on stated scope), Reduce (strip to essentials), Challenge (adversarial). Distinct from `/plan-review` which focuses on implementation quality vs. this which focuses on whether you're solving the right problem at the right scale.
- **`/autoplan`** — orchestrates `/scope-review` + `/plan-review` sequentially with defined auto-decision principles: prefer completeness, fix blast radius, cleaner architecture wins, eliminate duplication, explicit over clever, bias toward action. Surfaces only taste decisions and user challenges at the end gate.
- **`/checkpoint`** — structured session state snapshot. Infers current state from git and conversation: branch, recent commits, decisions made, remaining work, next step. Saves to `.phase2s/checkpoints/YYYY-MM-DD-HH-MM.md`. Complements `--resume` (which restores the full conversation) with a human-readable summary.
- **`/careful`** — safety mode. Pauses before destructive shell commands (rm, git reset --hard, git push --force, DROP TABLE, docker rm, sudo) and asks for explicit confirmation. Safe commands (ls, git status, npm test) proceed without prompting.
- **`/freeze <dir>`** — restricts file edits to a single directory for the session. Ask the user which directory, then enforce it via model self-monitoring. Read operations unrestricted.
- **`/guard`** — combines `/careful` + `/freeze`. Full safety mode: destructive command confirmation AND directory-scoped edits. Single activation step.
- **`/unfreeze`** — clears the edit directory restriction set by `/freeze` or `/guard`.

### For contributors

- **11 new SKILL.md files** in `.phase2s/skills/` — retro, health, audit, plan-review, scope-review, autoplan, checkpoint, careful, freeze, guard, unfreeze. All follow the standard SKILL.md format (YAML frontmatter + prompt template).
- **Adaptation strategy** — skills are ported from gstack with two changes: (1) YC marketing content stripped (no Garry Tan persona, no YC application prompts, no garryslist.org essay links), (2) names with startup connotations renamed (cso → audit, plan-ceo-review → scope-review, plan-eng-review → plan-review).
- **Safety skills are prompt-only** — careful/freeze/guard/unfreeze enforce via model self-monitoring, not tool hooks. Phase2S's `allowDestructive: false` config provides shell-level enforcement underneath. This is documented as a soft constraint in each skill.
- **Artifact directories** — new skills persist to `.phase2s/retro/`, `.phase2s/health/`, `.phase2s/checkpoints/`, `.phase2s/security-reports/` (consistent with existing `.phase2s/sessions/`).
- **12 new tests** in `test/skills/built-in-skills.test.ts` — covers all 11 new skills (name, description, trigger phrases, prompt content) plus a sanity check that total loaded skill count is ≥ 18. **151 tests total** (up from 139).

## v0.7.0 — 2026-04-03

Sprint 5: security hardening, conversation persistence, and /diff skill.

### What you can do now

- **`phase2s --resume`** — picks up exactly where you left off. Every interactive turn is auto-saved to `.phase2s/sessions/<YYYY-MM-DD>.json`. Start a long debugging session, quit, come back the next day with `phase2s --resume` and the full conversation history is there.
- **`/diff` skill** — review uncommitted or last-commit changes with structured feedback. Say "what changed", "review this diff", or "check my diff". Gets you: what changed per file, why it probably changed, risk assessment, and test coverage gaps. Ends with a clear verdict (LOOKS GOOD / NEEDS REVIEW / RISKY).
- **Sandbox symlink fix** — `file_read` and `file_write` now use `realpath()` before the sandbox check. A symlink at `<project>/link -> /etc` would previously bypass the sandbox. Now it's blocked. Real files inside the project still work exactly as before.
- **Codex arg safety** — prompts starting with `--` are no longer misread by codex's own arg parser. The `"--"` end-of-flags separator is now inserted into the args array before the prompt.

### For contributors

- **`src/tools/sandbox.ts`** — new shared `assertInSandbox(filePath, cwd?)` helper. Uses `fs.realpath()` to follow symlinks before the sandbox check. Both `file-read` and `file-write` now call it instead of duplicating the `path.resolve()` check. ENOENT falls back to lexical resolve (safe for new files); other errors (dangling symlinks) block without leaking the absolute path.
- **`Conversation.save(path)` + `Conversation.load(path)`** — serialize/deserialize message history (including tool calls and tool results) to JSON. Parent directories are created automatically.
- **`AgentOptions.conversation?`** — inject an existing `Conversation` when constructing an `Agent`. Used by `--resume` to skip the fresh system prompt and load prior history. `agent.getConversation()` exposes the live conversation for post-run saves.
- **`cleanupTempDirs()` in codex.ts** — extracted into a named function, registered on `exit`, `SIGTERM`, and `SIGINT`. Previously SIGTERM would bypass cleanup and leak prompt data in `/tmp`.
- **139 tests total** — 26 new tests: 22 across `test/tools/sandbox.test.ts`, `test/core/conversation-persistence.test.ts`, `test/skills/diff-skill.test.ts`, and `test/providers/codex-hardening.test.ts`, plus 4 more added during adversarial review hardening (parent-symlink attack, session prompt injection, role validation, message object validation). All 113 existing tests continue to pass.

---

## v0.6.0 — 2026-04-03

Sprint 4: streaming output and npm publish.

### What you can do now

- **Responses stream in real time** — words appear in your terminal as the model thinks. No spinner. No wait. Works in both the interactive REPL and `phase2s run "..."` one-shot mode. Set `OPENAI_API_KEY` and `PHASE2S_PROVIDER=openai-api` to see it.
- **`PHASE2S_ALLOW_DESTRUCTIVE=true` env var** — unlock destructive shell commands (`rm -rf`, `sudo`, etc.) without a `.phase2s.yaml` file. Useful for scripted or automated use cases where you control the environment.
- **`npm install -g phase2s` is ready** — bin entry verified, `files` field set for a clean 36.5kB tarball. Publish workflow fires automatically on `git tag v0.6.0 && git push origin v0.6.0` once `NPM_TOKEN` is set in repo secrets.

### For contributors

- **Breaking interface change: `chat()` → `chatStream()`** — `Provider` now requires `chatStream(): AsyncIterable<ProviderEvent>`. Both providers updated. Old `chat()` is gone.
- **OpenAI streaming** — `chatStream()` uses `stream: true`. Tool call argument fragments accumulate per-index across chunks before emitting a `tool_calls` event. See `src/providers/openai.ts` for the accumulation logic.
- **Codex passthrough wrapper** — `chatStream()` wraps private `_chat()` in a single-event generator. Same batch UX as before, new interface. Real Codex JSONL streaming deferred.
- **`onDelta?: (text: string) => void` callback on `Agent.run()`** — fires with each text chunk. The CLI uses it to stream to stdout; skills call `run()` without it for batch semantics.
- **Test migration** — all 8 agent integration tests migrated from non-streaming stubs to `makeStreamingFakeClient`. 6 new tests added (delta ordering, fragment accumulation, event sequence, Codex wrapper, env var truthy variants). 113 tests total.
- **GitHub Actions publish workflow** — `.github/workflows/publish.yml` triggers on `v*` tag push, runs `npm test` before build. Requires `NPM_TOKEN` repo secret.
- **Post-review hardening** — `ora` removed from production deps (was unused after streaming); sparse `toolCallAccum` guard added (non-contiguous tool call indices from OpenAI are now filtered before emitting); `PHASE2S_ALLOW_DESTRUCTIVE` now accepts `"1"` and `"yes"` in addition to `"true"`.

---

## v0.5.0 — 2026-04-03

Sprint 3: integration tests, shell hardening, and live API verification.

### What you can do now

- **`openai-api` provider works** — run `PHASE2S_PROVIDER=openai-api phase2s run "..."` with your OpenAI key and get real tool-calling responses. The full loop (user → LLM → tool call → execute → final answer) has been tested live against the API.
- **Shell safety on by default** — destructive commands (`rm -rf`, `sudo`, `curl | sh`, `git push --force`, etc.) are blocked unless you explicitly set `allowDestructive: true` in `.phase2s.yaml`. Safe to share configs with your team without accidentally blowing up something.
- **Truncation handling** — if the LLM hits its context limit mid-response, you get the partial text back with a clear `[Note: response was truncated]` notice instead of silence. Content-filtered responses return `[Response blocked by content filter]`.

### For contributors

- **8 agent integration tests** in `test/core/agent.test.ts` — covers no-tool-call, single tool call, multi-turn, tool error recovery, max turns sentinel, finish_reason length, finish_reason content_filter, and malformed JSON arguments. 107 tests total.
- **`OpenAIClientLike` interface** exported from `src/providers/openai.ts` — typed DI stub for tests, no real API key needed in CI.
- **`AgentOptions.provider?: Provider`** — inject a pre-constructed provider in tests without touching config.
- **`createShellTool(allowDestructive)` factory** in `src/tools/shell.ts` — backward-compat `shellTool` export unchanged, all 10 existing non-destructive shell tests unaffected.
- **`allowDestructive: boolean` (default `false`)** added to config schema in `src/core/config.ts`.

---

## v0.4.0 — 2026-04-03

Sprint 2: test coverage expansion, CI, and the `/explain` skill.

### For contributors

- Test suite grows from 56 to 96 tests across 10 test files
- **New: `test/tools/glob.test.ts`** — 9 tests: pattern matching, recursive `**` globs, `cwd` sandbox enforcement, custom ignore, node_modules default ignore
- **New: `test/tools/grep.test.ts`** — 8 tests: case-insensitive search, `filePattern` filtering, `maxResults` truncation, sandbox enforcement
- **New: `test/core/registry.test.ts`** — 9 tests: all `ToolRegistry` methods plus all three error paths in `execute()` (unknown tool, invalid args, thrown error)
- **New: `test/skills/loader.test.ts`** — 10 tests: flat `.md` files, directory-based `SKILL.md`, YAML array triggers, malformed frontmatter, README skip, missing dirs, `sourcePath`, deduplication
- **CI: `.github/workflows/test.yml`** — `npm test` runs on every push and pull request, Node.js 22, `npm ci`

### Added

- **`/explain` skill** — ask Phase2S to explain any piece of code or concept in plain language. Say "explain this", "what does this do", or "walk me through this" and it breaks it down clearly, following the code top-to-bottom and explaining intent, not just mechanics.

---

## v0.3.0 — 2026-04-03

Test suite, security hardening, and tool behavior improvements.

### For contributors

- `npm test` now works — 54 unit tests across tools and core modules (vitest)
- Tests cover: `file_read`, `file_write`, `shell`, `Conversation`, `loadConfig`
- Tests are deterministic on any machine (temp dir isolation, `HOME` override)

### Security fixes

- **File sandbox enforced** — `file_read` and `file_write` now reject any path outside the project directory. The LLM can no longer read `~/.ssh/id_rsa` or write outside your repo.
- **Truncation guard** — `file_write` refuses to overwrite an existing file with empty content. Prevents silent data loss from an LLM that sends an empty string.
- **Error sanitization** — `file_read` and `file_write` strip absolute filesystem paths from error messages before returning them to the LLM.
- **YAML config errors surface** — a malformed `.phase2s.yaml` now shows you the parse error instead of silently ignoring it and using defaults.

### Bug fixes

- **Context trim was dropping tool results but leaving their paired assistant `tool_calls` references** — this would cause an OpenAI API 400 error on the next turn. Now the entire turn (assistant message + all its tool results) is dropped atomically.
- **Codex temp dir cleanup was dead code** — the exit handler was calling `Set.delete` instead of `rmSync`. Temp dirs now actually get removed when the process exits or crashes.

---

## v0.2.0 — 2026-04-03

Added 5 built-in skills, fixed skill loader, added startup safety check.

### What you can do now

- Invoke `/review`, `/investigate`, `/plan`, `/ship`, `/qa` directly from the REPL
- Pass file arguments: `/review src/core/agent.ts` focuses Codex on a specific file
- Skills auto-load from `~/.codex/skills/` — Codex CLI skills work in Phase2S without any extra config
- Startup check: clear install instructions if `codex` isn't found, instead of a cryptic error

### Fixes

- SKILL.md frontmatter now parsed with the `yaml` library (arrays, multi-line values, quoted strings all work)
- `~/.codex/skills/` added to the skill search path with name deduplication (project skills win)

---

## v0.1.0 — 2026-04-03

First working release of Phase2S.

### What you can do now

- Run `phase2s` to open an interactive REPL powered by OpenAI Codex
- Use `phase2s run "..."` for one-shot prompts
- Invoke 5 built-in skills: `/review`, `/investigate`, `/plan`, `/ship`, `/qa`
- Pass file arguments to skills: `/review src/core/agent.ts`
- Drop a SKILL.md in `.phase2s/skills/` and it becomes a `/command` instantly
- Skills auto-load from `~/.codex/skills/` — anything you've written for Codex CLI works here too

### Provider

Codex CLI provider (`codex exec --json --full-auto`). Non-interactive, terminal-safe — codex never touches `/dev/tty`, so the REPL stays alive across multiple turns.

Model is auto-detected from `~/.codex/config.toml`. No need to configure twice.

### Under the hood

- SKILL.md frontmatter parsed with the `yaml` library — supports arrays, multi-line values, quoted strings
- Startup check: if `codex` isn't on PATH, you get a clear install message instead of a cryptic error
- REPL uses a manual event queue (not readline's async iterator, which has a known issue with event loop draining between turns)
