package main

import (
	"flag"
	"fmt"
	"os"
	"text/tabwriter"
	"time"
)

func nowUTC() time.Time { return time.Now().UTC() }

func cmdList(args []string) error {
	fs := flag.NewFlagSet("list", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	s, err := ReadState()
	if err != nil {
		return err
	}
	agents := s.SortedAgents()
	if len(agents) == 0 {
		fmt.Println("no agents")
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "AGENT\tTYPE\tBRANCH/NOTE\tTARGET\tSTATUS")
	for _, a := range agents {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", a.ID, a.Type, a.Branch, a.Target.Name, a.Status())
	}
	return w.Flush()
}

func cmdSimulators(args []string) error {
	fs := flag.NewFlagSet("simulators", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	s, err := ReadState()
	if err != nil {
		return err
	}
	sims, err := ListSimulators()
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tRUNTIME\tSTATE\tUDID\tLEASE")
	for _, sim := range sims {
		lease := "free"
		if h := s.HolderOfUDID(sim.UDID); h != nil {
			lease = h.ID
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", sim.Name, sim.RuntimeDisplayName, sim.State, sim.UDID, lease)
	}
	return w.Flush()
}

func cmdKill(args []string) error {
	fs := flag.NewFlagSet("kill", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("usage: agent kill <agent-id>")
	}
	id := fs.Arg(0)
	return WithState(func(s *State) error {
		a, ok := s.Agents[id]
		if !ok {
			return fmt.Errorf("no such agent %q", id)
		}
		// Only the lease and the record go away here. DerivedData and any
		// worktree are left alone; removing user work is `agent cleanup`'s job
		// and is guarded there.
		delete(s.Agents, id)
		fmt.Printf("released %s (%s %s)\n", a.ID, a.Target.Kind, a.Target.Name)
		if a.DerivedData != "" {
			fmt.Printf("  DerivedData left in place: %s\n", a.DerivedData)
		}
		if a.Worktree != "" {
			fmt.Printf("  worktree left in place:    %s\n", a.Worktree)
		}
		return nil
	})
}
