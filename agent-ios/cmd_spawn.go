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
	base := fs.String("base", "", "branch to create a new branch from (default: repo default branch)")
	simSel := fs.String("sim", "", "lease a specific simulator by UDID")
	useDevice := fs.Bool("device", false, "target the connected physical device instead of a simulator")
	deviceSel := fs.String("device-id", "", "target a specific physical device (implies --device)")
	bundleID := fs.String("bundle-id", "", "app bundle identifier (lets launch/stop tools work without a lookup)")
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

	var created *Agent
	var project Project
	err = WithState(func(s *State) error {
		p, err := ResolveProject(s, cwd)
		if err != nil {
			return err
		}
		if *scheme != "" {
			p.Scheme = *scheme
		}

		if *simSel != "" && (*useDevice || *deviceSel != "") {
			return fmt.Errorf("--sim and --device are mutually exclusive")
		}
		var target Target
		if *useDevice || *deviceSel != "" {
			target, err = leaseDevice(s, *deviceSel)
		} else {
			target, err = leaseSimulator(s, *simSel, *createSim)
		}
		if err != nil {
			return err
		}

		id := s.NextAgentID(agentType)
		// Worktree creation runs while the lock is held so that a second spawn
		// cannot pick the same simulator in the seconds this takes.
		worktree, err := CreateWorktree(p.Root, id, branch, *base)
		if err != nil {
			return err
		}
		if err := checkNoProjectConfig(worktree); err != nil {
			return err
		}

		a := &Agent{
			ID:          id,
			Type:        agentType,
			Project:     p.Name,
			RepoRoot:    p.Root,
			Branch:      branch,
			Worktree:    worktree,
			DerivedData: DerivedDataPath(p.Name, id),
			Target:      target,
			CreatedAt:   nowUTC(),
			UpdatedAt:   nowUTC(),
		}
		if !*noLaunch {
			// Recorded before the exec that turns this process into the agent.
			// exec preserves the pid and the start time, so this pair keeps
			// identifying the right process for as long as the agent runs.
			a.PID = os.Getpid()
			if st, err := processStart(a.PID); err == nil {
				a.PIDStart = st
			}
		}
		a.BundleID = *bundleID
		if err := os.MkdirAll(a.DerivedData, 0o755); err != nil {
			return err
		}
		s.Agents[id] = a
		created, project = a, *p
		return nil
	})
	if err != nil {
		return err
	}

	fmt.Printf("%s\n", created.ID)
	fmt.Printf("  branch:        %s\n", created.Branch)
	fmt.Printf("  worktree:      %s\n", created.Worktree)
	fmt.Printf("  project:       %s (scheme %s)\n", created.Project, project.Scheme)
	label := "simulator"
	if created.Target.Kind == TargetDevice {
		label = "device"
	}
	fmt.Printf("  %-14s %s\n", label+":", created.Target.Name)
	fmt.Printf("  %-14s %s\n", label+" id:", created.Target.UDID)
	fmt.Printf("  derived data:  %s\n", created.DerivedData)

	if *noLaunch {
		fmt.Printf("\nRegistered without launching. Release with: agent kill %s\n", created.ID)
		return nil
	}

	argv, err := LaunchArgv(created, &project)
	if err != nil {
		return releaseOnFailure(created.ID, err)
	}
	if created.Target.Kind == TargetSimulator {
		if err := BootSimulator(created.Target.UDID); err != nil {
			return releaseOnFailure(created.ID, err)
		}
	}
	fmt.Printf("\nLaunching %s in %s\n\n", created.Type, created.Worktree)
	// Only returns on failure; on success this process becomes the agent.
	return releaseOnFailure(created.ID, Exec(created.Worktree, argv))
}

// releaseOnFailure drops the agent record so a failed launch does not strand
// its simulator lease. The worktree is deliberately left in place: it may
// already hold copied secrets, and removing a git worktree is never something
// this tool does on its own initiative.
func releaseOnFailure(id string, cause error) error {
	if cause == nil {
		return nil
	}
	if err := WithState(func(s *State) error {
		delete(s.Agents, id)
		return nil
	}); err != nil {
		return fmt.Errorf("%w (and releasing the lease failed: %v)", cause, err)
	}
	return cause
}

// leaseDevice takes the exclusive lease on a physical device.
//
// A device is a single shared piece of hardware, so a second agent is refused
// by name rather than quietly taking it: two agents installing over each other
// on the same phone is silent, confusing, and destroys the first agent's build.
// Keying the lease on UDID means this already generalises to several devices.
func leaseDevice(s *State, want string) (Target, error) {
	devices, err := ListDevices()
	if err != nil {
		return Target{}, err
	}
	var d Device
	if want != "" {
		d, err = FindDevice(devices, want)
	} else {
		d, err = SoleDevice(devices)
	}
	if err != nil {
		return Target{}, err
	}
	if !d.Connected {
		return Target{}, fmt.Errorf("device %s (%s) is not connected", d.Name, d.UDID)
	}
	if holder := s.HolderOfUDID(d.UDID); holder != nil {
		return Target{}, fmt.Errorf("physical device currently leased by %s.\n"+
			"  Release it with: agent kill %s   (or: agent device release --force)",
			holder.ID, holder.ID)
	}
	return Target{Kind: TargetDevice, UDID: d.UDID, Name: d.Name}, nil
}

// leaseSimulator picks a simulator not held by a live agent. It never takes one
// that is already leased, and it does not invent a simulator unless asked.
func leaseSimulator(s *State, wantUDID string, allowCreate bool) (Target, error) {
	sims, err := ListSimulators()
	if err != nil {
		return Target{}, err
	}

	if wantUDID != "" {
		for _, sim := range sims {
			if sim.UDID != wantUDID {
				continue
			}
			if holder := s.HolderOfUDID(sim.UDID); holder != nil {
				return Target{}, fmt.Errorf("simulator %s (%s) is leased by %s",
					sim.Name, sim.UDID, holder.ID)
			}
			return simTarget(sim), nil
		}
		return Target{}, fmt.Errorf("no available simulator with UDID %s", wantUDID)
	}

	for _, sim := range sims {
		if s.HolderOfUDID(sim.UDID) == nil {
			return simTarget(sim), nil
		}
	}

	if !allowCreate {
		var held []string
		for _, sim := range sims {
			if h := s.HolderOfUDID(sim.UDID); h != nil {
				held = append(held, fmt.Sprintf("    %-24s %s  held by %s", sim.Name, sim.UDID, h.ID))
			}
		}
		return Target{}, fmt.Errorf("every simulator is leased:\n%s\n  rerun with --create-sim to add one",
			strings.Join(held, "\n"))
	}
	sim, err := createPoolSimulator(sims)
	if err != nil {
		return Target{}, err
	}
	return simTarget(sim), nil
}

func simTarget(s Simulator) Target {
	return Target{Kind: TargetSimulator, UDID: s.UDID, Name: s.Name}
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
