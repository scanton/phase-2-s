# Phase2S Bash Integration
# Install:  phase2s setup --bash
# Upgrade:  phase2s setup --bash (idempotent — safe to re-run after npm update)
# Manual:   source ~/.phase2s/phase2s-bash.sh
#
# Usage (same as ZSH plugin):
#   : fix the null check in auth.ts
#   : what does this codebase do?
#   p2 explain this function
#
# Note: This file is sourced by ~/.bash_profile (login shells).
# For VS Code and non-login terminals, also source it from ~/.bashrc.

# Internal helper called by ':' and 'p2' aliases.
# Bash does not have noglob, so we quote arguments at the call site instead.
__phase2s_run() {
  if [[ $# -eq 0 || "$*" == "#"* ]]; then
    return 0
  fi
  command phase2s run "$*"
}

# ':' — override the null command for Phase2S prompts.
# In Bash, ':' is a built-in (true). We shadow it with a function.
# Args are already quoted by the shell before reaching the function.
#
# Known limitation: bash expands parameter substitutions BEFORE calling functions.
# If your .bash_profile uses `: ${VAR:=default}` to set variable defaults, bash
# will expand ${VAR:=default} first, then pass the expanded value to phase2s run.
# Switch those to `export VAR=${VAR:-default}` to avoid unintended phase2s calls.
:() {
  __phase2s_run "$@"
}

# p2: short alias
alias p2='__phase2s_run'

# Bash tab completion for phase2s subcommands
if [[ -n "$BASH_VERSION" ]] && command -v complete &>/dev/null; then
  _phase2s_completions() {
    local subcommands=(
      chat run skills mcp goal report init upgrade lint
      doctor completion setup template
    )
    local cur="${COMP_WORDS[COMP_CWORD]}"
    # shellcheck disable=SC2207
    COMPREPLY=($(compgen -W "${subcommands[*]}" -- "$cur"))
  }
  complete -F _phase2s_completions phase2s
  complete -F _phase2s_completions p2
fi
