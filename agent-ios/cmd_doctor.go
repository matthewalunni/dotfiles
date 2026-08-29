package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// cmdDoctor is strictly read-only: it reports drift and never repairs it, so it
// is always safe to run against a working set of agents.
func cmdDoctor(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}

	fmt.Println("environment")
	reportTool("xcodebuild", "xcodebuild", "-version")
	reportTool("git", "git", "--version")
	reportTool("claude", "claude", "--version")
	reportTool("codex", "codex", "--version")

	runtimes, err := ListRuntimes()
	if err != nil {
		fmt.Printf("  %-12s error: %v\n", "runtimes", err)
	} else {
		names := make([]string, 0, len(runtimes))
		for _, r := range runtimes {
			names = append(names, r.Name)
		}
		fmt.Printf("  %-12s %s\n", "runtimes", strings.Join(names, ", "))
	}

	sims, err := ListSimulators()
	if err != nil {
		return err
	}
	fmt.Printf("  %-12s %d available\n", "simulators", len(sims))

	// Device discovery is reported rather than fatal: a Mac with no phone
	// attached is a perfectly normal state for simulator-only work.
	devices, devErr := ListDevices()
	switch {
	case devErr != nil:
		fmt.Printf("  %-12s error: %v\n", "devices", devErr)
	case len(devices) == 0:
		fmt.Printf("  %-12s none paired\n", "devices")
	default:
		for _, d := range devices {
			state := d.Transport
			if !d.Connected {
				state = "disconnected"
			}
			fmt.Printf("  %-12s %s (%s, iOS %s, %s)\n", "device", d.Name, d.Model, d.OSVersion, state)
		}
	}
	fmt.Printf("  %-12s %s\n", "state", StatePath())

	s, err := ReadState()
	if err != nil {
		return err
	}

	fmt.Println("\nstate")
	known := map[string]bool{}
	for _, sim := range sims {
		known[sim.UDID] = true
	}
	connected := map[string]bool{}
	for _, d := range devices {
		connected[d.UDID] = d.Connected
	}
	issues := 0
	for _, a := range s.SortedAgents() {
		switch {
		case a.Status() == StatusStale:
			issues++
			fmt.Printf("  stale     %s: pid %d is gone; lease on %s is reclaimable\n",
				a.ID, a.PID, a.Target.Name)
		case a.Target.Kind == TargetSimulator && !known[a.Target.UDID]:
			issues++
			fmt.Printf("  missing   %s: simulator %s (%s) no longer exists\n",
				a.ID, a.Target.Name, a.Target.UDID)
		case a.Target.Kind == TargetDevice && devErr == nil && !connected[a.Target.UDID]:
			// The lease is kept: the phone is usually just asleep or off the
			// network, and dropping the lease would let another agent take a
			// device the first one is still working against.
			issues++
			fmt.Printf("  offline   %s: device %s is not connected; the lease is still held\n",
				a.ID, a.Target.Name)
		default:
			fmt.Printf("  ok        %s: %s on %s\n", a.ID, a.Status(), a.Target.Name)
		}
		if a.DerivedData != "" {
			if _, err := os.Stat(a.DerivedData); err != nil {
				issues++
				fmt.Printf("  missing   %s: DerivedData %s is gone\n", a.ID, a.DerivedData)
			}
		}
	}
	if len(s.Agents) == 0 {
		fmt.Println("  no agents")
	}
	if issues > 0 {
		fmt.Printf("\n%d issue(s). Nothing was changed; run 'agent kill <id>' to release a stale lease.\n", issues)
	}
	return nil
}

func reportTool(label string, name string, args ...string) {
	path, err := exec.LookPath(name)
	if err != nil {
		fmt.Printf("  %-12s not found\n", label)
		return
	}
	out, err := exec.Command(name, args...).Output()
	version := "installed"
	if err == nil {
		if line := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]; line != "" {
			version = line
		}
	}
	fmt.Printf("  %-12s %s (%s)\n", label, version, path)
}
