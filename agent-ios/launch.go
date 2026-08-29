package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// CreateWorktree delegates to the worktree-create executable rather than
// driving git directly. That script also copies gitignored secrets (.env files,
// Config/Secrets xcconfigs) into the new tree — without them an iOS project
// builds differently from the checkout beside it, which is exactly the class of
// difference this tool exists to eliminate. Reimplementing worktree creation
// here would silently drop that step.
//
// name becomes the directory (agent-named, e.g. claude-1); branch is what gets
// checked out, created from base if it does not exist.
func CreateWorktree(repoRoot, name, branch, base string) (string, error) {
	bin, err := worktreeCreateBin()
	if err != nil {
		return "", err
	}
	args := []string{"-b", branch, name}
	if base != "" {
		args = append(args, base)
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = repoRoot
	// The script reserves stdout for the path; git's progress output and the
	// secret-copy notice go to stderr, where the user should still see them.
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("worktree-create failed: %w", err)
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", fmt.Errorf("worktree-create printed no path")
	}
	return path, nil
}

func worktreeCreateBin() (string, error) {
	if p, err := exec.LookPath("worktree-create"); err == nil {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	fallback := filepath.Join(home, ".local", "bin", "worktree-create")
	if _, err := os.Stat(fallback); err != nil {
		return "", fmt.Errorf("worktree-create not found on PATH or at %s "+
			"(run: chezmoi apply ~/.local/bin/worktree-create)", fallback)
	}
	return fallback, nil
}

// LaunchArgv builds the command line that starts the coding agent with this
// agent's MCP server and nothing else of ours.
//
// Neither form mutates global configuration: Claude Code takes a per-invocation
// config file, and --strict-mcp-config makes it the only source of servers, so
// the user's own global servers stay out of the agent's session. Codex has no
// file equivalent, so the same server is expressed as -c overrides layered over
// ~/.codex/config.toml for this invocation only. The asymmetry is real: a Codex
// agent also keeps the user's globally configured servers.
func LaunchArgv(a *Agent, p *Project) ([]string, error) {
	switch a.Type {
	case "claude":
		cfg, err := WriteMCPConfig(a, p)
		if err != nil {
			return nil, err
		}
		return []string{"claude", "--mcp-config", cfg, "--strict-mcp-config"}, nil
	case "codex":
		overrides, err := CodexOverrides(a, p)
		if err != nil {
			return nil, err
		}
		return append([]string{"codex", "-C", a.Worktree}, overrides...), nil
	default:
		return nil, fmt.Errorf("unknown agent type %q", a.Type)
	}
}

// Exec replaces this process with the coding agent.
//
// Replacing rather than forking is what keeps the recorded PID meaningful: exec
// preserves both the process id and its start time, so the pid/start-time pair
// written to state before this call continues to identify the running agent,
// and the lease is released the moment the user quits it. A forked child would
// leave this process as a pointless parent and break that identity.
func Exec(worktree string, argv []string) error {
	bin, err := exec.LookPath(argv[0])
	if err != nil {
		return fmt.Errorf("%s is not installed or not on PATH", argv[0])
	}
	if err := os.Chdir(worktree); err != nil {
		return err
	}
	// Strip ambient XCODEBUILDMCP_* rather than passing them through. The MCP
	// config's env block already wins on collision, so this is belt and braces
	// — but it also keeps `xcodebuild` invocations the agent runs directly in
	// its shell from picking up someone else's simulator.
	env := make([]string, 0, len(os.Environ()))
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "XCODEBUILDMCP_") {
			continue
		}
		env = append(env, kv)
	}
	return syscall.Exec(bin, argv, env)
}
