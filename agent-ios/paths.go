package main

import (
	"os"
	"path/filepath"
)

// Root is the single directory holding all cross-agent state. Everything the
// tool owns lives under here so that "delete this directory" is a complete,
// safe reset that never touches a git repo or a simulator.
func Root() string {
	if v := os.Getenv("AGENT_IOS_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		// A machine with no home directory is not a machine we can run on.
		panic("cannot determine home directory: " + err.Error())
	}
	return filepath.Join(home, ".agent-ios")
}

func StatePath() string { return filepath.Join(Root(), "state.json") }

// LockPath guards every read-modify-write of state.json. It is a separate file
// from state.json so that the lock survives the atomic rename used to save.
func LockPath() string { return filepath.Join(Root(), "state.lock") }

func LogsDir() string { return filepath.Join(Root(), "logs") }

// DerivedDataPath is the per-agent DerivedData directory. Keyed by project
// first so that "clean up everything for RepVault" is one directory removal.
func DerivedDataPath(project, agentID string) string {
	return filepath.Join(Root(), "derived-data", project, agentID)
}

func EnsureRoot() error {
	for _, d := range []string{Root(), LogsDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	return nil
}

// AgentDir holds per-agent generated files (currently the MCP config). It is
// regenerated on every spawn, so nothing here is precious.
func AgentDir(agentID string) string { return filepath.Join(Root(), "agents", agentID) }

// MCPConfigPath is the --mcp-config file handed to Claude Code.
func MCPConfigPath(agentID string) string { return filepath.Join(AgentDir(agentID), "mcp.json") }
