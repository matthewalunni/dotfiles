package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// processStart returns a stable identity string for a running PID: its start
// time as reported by ps. Combined with the PID this survives reboots and PID
// reuse, which is what makes "state says running but the process is gone"
// detectable rather than guessed at.
func processStart(pid int) (string, error) {
	out, err := exec.Command("ps", "-o", "lstart=", "-p", fmt.Sprint(pid)).Output()
	if err != nil {
		return "", fmt.Errorf("pid %d not running", pid)
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return "", fmt.Errorf("pid %d not running", pid)
	}
	return s, nil
}
