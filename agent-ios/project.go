package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// RepoRoot returns the main working tree of the repository containing dir,
// even when dir is itself a linked worktree. Agents must all register against
// the same project identity regardless of which tree they were launched from.
func RepoRoot(dir string) (string, error) {
	commonDir, err := gitOutput(dir, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return "", fmt.Errorf("%s is not inside a git repository", dir)
	}
	// --git-common-dir points at <main-worktree>/.git for both the main tree
	// and any linked worktree.
	return filepath.Dir(strings.TrimSpace(commonDir)), nil
}

func gitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// DiscoverXcodeContainer finds the .xcworkspace or .xcodeproj at the repo root.
// A workspace wins when both exist, matching how Xcode itself resolves things.
func DiscoverXcodeContainer(root string) (projectPath, workspacePath string, err error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return "", "", err
	}
	for _, e := range entries {
		switch filepath.Ext(e.Name()) {
		case ".xcworkspace":
			workspacePath = filepath.Join(root, e.Name())
		case ".xcodeproj":
			if projectPath == "" {
				projectPath = filepath.Join(root, e.Name())
			}
		}
	}
	if workspacePath != "" {
		return "", workspacePath, nil
	}
	if projectPath != "" {
		return projectPath, "", nil
	}
	return "", "", fmt.Errorf("no .xcodeproj or .xcworkspace found in %s", root)
}

// ListSchemes asks xcodebuild for the schemes of a project or workspace.
func ListSchemes(projectPath, workspacePath string) ([]string, error) {
	args := []string{"-list", "-json"}
	switch {
	case workspacePath != "":
		args = append(args, "-workspace", workspacePath)
	case projectPath != "":
		args = append(args, "-project", projectPath)
	default:
		return nil, fmt.Errorf("neither project nor workspace given")
	}
	out, err := exec.Command("xcodebuild", args...).Output()
	if err != nil {
		return nil, fmt.Errorf("xcodebuild -list: %w", err)
	}
	// xcodebuild may emit warnings before the JSON body.
	if i := strings.Index(string(out), "{"); i > 0 {
		out = out[i:]
	}
	var payload struct {
		Project   struct{ Schemes []string } `json:"project"`
		Workspace struct{ Schemes []string } `json:"workspace"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return nil, fmt.Errorf("parsing xcodebuild -list output: %w", err)
	}
	schemes := payload.Project.Schemes
	if len(schemes) == 0 {
		schemes = payload.Workspace.Schemes
	}
	sort.Strings(schemes)
	return schemes, nil
}

// ResolveProject returns the cached project record for the repo containing dir,
// discovering and caching it on first use. It never writes to the user's repo.
func ResolveProject(s *State, dir string) (*Project, error) {
	root, err := RepoRoot(dir)
	if err != nil {
		return nil, err
	}
	name := filepath.Base(root)
	if p, ok := s.Projects[name]; ok && p.Root == root && p.Scheme != "" {
		return p, nil
	}

	projectPath, workspacePath, err := DiscoverXcodeContainer(root)
	if err != nil {
		return nil, err
	}
	schemes, err := ListSchemes(projectPath, workspacePath)
	if err != nil {
		return nil, err
	}
	if len(schemes) == 0 {
		return nil, fmt.Errorf("no schemes found for %s", root)
	}
	scheme := schemes[0]
	if len(schemes) > 1 {
		// Prefer a scheme named after the project; otherwise the caller must
		// disambiguate with --scheme rather than have us guess silently.
		matched := false
		for _, sc := range schemes {
			if sc == name || strings.EqualFold(sc, name) {
				scheme, matched = sc, true
				break
			}
		}
		if !matched {
			return nil, fmt.Errorf("multiple schemes in %s (%s); rerun with --scheme <name>",
				root, strings.Join(schemes, ", "))
		}
	}

	p := &Project{
		Name:          name,
		Root:          root,
		ProjectPath:   projectPath,
		WorkspacePath: workspacePath,
		Scheme:        scheme,
	}
	s.Projects[name] = p
	return p, nil
}
