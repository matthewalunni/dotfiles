package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

type Simulator struct {
	UDID               string `json:"udid"`
	Name               string `json:"name"`
	State              string `json:"state"`
	IsAvailable        bool   `json:"isAvailable"`
	DeviceTypeID       string `json:"deviceTypeIdentifier"`
	RuntimeID          string `json:"-"`
	RuntimeDisplayName string `json:"-"`
}

func (s Simulator) Booted() bool { return s.State == "Booted" }

type Runtime struct {
	Identifier  string `json:"identifier"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	IsAvailable bool   `json:"isAvailable"`
	Platform    string `json:"platform"`
}

type DeviceType struct {
	Identifier string `json:"identifier"`
	Name       string `json:"name"`
}

func simctlJSON(v any, args ...string) error {
	full := append([]string{"simctl"}, args...)
	full = append(full, "--json")
	out, err := exec.Command("xcrun", full...).Output()
	if err != nil {
		return fmt.Errorf("xcrun %s: %w", strings.Join(full, " "), err)
	}
	return json.Unmarshal(out, v)
}

// ListSimulators returns every available iOS simulator, newest runtime first.
func ListSimulators() ([]Simulator, error) {
	var payload struct {
		Devices map[string][]Simulator `json:"devices"`
	}
	if err := simctlJSON(&payload, "list", "devices"); err != nil {
		return nil, err
	}
	runtimes, err := ListRuntimes()
	if err != nil {
		return nil, err
	}
	byID := map[string]Runtime{}
	for _, r := range runtimes {
		byID[r.Identifier] = r
	}

	var out []Simulator
	for runtimeID, sims := range payload.Devices {
		rt := byID[runtimeID]
		// Only iOS: watchOS/tvOS/visionOS simulators are not build targets here.
		if !strings.Contains(runtimeID, "SimRuntime.iOS-") {
			continue
		}
		for _, s := range sims {
			if !s.IsAvailable {
				continue
			}
			s.RuntimeID = runtimeID
			s.RuntimeDisplayName = rt.Name
			if s.RuntimeDisplayName == "" {
				s.RuntimeDisplayName = runtimeID
			}
			out = append(out, s)
		}
	}
	// Lease order: iPhones before iPads (these are iPhone apps), then newest
	// runtime, then name for stability.
	sort.Slice(out, func(i, j int) bool {
		ai, aj := isIPhone(out[i]), isIPhone(out[j])
		if ai != aj {
			return ai
		}
		if out[i].RuntimeID != out[j].RuntimeID {
			return out[i].RuntimeID > out[j].RuntimeID
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func ListRuntimes() ([]Runtime, error) {
	var payload struct {
		Runtimes []Runtime `json:"runtimes"`
	}
	if err := simctlJSON(&payload, "list", "runtimes"); err != nil {
		return nil, err
	}
	var out []Runtime
	for _, r := range payload.Runtimes {
		if r.IsAvailable && strings.Contains(r.Identifier, "SimRuntime.iOS-") {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return compareVersions(out[i].Version, out[j].Version) > 0
	})
	return out, nil
}

func ListDeviceTypes() ([]DeviceType, error) {
	var payload struct {
		DeviceTypes []DeviceType `json:"devicetypes"`
	}
	if err := simctlJSON(&payload, "list", "devicetypes"); err != nil {
		return nil, err
	}
	return payload.DeviceTypes, nil
}

// NewestIPhoneDeviceType picks the highest-numbered iPhone device type Xcode
// knows about, so nothing hardcodes a model that may not exist on this Mac.
func NewestIPhoneDeviceType() (DeviceType, error) {
	types, err := ListDeviceTypes()
	if err != nil {
		return DeviceType{}, err
	}
	var best DeviceType
	bestScore := -1
	for _, t := range types {
		if !strings.HasPrefix(t.Name, "iPhone") {
			continue
		}
		score := iPhoneModelScore(t.Name)
		if score > bestScore {
			best, bestScore = t, score
		}
	}
	if bestScore < 0 {
		return DeviceType{}, fmt.Errorf("no iPhone simulator device types installed")
	}
	return best, nil
}

// iPhoneModelScore ranks iPhone device-type names so "iPhone 17 Pro Max" beats
// "iPhone 16" and "iPhone SE". Generation dominates; trim breaks ties.
func iPhoneModelScore(name string) int {
	fields := strings.Fields(name)
	gen := 0
	for _, f := range fields {
		if n, err := strconv.Atoi(f); err == nil && n > gen {
			gen = n
		}
	}
	trim := 0
	switch {
	case strings.Contains(name, "Pro Max"):
		trim = 3
	case strings.Contains(name, "Pro"):
		trim = 2
	case strings.Contains(name, "Plus"), strings.Contains(name, "Max"):
		trim = 1
	}
	return gen*10 + trim
}

func compareVersions(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) || i < len(bs); i++ {
		av, bv := 0, 0
		if i < len(as) {
			av, _ = strconv.Atoi(as[i])
		}
		if i < len(bs) {
			bv, _ = strconv.Atoi(bs[i])
		}
		if av != bv {
			if av > bv {
				return 1
			}
			return -1
		}
	}
	return 0
}

// CreateSimulator creates a named simulator and returns its UDID.
func CreateSimulator(name, deviceTypeID, runtimeID string) (string, error) {
	out, err := exec.Command("xcrun", "simctl", "create", name, deviceTypeID, runtimeID).Output()
	if err != nil {
		return "", fmt.Errorf("simctl create %q: %w", name, err)
	}
	return strings.TrimSpace(string(out)), nil
}

// BootSimulator boots a simulator by UDID, treating "already booted" as success
// so that spawning is idempotent.
func BootSimulator(udid string) error {
	out, err := exec.Command("xcrun", "simctl", "boot", udid).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "Unable to boot device in current state: Booted") {
			return nil
		}
		return fmt.Errorf("simctl boot %s: %s", udid, strings.TrimSpace(string(out)))
	}
	return nil
}

// isIPhone reports whether a simulator is an iPhone, by device type rather than
// display name so a renamed simulator still classifies correctly.
func isIPhone(s Simulator) bool {
	return strings.Contains(s.DeviceTypeID, "SimDeviceType.iPhone")
}
