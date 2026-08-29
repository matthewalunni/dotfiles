package main

import (
	"flag"
	"fmt"
	"os"
	"text/tabwriter"
)

// agentTypeHold marks a lease taken by a person rather than a coding agent —
// "I am about to use this phone from Xcode, keep agents off it". It reuses the
// agent record wholesale rather than introducing a second kind of lease: a hold
// has no pid, so it reads as "registered" and is held until explicitly
// released, which is exactly the desired behaviour.
const agentTypeHold = "hold"

func cmdDevices(args []string) error {
	fs := flag.NewFlagSet("devices", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	s, err := ReadState()
	if err != nil {
		return err
	}
	devices, err := ListDevices()
	if err != nil {
		return err
	}
	if len(devices) == 0 {
		fmt.Println("no paired iOS devices")
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tMODEL\tOS\tCONNECTION\tUDID\tLEASE")
	for _, d := range devices {
		conn := d.Transport
		if !d.Connected {
			conn = "disconnected"
		}
		lease := "free"
		if h := s.HolderOfUDID(d.UDID); h != nil {
			lease = h.ID
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n", d.Name, d.Model, d.OSVersion, conn, d.UDID, lease)
	}
	return w.Flush()
}

func cmdDevice(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: agent device <status|claim|release> [flags]")
	}
	switch args[0] {
	case "status":
		return cmdDevices(args[1:])
	case "claim":
		return cmdDeviceClaim(args[1:])
	case "release":
		return cmdDeviceRelease(args[1:])
	default:
		return fmt.Errorf("unknown device subcommand %q (want status, claim or release)", args[0])
	}
}

// cmdDeviceClaim takes the device lease for manual use, so that a spawn cannot
// grab the phone out from under someone already testing on it.
func cmdDeviceClaim(args []string) error {
	fs := flag.NewFlagSet("device claim", flag.ContinueOnError)
	deviceSel := fs.String("device-id", "", "claim a specific device")
	note := fs.String("note", "", "why the device is being held")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var held *Agent
	err := WithState(func(s *State) error {
		target, err := leaseDevice(s, *deviceSel)
		if err != nil {
			return err
		}
		id := s.NextAgentID(agentTypeHold)
		a := &Agent{
			ID:        id,
			Type:      agentTypeHold,
			Branch:    *note,
			Target:    target,
			CreatedAt: nowUTC(),
			UpdatedAt: nowUTC(),
		}
		s.Agents[id] = a
		held = a
		return nil
	})
	if err != nil {
		return err
	}
	fmt.Printf("%s holds %s (%s)\n", held.ID, held.Target.Name, held.Target.UDID)
	fmt.Printf("Release with: agent device release\n")
	return nil
}

// cmdDeviceRelease drops a device lease.
//
// A lease held by a live agent is refused without --force. Silently taking the
// device from a running agent would let its next install go to a phone it no
// longer owns, so the collision is surfaced instead of resolved.
func cmdDeviceRelease(args []string) error {
	fs := flag.NewFlagSet("device release", flag.ContinueOnError)
	deviceSel := fs.String("device-id", "", "release a specific device")
	force := fs.Bool("force", false, "release even if a running agent holds it")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var released, releasedWorktree string
	err := WithState(func(s *State) error {
		devices, err := ListDevices()
		if err != nil {
			return err
		}
		var d Device
		if *deviceSel != "" {
			d, err = FindDevice(devices, *deviceSel)
		} else {
			d, err = SoleDevice(devices)
		}
		if err != nil {
			return err
		}
		holder := s.HolderOfUDID(d.UDID)
		if holder == nil {
			return fmt.Errorf("%s is not leased", d.Name)
		}
		if holder.Status() == StatusRunning && !*force {
			return fmt.Errorf("%s is held by %s, which is still running.\n"+
				"  Quit that agent, or rerun with --force to take the device from it.",
				d.Name, holder.ID)
		}
		delete(s.Agents, holder.ID)
		released, releasedWorktree = holder.ID, holder.Worktree
		return nil
	})
	if err != nil {
		return err
	}
	fmt.Printf("released the device lease held by %s\n", released)
	if releasedWorktree != "" {
		fmt.Printf("Its worktree and branch were left untouched: %s\n", releasedWorktree)
	}
	return nil
}
