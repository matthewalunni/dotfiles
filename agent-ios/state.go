package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

const stateVersion = 1

// TargetKind distinguishes a leased simulator from the (exclusive) physical
// device. Stored as a string so the state file stays readable by hand.
type TargetKind string

const (
	TargetSimulator TargetKind = "simulator"
	TargetDevice    TargetKind = "device"
)

type Target struct {
	Kind TargetKind `json:"kind"`
	// UDID is the simulator UDID or the devicectl device identifier. This is
	// the value handed to XcodeBuildMCP; it is always the authoritative one.
	UDID string `json:"udid"`
	// Name is for display only. Simulator names are not unique on this machine
	// (two are called "iPhone 17 Pro"), so nothing may key off it.
	Name string `json:"name"`
}

type Agent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Project     string    `json:"project"`
	RepoRoot    string    `json:"repoRoot"`
	Branch      string    `json:"branch"`
	Worktree    string    `json:"worktree"`
	DerivedData string    `json:"derivedData"`
	Target      Target    `json:"target"`
	PID         int       `json:"pid"`
	PIDStart    string    `json:"pidStart"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Agent statuses. Only "stale" releases a lease implicitly.
const (
	StatusRegistered = "registered" // leased, no process launched yet
	StatusRunning    = "running"    // launcher process confirmed alive
	StatusStale      = "stale"      // process is gone; lease reclaimable
)

// Status reports whether the launcher process this agent record describes is
// still the same running process. PIDs are recycled across reboots, so a bare
// kill(pid, 0) is not sufficient; the process start time disambiguates.
func (a *Agent) Status() string {
	if a.PID <= 0 {
		// Reserved but never launched. Held until explicitly killed, so that a
		// spawn in progress cannot have its simulator stolen mid-setup.
		return StatusRegistered
	}
	start, err := processStart(a.PID)
	if err != nil {
		return StatusStale
	}
	// Records written before start-time tracking fall back to existence only.
	// Both sides are trimmed: ps pads lstart to a fixed width, and a value that
	// round-tripped through a shell or an editor may carry stray whitespace.
	if recorded := strings.TrimSpace(a.PIDStart); recorded != "" && start != recorded {
		return StatusStale
	}
	return StatusRunning
}

// Live reports whether this agent still holds its leases.
func (a *Agent) Live() bool { return a.Status() != StatusStale }

type Project struct {
	Name string `json:"name"`
	Root string `json:"root"`
	// ProjectPath and WorkspacePath are mutually exclusive, mirroring
	// XcodeBuildMCP's own session-defaults schema.
	ProjectPath   string `json:"projectPath,omitempty"`
	WorkspacePath string `json:"workspacePath,omitempty"`
	Scheme        string `json:"scheme"`
}

type State struct {
	Version  int                 `json:"version"`
	Agents   map[string]*Agent   `json:"agents"`
	Projects map[string]*Project `json:"projects"`
}

func newState() *State {
	return &State{
		Version:  stateVersion,
		Agents:   map[string]*Agent{},
		Projects: map[string]*Project{},
	}
}

// SortedAgents returns agents in stable id order so that CLI output does not
// reshuffle between runs.
func (s *State) SortedAgents() []*Agent {
	out := make([]*Agent, 0, len(s.Agents))
	for _, a := range s.Agents {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// HolderOfUDID returns the live agent currently leasing the given simulator or
// device, if any. Leases are derived from live agents rather than stored
// separately, so a crashed agent releases its lease automatically.
func (s *State) HolderOfUDID(udid string) *Agent {
	for _, a := range s.SortedAgents() {
		if a.Target.UDID == udid && a.Live() {
			return a
		}
	}
	return nil
}

// NextAgentID allocates the lowest free "<type>-<n>" not held by a live agent.
func (s *State) NextAgentID(agentType string) string {
	for n := 1; ; n++ {
		id := fmt.Sprintf("%s-%d", agentType, n)
		if _, taken := s.Agents[id]; !taken {
			return id
		}
	}
}

// ---- persistence -----------------------------------------------------------

type lockedFile struct{ f *os.File }

func acquireLock(exclusive bool) (*lockedFile, error) {
	if err := EnsureRoot(); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(LockPath(), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	how := syscall.LOCK_SH
	if exclusive {
		how = syscall.LOCK_EX
	}
	// Blocking flock: two simultaneous spawns serialise here rather than
	// racing to lease the same simulator.
	if err := syscall.Flock(int(f.Fd()), how); err != nil {
		f.Close()
		return nil, err
	}
	return &lockedFile{f: f}, nil
}

func (l *lockedFile) release() {
	syscall.Flock(int(l.f.Fd()), syscall.LOCK_UN)
	l.f.Close()
}

func loadStateLocked() (*State, error) {
	b, err := os.ReadFile(StatePath())
	if os.IsNotExist(err) {
		return newState(), nil
	}
	if err != nil {
		return nil, err
	}
	s := newState()
	if err := json.Unmarshal(b, s); err != nil {
		return nil, fmt.Errorf("state.json is corrupt (%w); move it aside and rerun", err)
	}
	if s.Agents == nil {
		s.Agents = map[string]*Agent{}
	}
	if s.Projects == nil {
		s.Projects = map[string]*Project{}
	}
	return s, nil
}

func saveStateLocked(s *State) error {
	s.Version = stateVersion
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	// Write-then-rename so a crash mid-write cannot truncate existing state.
	tmp, err := os.CreateTemp(Root(), ".state-*.json")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, filepath.Clean(StatePath()))
}

// ReadState takes a shared lock for read-only commands.
func ReadState() (*State, error) {
	l, err := acquireLock(false)
	if err != nil {
		return nil, err
	}
	defer l.release()
	return loadStateLocked()
}

// WithState runs fn under an exclusive lock and persists the result only if fn
// succeeds. This is the only path that may mutate state.
func WithState(fn func(*State) error) error {
	l, err := acquireLock(true)
	if err != nil {
		return err
	}
	defer l.release()
	s, err := loadStateLocked()
	if err != nil {
		return err
	}
	if err := fn(s); err != nil {
		return err
	}
	return saveStateLocked(s)
}
