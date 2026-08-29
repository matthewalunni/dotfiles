package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

// Device is a physical iOS device as reported by devicectl.
type Device struct {
	// UDID is hardwareProperties.udid, and it is the identifier everything
	// downstream is given. devicectl accepts either this or the CoreDevice
	// identifier, but xcodebuild accepts only this one:
	//
	//   xcodebuild -showdestinations
	//     { platform:iOS, arch:arm64, id:00008101-..., name:Matthews iPhone }
	//
	// XCODEBUILDMCP_DEVICE_ID feeds both `xcodebuild -destination id=` and
	// `devicectl --device`, so the hardware UDID is the only value that
	// satisfies both.
	UDID string
	// CoreDeviceID is devicectl's own identifier, kept for display and for
	// matching what `devicectl list devices` prints.
	CoreDeviceID string
	Name         string
	Model        string
	OSVersion    string
	Connected    bool
	Paired       bool
	Transport    string
}

type devicectlList struct {
	Result struct {
		Devices []struct {
			Identifier       string `json:"identifier"`
			DeviceProperties struct {
				Name            string `json:"name"`
				OSVersionNumber string `json:"osVersionNumber"`
			} `json:"deviceProperties"`
			HardwareProperties struct {
				UDID       string `json:"udid"`
				Platform   string `json:"platform"`
				DeviceType string `json:"deviceType"`
				Marketing  string `json:"marketingName"`
			} `json:"hardwareProperties"`
			ConnectionProperties struct {
				TransportType string `json:"transportType"`
				TunnelState   string `json:"tunnelState"`
				PairingState  string `json:"pairingState"`
			} `json:"connectionProperties"`
		} `json:"devices"`
	} `json:"result"`
}

// ListDevices returns paired iOS devices known to devicectl.
//
// devicectl only writes JSON to a file, never to stdout, so this round-trips
// through a temp file rather than parsing the human-readable table, whose
// columns are not stable.
func ListDevices() ([]Device, error) {
	tmp, err := os.CreateTemp("", "agent-devices-*.json")
	if err != nil {
		return nil, err
	}
	path := tmp.Name()
	tmp.Close()
	defer os.Remove(path)

	cmd := exec.Command("xcrun", "devicectl", "list", "devices", "--json-output", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("devicectl list devices failed: %v: %s", err, out)
	}

	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	var parsed devicectlList
	if err := json.Unmarshal(b, &parsed); err != nil {
		return nil, fmt.Errorf("cannot parse devicectl output: %w", err)
	}

	var out []Device
	for _, d := range parsed.Result.Devices {
		if d.HardwareProperties.Platform != "iOS" {
			continue
		}
		if d.HardwareProperties.UDID == "" {
			// Without a hardware UDID we cannot build for it, so listing it
			// would only offer the user something that fails later.
			continue
		}
		out = append(out, Device{
			UDID:         d.HardwareProperties.UDID,
			CoreDeviceID: d.Identifier,
			Name:         d.DeviceProperties.Name,
			Model:        d.HardwareProperties.Marketing,
			OSVersion:    d.DeviceProperties.OSVersionNumber,
			Connected:    d.ConnectionProperties.TunnelState == "connected",
			Paired:       d.ConnectionProperties.PairingState == "paired",
			Transport:    d.ConnectionProperties.TransportType,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// FindDevice resolves a device by hardware UDID, CoreDevice identifier, or
// exact name. Name is accepted for convenience at the CLI only; everything
// stored and passed downstream is the hardware UDID.
func FindDevice(devices []Device, want string) (Device, error) {
	for _, d := range devices {
		if d.UDID == want || d.CoreDeviceID == want || d.Name == want {
			return d, nil
		}
	}
	return Device{}, fmt.Errorf("no connected device matching %q", want)
}

// SoleDevice returns the only connected device, or an error naming the choice
// the user has to make. It never picks one arbitrarily: building to the wrong
// physical phone is not something to guess at.
func SoleDevice(devices []Device) (Device, error) {
	var connected []Device
	for _, d := range devices {
		if d.Connected {
			connected = append(connected, d)
		}
	}
	switch len(connected) {
	case 0:
		if len(devices) > 0 {
			return Device{}, fmt.Errorf("no device is connected (%s is paired but not reachable)",
				devices[0].Name)
		}
		return Device{}, fmt.Errorf("no physical device is connected")
	case 1:
		return connected[0], nil
	default:
		msg := "several devices are connected; choose one with --device-id:\n"
		for _, d := range connected {
			msg += fmt.Sprintf("    %-20s %s\n", d.Name, d.UDID)
		}
		return Device{}, fmt.Errorf("%s", msg)
	}
}
