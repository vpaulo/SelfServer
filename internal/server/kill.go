package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// FindPortOwner returns the name of the process occupying the given port.
func FindPortOwner(port uint16) (string, error) {
	switch runtime.GOOS {
	case "linux", "darwin":
		out, err := exec.Command("lsof", fmt.Sprintf("-ti:%d", port)).Output()
		if err != nil {
			return "", fmt.Errorf("port %d appears free or lsof not found", port)
		}
		pid := strings.TrimSpace(strings.Split(string(out), "\n")[0])
		name_out, _ := exec.Command("ps", "-p", pid, "-o", "comm=").Output()
		return strings.TrimSpace(string(name_out)), nil
	case "windows":
		out, err := exec.Command("netstat", "-ano").Output()
		if err != nil {
			return "", err
		}
		target := fmt.Sprintf(":%d", port)
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 || !strings.HasSuffix(fields[1], target) {
				continue
			}
			name_out, _ := exec.Command("tasklist", "/FI",
				fmt.Sprintf("PID eq %s", fields[4]), "/FO", "CSV", "/NH").Output()
			parts := strings.Split(string(name_out), ",")
			if len(parts) > 0 {
				return strings.Trim(parts[0], `"`), nil
			}
		}
		return "", fmt.Errorf("no process found on port %d", port)
	default:
		return "", fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// KillPort tries a graceful HTTP shutdown first, then falls back to
// SIGTERM → SIGKILL via lsof (Linux/macOS) or taskkill (Windows).
func KillPort(port uint16) error {
	// Step 1 — graceful HTTP shutdown (works if the process is an SelfServer server
	// or any dev server that honours this endpoint).
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("http://localhost:%d/__self_server_shutdown", port), nil)
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
		for i := 0; i < 30; i++ {
			time.Sleep(100 * time.Millisecond)
			if ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port)); err == nil {
				ln.Close()
				return nil
			}
		}
	}

	// Step 2 — exec-based force-kill.
	switch runtime.GOOS {
	case "linux", "darwin":
		out, err := exec.Command("lsof", fmt.Sprintf("-ti:%d", port)).Output()
		if err != nil {
			return fmt.Errorf("lsof: port %d appears free or lsof not found", port)
		}
		pid, err := strconv.Atoi(strings.TrimSpace(strings.Split(string(out), "\n")[0]))
		if err != nil {
			return fmt.Errorf("lsof: unexpected output")
		}
		proc, err := os.FindProcess(pid)
		if err != nil {
			return err
		}
		if err := proc.Signal(syscall.SIGTERM); err != nil {
			return proc.Signal(syscall.SIGKILL)
		}
		for i := 0; i < 20; i++ {
			time.Sleep(100 * time.Millisecond)
			if proc.Signal(syscall.Signal(0)) != nil {
				return nil // exited cleanly
			}
		}
		return proc.Signal(syscall.SIGKILL)
	case "windows":
		out, err := exec.Command("netstat", "-ano").Output()
		if err != nil {
			return err
		}
		target := fmt.Sprintf(":%d", port)
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 || !strings.HasSuffix(fields[1], target) {
				continue
			}
			return exec.Command("taskkill", "/F", "/PID", fields[4]).Run()
		}
		return fmt.Errorf("no process found on port %d", port)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}
