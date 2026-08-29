package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

var validAgentTypes = map[string]bool{"claude": true, "codex": true}

func cmdSpawn(args []string) error {
	fs := flag.NewFlagSet("spawn", flag.ContinueOnError)
	scheme := fs.String("scheme", "", "override the auto-detected Xcode scheme")
	simSel := fs.String("sim", "", "lease a specific simulator by UDID")
	createSim := fs.Bool("create-sim", false, "create a new simulator if none are free")
	noLaunch := fs.Bool("no-launch", false, "register and lease without launching the agent")
	if err := fs.Parse(args); err != nil {
		return err
	}
	// flag stops at the first positional, so take the two positionals and parse
	// again over what follows. This accepts flags on either side of the branch.
	rest := fs.Args()
	if len(rest) < 2 {
		return fmt.Errorf("usage: agent spawn <claude|codex> <branch> [flags]")
	}
	agentType, branch := rest[0], rest[1]
	if err := fs.Parse(rest[2:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if !validAgentTypes[agentType] {
		return fmt.Errorf("unknown agent type %q (want claude or codex)", agentType)
	}

	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	// Phase 1 stops after leasing; worktree creation and agent launch land in
	// phase 2. Refuse rather than silently doing less than the flag implies.
	if !*noLaunch {
		return fmt.Errorf("launching is not implemented yet; rerun with --no-launch")
	}

	var created *Agent
	var createdScheme string
	err = WithState(func(s *State) error {
		project, err := ResolveProject(s, cwd)
		if err != nil {
			return err
		}
		if *scheme != "" {
			project.Scheme = *scheme
		}

		sim, err := leaseSimulator(s, *simSel, *createSim)
		if err != nil {
			return err
		}

		id := s.NextAgentID(agentType)
		a := &Agent{
			ID:          id,
			Type:        agentType,
			Project:     project.Name,
			RepoRoot:    project.Root,
			Branch:      branch,
			DerivedData: DerivedDataPath(project.Name, id),
			Target:      Target{Kind: TargetSimulator, UDID: sim.UDID, Name: sim.Name},
			CreatedAt:   nowUTC(),
			UpdatedAt:   nowUTC(),
		}
		if err := os.MkdirAll(a.DerivedData, 0o755); err != nil {
			return err
		}
		s.Agents[id] = a
		created, createdScheme = a, project.Scheme
		return nil
	})
	if err != nil {
		return err
	}

	fmt.Printf("%s\n", created.ID)
	fmt.Printf("  branch:       %s\n", created.Branch)
	fmt.Printf("  project:      %s (scheme %s)\n", created.Project, createdScheme)
	fmt.Printf("  simulator:    %s\n", created.Target.Name)
	fmt.Printf("  simulatorUDID:%s\n", " "+created.Target.UDID)
	fmt.Printf("  derivedData:  %s\n", created.DerivedData)
	return nil
}

// leaseSimulator picks a simulator not held by a live agent. It never takes one
// that is already leased, and it does not invent a simulator unless asked.
func leaseSimulator(s *State, wantUDID string, allowCreate bool) (Simulator, error) {
	sims, err := ListSimulators()
	if err != nil {
		return Simulator{}, err
	}

	if wantUDID != "" {
		for _, sim := range sims {
			if sim.UDID != wantUDID {
				continue
			}
			if holder := s.HolderOfUDID(sim.UDID); holder != nil {
				return Simulator{}, fmt.Errorf("simulator %s (%s) is leased by %s",
					sim.Name, sim.UDID, holder.ID)
			}
			return sim, nil
		}
		return Simulator{}, fmt.Errorf("no available simulator with UDID %s", wantUDID)
	}

	for _, sim := range sims {
		if s.HolderOfUDID(sim.UDID) == nil {
			return sim, nil
		}
	}

	if !allowCreate {
		var held []string
		for _, sim := range sims {
			if h := s.HolderOfUDID(sim.UDID); h != nil {
				held = append(held, fmt.Sprintf("    %-24s %s  held by %s", sim.Name, sim.UDID, h.ID))
			}
		}
		return Simulator{}, fmt.Errorf("every simulator is leased:\n%s\n  rerun with --create-sim to add one",
			strings.Join(held, "\n"))
	}
	return createPoolSimulator(sims)
}

// createPoolSimulator adds an Agent-N simulator on the newest installed runtime
// and iPhone device type, so nothing is hardcoded to a model this Mac lacks.
func createPoolSimulator(existing []Simulator) (Simulator, error) {
	dt, err := NewestIPhoneDeviceType()
	if err != nil {
		return Simulator{}, err
	}
	runtimes, err := ListRuntimes()
	if err != nil {
		return Simulator{}, err
	}
	if len(runtimes) == 0 {
		return Simulator{}, fmt.Errorf("no iOS simulator runtimes installed")
	}
	rt := runtimes[0]

	taken := map[string]bool{}
	for _, s := range existing {
		taken[s.Name] = true
	}
	name := ""
	for n := 1; ; n++ {
		candidate := fmt.Sprintf("Agent-%d", n)
		if !taken[candidate] {
			name = candidate
			break
		}
	}

	udid, err := CreateSimulator(name, dt.Identifier, rt.Identifier)
	if err != nil {
		return Simulator{}, err
	}
	fmt.Fprintf(os.Stderr, "created simulator %s (%s, %s)\n", name, dt.Name, rt.Name)
	return Simulator{
		UDID:               udid,
		Name:               name,
		State:              "Shutdown",
		IsAvailable:        true,
		DeviceTypeID:       dt.Identifier,
		RuntimeID:          rt.Identifier,
		RuntimeDisplayName: rt.Name,
	}, nil
}
