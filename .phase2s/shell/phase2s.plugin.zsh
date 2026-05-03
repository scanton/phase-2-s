# Phase2S Shell Integration
# Install:  phase2s setup
# Upgrade:  phase2s setup (idempotent — safe to re-run after npm update)
# Manual:   source ~/.phase2s/phase2s.plugin.zsh
#
# Usage:
#   : fix the null check in auth.ts
#   : what does this codebase do?
#   p2 explain this function

# Internal helper called by both ':' and 'p2' aliases.
#
# Why a helper + alias instead of function : () directly:
#   ZSH performs glob expansion on command arguments BEFORE looking up the
#   function to call. A prompt like ': what does this codebase do?' causes
#   ZSH to try to expand 'do?' as a glob — erroring if no file matches.
#   Aliases are expanded first, before glob processing. By using
#   'alias :=noglob __phase2s_run', the noglob precommand modifier
#   suppresses glob expansion so all argument text reaches the function intact.
#
# With args (non-comment):  runs phase2s run "<args>" (quick one-shot mode)
# With no args OR comment:  preserves null command behavior (no-op)
#
# NOTE: if you add subcommands to phase2s, update BOTH the subcommands array below
#       AND ZSH_COMPLETION in src/cli/index.ts (they are intentionally kept in sync).
function __phase2s_run() {
  if [[ $# -eq 0 || "$*" == "#"* ]]; then
    return 0
  fi
  command phase2s run "$*"
}

# ':' alias with noglob so '?' '!' and other glob chars in prompts pass through.
alias ':=noglob __phase2s_run'

# p2: short alias with the same noglob guard (ZSH only — bash support coming later)
alias p2='noglob __phase2s_run'

# ZSH tab completion (embedded inline — avoids Node.js cold-start cost at shell init)
# Keep in sync with ZSH_COMPLETION in src/cli/index.ts
if [[ -n "$ZSH_VERSION" ]]; then
  function _phase2s() {
    local -a subcommands
    subcommands=(
      'chat:Start an interactive REPL session'
      'run:Run a single prompt and exit'
      'skills:List available skills'
      'mcp:Start as an MCP server for Claude Code'
      'goal:Run a spec file autonomously (dark factory)'
      'report:Display a human-readable summary of a run log'
      'init:Interactive setup wizard'
      'upgrade:Check for a newer version'
      'lint:Validate a 5-pillar spec file'
      'doctor:Check Phase2S installation health'
      'completion:Output shell completion script'
      'setup:Install shell integration (ZSH plugin)'
      'template:Manage spec templates (list / use)'
      'sync:Index the codebase for semantic search (requires Ollama)'
      'search:Search the indexed codebase semantically'
    )
    _describe 'subcommand' subcommands
  }
  # compdef requires compinit to have been called (oh-my-zsh/prezto do this
  # automatically; minimal configs may not). Guard to avoid startup errors.
  if (( ${+functions[compdef]} )); then
    compdef _phase2s phase2s
    compdef _phase2s p2
  fi
fi
