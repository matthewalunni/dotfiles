package main

import (
	"fmt"
	"os"
	"strings"
)

// cmdConfig prints the exact launch command and MCP wiring for an agent.
//
// Without this the configuration is invisible: it lives in a generated file and
// a process environment, and "which simulator is this agent actually pointed
// at" is the first question worth asking when a build lands somewhere
// surprising. Read-only apart from regenerating the agent's own config file.
func cmdConfig(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: agent config <agent-id>")
	}
	id := args[0]

	s, err := ReadState()
	if err != nil {
		return err
	}
	a, ok := s.Agents[id]
	if !ok {
		return fmt.Errorf("no agent %q (see: agent list)", id)
	}
	p, ok := s.Projects[a.Project]
	if !ok {
		return fmt.Errorf("no cached project %q for agent %s", a.Project, id)
	}

	argv, err := LaunchArgv(a, p)
	if err != nil {
		return err
	}

	fmt.Printf("%s (%s)\n\n", a.ID, a.Status())
	fmt.Printf("cwd: %s\n\n", a.Worktree)
	fmt.Println("command:")
	fmt.Printf("  %s\n\n", strings.Join(argv, " \\\n    "))

	env, err := xcodeBuildEnv(a, p)
	if err != nil {
		return err
	}
	fmt.Println("session defaults:")
	for _, k := range sortedEnvKeys(env) {
		fmt.Printf("  %-32s %s\n", k, env[k])
	}

	if a.Type == "claude" {
		fmt.Printf("\nconfig file: %s\n", MCPConfigPath(a.ID))
		if b, err := os.ReadFile(MCPConfigPath(a.ID)); err == nil {
			fmt.Printf("\n%s", b)
		}
	}
	return nil
}
