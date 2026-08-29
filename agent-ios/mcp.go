package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Per-agent XcodeBuildMCP configuration.
//
// Three behaviours were verified against Claude Code and xcodebuildmcp@2.7.0
// on this machine rather than assumed, because each one silently breaks
// isolation if it goes the other way:
//
//  1. A stdio MCP server inherits the launching process's whole environment.
//     So an XCODEBUILDMCP_* exported in the user's login shell does reach the
//     server, and cannot be ignored.
//  2. The config file's "env" block is merged over that inherited environment
//     and wins on collision. This is why every value the agent depends on is
//     written explicitly below: it makes the agent's own settings authoritative
//     regardless of what the ambient environment happens to hold.
//  3. XcodeBuildMCP resolves session defaults as {...env, ...projectFile,
//     ...runtimeOverride} — a project config file beats our environment. See
//     checkNoProjectConfig.
//
// simulatorName is deliberately never set. XcodeBuildMCP re-resolves a name to
// a UDID on a background refresh, and simulator names are not unique here, so a
// name-carrying config can silently retarget itself onto another agent's device.
const mcpServerName = "xcodebuild"

// npx is left unresolved on purpose. The MCP child gets a sanitised PATH that
// finds the system node (/usr/local/bin), not the nvm shim that the login shell
// resolves to first, and the nvm shim prints banner noise onto stdio.
//
// The "mcp" subcommand is required: invoked bare, the package prints its CLI
// usage to stdout and exits, which an MCP client sees only as a server that
// failed to handshake.
//
// The major version is pinned but the minor is not. Tracking @latest would put
// a network fetch in front of every server start and let a rename of any
// XCODEBUILDMCP_* variable break isolation silently; pinning exactly would mean
// hand-updating for every patch. agent doctor closes the remaining gap by
// asking the server what defaults it actually resolved.
var mcpCommand = []string{"npx", "-y", "xcodebuildmcp@2", "mcp"}

type mcpServer struct {
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
}

type mcpConfig struct {
	MCPServers map[string]mcpServer `json:"mcpServers"`
}

// xcodeBuildEnv is the full set of session defaults pinning this agent to its
// own simulator, its own DerivedData, and its own copy of the project.
func xcodeBuildEnv(a *Agent, p *Project) (map[string]string, error) {
	env := map[string]string{
		"XCODEBUILDMCP_SCHEME":            p.Scheme,
		"XCODEBUILDMCP_DERIVED_DATA_PATH": a.DerivedData,
	}

	// The container must point at the agent's worktree, not the main checkout.
	// Building the main tree's project from a worktree agent would defeat the
	// entire point of the isolation.
	container := p.ProjectPath
	key := "XCODEBUILDMCP_PROJECT_PATH"
	if p.WorkspacePath != "" {
		container, key = p.WorkspacePath, "XCODEBUILDMCP_WORKSPACE_PATH"
	}
	inWorktree, err := rebase(container, a.RepoRoot, a.Worktree)
	if err != nil {
		return nil, err
	}
	env[key] = inWorktree

	switch a.Target.Kind {
	case TargetSimulator:
		env["XCODEBUILDMCP_SIMULATOR_ID"] = a.Target.UDID
	case TargetDevice:
		env["XCODEBUILDMCP_DEVICE_ID"] = a.Target.UDID
	default:
		return nil, fmt.Errorf("agent %s has no target", a.ID)
	}
	return env, nil
}

// rebase re-roots a path that lives under oldRoot onto newRoot.
func rebase(path, oldRoot, newRoot string) (string, error) {
	rel, err := filepath.Rel(oldRoot, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("%s is not inside %s", path, oldRoot)
	}
	return filepath.Join(newRoot, rel), nil
}

// checkNoProjectConfig refuses to launch into a worktree carrying a committed
// .xcodebuildmcp/config.yaml. XcodeBuildMCP gives that file precedence over the
// environment, so it would override the agent's simulator and DerivedData
// without any visible error — every agent would quietly share one target. This
// is a hard failure rather than a warning precisely because the symptom is
// invisible.
func checkNoProjectConfig(worktree string) error {
	for _, name := range []string{"config.yaml", "config.yml"} {
		p := filepath.Join(worktree, ".xcodebuildmcp", name)
		if _, err := os.Stat(p); err == nil {
			return fmt.Errorf(
				"%s takes precedence over per-agent settings and would override this agent's\n"+
					"simulator and DerivedData. Remove or rename it before spawning agents.", p)
		}
	}
	return nil
}

// WriteMCPConfig writes the Claude Code --mcp-config file and returns its path.
func WriteMCPConfig(a *Agent, p *Project) (string, error) {
	env, err := xcodeBuildEnv(a, p)
	if err != nil {
		return "", err
	}
	cfg := mcpConfig{MCPServers: map[string]mcpServer{
		mcpServerName: {Command: mcpCommand[0], Args: mcpCommand[1:], Env: env},
	}}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", err
	}
	dir := AgentDir(a.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := MCPConfigPath(a.ID)
	return path, os.WriteFile(path, append(b, '\n'), 0o644)
}

// CodexOverrides expresses the same server as repeated -c flags, since Codex
// has no equivalent of --mcp-config. Values are TOML, so strings are quoted.
func CodexOverrides(a *Agent, p *Project) ([]string, error) {
	env, err := xcodeBuildEnv(a, p)
	if err != nil {
		return nil, err
	}
	quoted := make([]string, 0, len(mcpCommand)-1)
	for _, arg := range mcpCommand[1:] {
		quoted = append(quoted, tomlString(arg))
	}
	out := []string{
		"-c", fmt.Sprintf("mcp_servers.%s.command=%s", mcpServerName, tomlString(mcpCommand[0])),
		"-c", fmt.Sprintf("mcp_servers.%s.args=[%s]", mcpServerName, strings.Join(quoted, ",")),
	}
	for _, k := range sortedEnvKeys(env) {
		out = append(out, "-c",
			fmt.Sprintf("mcp_servers.%s.env.%s=%s", mcpServerName, k, tomlString(env[k])))
	}
	return out, nil
}

func sortedEnvKeys(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func tomlString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}
