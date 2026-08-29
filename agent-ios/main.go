package main

import (
	"fmt"
	"os"
)

const usage = `agent - isolated iOS development environments for parallel coding agents

Usage:
  agent spawn <claude|codex> <branch> [flags]   Lease a target and register an agent
  agent list                                    Show active agents
  agent simulators                              Show simulators and who holds them
  agent kill <agent-id>                         Release an agent's leases
  agent doctor                                  Report environment and state drift

Spawn flags:
  --scheme <name>   Override the auto-detected Xcode scheme
  --sim <udid>      Lease a specific simulator instead of the first free one
  --create-sim      Create a new Agent-N simulator if none are free
  --no-launch       Register and lease without starting the coding agent

Run 'agent <command> --help' for details.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "spawn":
		err = cmdSpawn(os.Args[2:])
	case "list":
		err = cmdList(os.Args[2:])
	case "simulators", "sims":
		err = cmdSimulators(os.Args[2:])
	case "kill":
		err = cmdKill(os.Args[2:])
	case "doctor":
		err = cmdDoctor(os.Args[2:])
	case "help", "-h", "--help":
		fmt.Print(usage)
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}
