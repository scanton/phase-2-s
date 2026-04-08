# Phase2S Shell Integration
# Install:  phase2s setup
# Upgrade:  phase2s setup (idempotent — safe to re-run after npm update)
# Manual:   source ~/.phase2s/phase2s.plugin.zsh
#
# Usage:
#   : fix the null check in auth.ts
#   : what does this codebase do?
#   p2 explain this function

# Shadow the ZSH ':' builtin.
# With args (non-comment):  runs phase2s run "<args>" (quick one-shot mode)
# With no args OR comment:  preserves null command behavior (no-op)
#
# NOTE: if you add subcommands to phase2s, also update ZSH_COMPLETION in src/cli/index.ts
function : () {
  if [[ $# -eq 0 || "$*" == "#"* ]]; then
    return 0
  fi
  command phase2s run "$*"
}

# p2: short alias (ZSH only — bash support coming in a future release)
alias p2='phase2s run'

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
    )
    _describe 'subcommand' subcommands
  }
  compdef _phase2s phase2s
  compdef _phase2s p2
fi
