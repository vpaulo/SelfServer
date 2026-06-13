package services

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"self_server/internal/config"
	"self_server/internal/server"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	gopty "github.com/aymanbagabas/go-pty"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	port_range_start = 5000
	port_range_end   = 5100
)

// ---- Types ------------------------------------------------------------------

type PortInfo struct {
	Port    uint16 `json:"Port"`
	PID     int    `json:"PID"`
	Process string `json:"Process"`
}

const maxLogBuf = 64 * 1024 // 64 KB ring buffer per PTY

type PtyProcess struct {
	pty    gopty.Pty
	cmd    *gopty.Cmd
	done   chan struct{}
	mu     sync.Mutex
	logBuf []byte
}

func (p *PtyProcess) append_log(data []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.logBuf = append(p.logBuf, data...)
	if len(p.logBuf) > maxLogBuf {
		p.logBuf = p.logBuf[len(p.logBuf)-maxLogBuf:]
	}
}

func (p *PtyProcess) copy_log() []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]byte, len(p.logBuf))
	copy(out, p.logBuf)
	return out
}

type PTYDataPayload struct {
	ID   string `json:"ID"`
	Data string `json:"Data"` // base64(raw PTY bytes)
}

type PTYDonePayload struct {
	ID       string `json:"ID"`
	ExitCode int    `json:"ExitCode"`
}

type ScriptInfo struct {
	Name    string `json:"Name"`
	Command string `json:"Command"`
}

type ServerStartedPayload struct {
	Path string `json:"path"`
	Port uint16 `json:"port"`
	URL  string `json:"url"`
}

type ServerStoppedPayload struct {
	Port uint16 `json:"port"`
}

type ServerErrorPayload struct {
	Port    uint16 `json:"port"`
	Message string `json:"message"`
}

type SelfServerService struct {
	App           *application.App
	Config        *config.Config
	ServerManager *server.Manager
	PtyMutex      sync.RWMutex
	PtyRunning    map[string]*PtyProcess
}

func NewSelfServerService() *SelfServerService {
	return &SelfServerService{
		PtyRunning: make(map[string]*PtyProcess),
	}
}

func (s *SelfServerService) AppReady() {
	s.App.Event.Emit("update:projects", s.Config.Projects)
}

func (s *SelfServerService) PickFolder() string {
	result, err := application.Get().Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		SetTitle("Select Directory").
		PromptForSingleSelection()

	if err != nil {
		return "Error: " + err.Error()
	}
	if result == "" {
		return "Cancelled"
	}
	return result
}

func (s *SelfServerService) AddProject(name string) error {
	s.Config.Projects = append(s.Config.Projects, config.ProjectConfig{Name: name})
	return config.SaveConfig(s.Config)
}

func (s *SelfServerService) RemoveProject(name string) error {
	for _, project := range s.Config.Projects {
		if project.Name == name {
			for _, srv := range project.Servers {
				if err := s.ServerManager.Stop(srv.Port); err != nil && !errors.Is(err, server.ErrServerNotFound) {
					log.Printf("stop server %d: %v", srv.Port, err)
				}
			}
			break
		}
	}
	updated := s.Config.Projects[:0]
	for _, project := range s.Config.Projects {
		if project.Name != name {
			updated = append(updated, project)
		}
	}
	s.Config.Projects = updated
	return config.SaveConfig(s.Config)
}

func (s *SelfServerService) AddCommandPackage(project_name, path, pm string) error {
	for i, project := range s.Config.Projects {
		if project.Name == project_name {
			s.Config.Projects[i].Commands = append(s.Config.Projects[i].Commands, config.CommandPackage{Path: path, PM: pm})
			return config.SaveConfig(s.Config)
		}
	}
	return fmt.Errorf("project %q not found", project_name)
}

func (s *SelfServerService) RemoveCommandPackage(project_name, path string) error {
	for i, project := range s.Config.Projects {
		if project.Name == project_name {
			cmds := s.Config.Projects[i].Commands
			for j, command := range cmds {
				if command.Path == path {
					s.Config.Projects[i].Commands = append(cmds[:j], cmds[j+1:]...)
					return config.SaveConfig(s.Config)
				}
			}
			return fmt.Errorf("command package %q not found in project %q", path, project_name)
		}
	}
	return fmt.Errorf("project %q not found", project_name)
}

func (s *SelfServerService) RemoveScript(project_name, path, script_name string) error {
	for i, project := range s.Config.Projects {
		if project.Name == project_name {
			for j, command := range project.Commands {
				if command.Path == path {
					s.Config.Projects[i].Commands[j].HiddenScripts = append(command.HiddenScripts, script_name)
					return config.SaveConfig(s.Config)
				}
			}
			return fmt.Errorf("command package %q not found in project %q", path, project_name)
		}
	}
	return fmt.Errorf("project %q not found", project_name)
}

func (s *SelfServerService) AddLiveServer(project_name, name, path string, port uint16) error {
	for i, project := range s.Config.Projects {
		if project.Name == project_name {
			s.Config.Projects[i].Servers = append(s.Config.Projects[i].Servers, config.ServerConfig{
				Name: name,
				Path: path,
				Port: port,
			})
			return config.SaveConfig(s.Config)
		}
	}
	return fmt.Errorf("project %q not found", project_name)
}

func (s *SelfServerService) StartServer(path string, port uint16) error {
	on_log := func(entry server.LogEntry) {
		go s.emit_server_log(entry)
	}

	if err := s.ServerManager.Start(path, port, on_log); err != nil {
		go s.App.Event.Emit("server:error", ServerErrorPayload{Port: port, Message: err.Error()})
		return err
	}

	go s.emit_server_started(port, path)
	go s.App.Event.Emit("server:started", ServerStartedPayload{
		Path: path,
		Port: port,
		URL:  fmt.Sprintf("http://localhost:%d", port),
	})
	return nil
}

func (s *SelfServerService) RestartServer(port uint16) error {
	return s.ServerManager.Restart(port)
}

func (s *SelfServerService) StopServer(port uint16) error {
	if err := s.ServerManager.Stop(port); err != nil {
		if !errors.Is(err, server.ErrServerNotFound) {
			return err
		}
		if killErr := server.KillPort(port); killErr != nil {
			return killErr
		}
	}
	go s.App.Event.Emit("server:stopped", ServerStoppedPayload{Port: port})
	return nil
}

func (s *SelfServerService) RemoveServer(project_name string, port uint16) error {
	if err := s.ServerManager.Stop(port); err != nil && !errors.Is(err, server.ErrServerNotFound) {
		return err
	}
	for i, project := range s.Config.Projects {
		if project.Name == project_name {
			updated := project.Servers[:0]
			for _, server := range project.Servers {
				if server.Port != port {
					updated = append(updated, server)
				}
			}
			s.Config.Projects[i].Servers = updated
			return config.SaveConfig(s.Config)
		}
	}
	return fmt.Errorf("project %q not found", project_name)
}

func (s *SelfServerService) IsPortListening(port uint16) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", port), 200*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func (s *SelfServerService) SuggestPort() (uint16, error) {
	used := make(map[uint16]bool)
	for _, project := range s.Config.Projects {
		for _, server := range project.Servers {
			used[server.Port] = true
		}
	}
	port := uint16(port_range_start)
	for port < port_range_end {
		if used[port] {
			port++
			continue
		}
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			ln.Close()
			return port, nil
		}
		port++
	}
	return 0, fmt.Errorf("no free port found")
}

func (s *SelfServerService) PortOwner(port uint16) (string, error) {
	return server.FindPortOwner(port)
}

func (s *SelfServerService) KillPort(port uint16) error {
	return server.KillPort(port)
}

func (s *SelfServerService) ListActivePorts() ([]PortInfo, error) {
	var all []PortInfo
	var err error
	switch runtime.GOOS {
	case "linux", "darwin":
		all, err = scan_lsof()
	case "windows":
		all, err = scan_netstat()
	default:
		return nil, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
	if err != nil {
		return nil, err
	}
	selfPID := os.Getpid()
	result := all[:0]
	for _, p := range all {
		if p.PID != selfPID {
			result = append(result, p)
		}
	}
	return result, nil
}

func (s *SelfServerService) TerminatePort(port uint16) error {
	pid, err := find_PID_for_port(port)
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "windows":
		return exec.Command("taskkill", "/F", "/PID", strconv.Itoa(pid)).Run()
	default:
		proc, err := os.FindProcess(pid)
		if err != nil {
			return err
		}
		if err := proc.Signal(syscall.SIGTERM); err != nil {
			return proc.Signal(syscall.SIGKILL)
		}
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			time.Sleep(100 * time.Millisecond)
			if proc.Signal(syscall.Signal(0)) != nil {
				return nil
			}
		}
		return proc.Signal(syscall.SIGKILL)
	}
}

// ---- Commands / scripts (PTY) -----------------------------------------------

func (s *SelfServerService) IsScriptRunning(id string) bool {
	s.PtyMutex.RLock()
	_, ok := s.PtyRunning[id]
	s.PtyMutex.RUnlock()
	return ok
}

func (s *SelfServerService) GetScriptLog(id string) string {
	s.PtyMutex.RLock()
	proc, ok := s.PtyRunning[id]
	s.PtyMutex.RUnlock()
	if !ok {
		return ""
	}
	return base64.StdEncoding.EncodeToString(proc.copy_log())
}

func (s *SelfServerService) RunScript(id, dir, script_name, pm string, cols, rows uint16) error {
	switch pm {
	case "npm", "yarn", "pnpm":
	default:
		return fmt.Errorf("unsupported package manager: %q", pm)
	}

	s.PtyMutex.Lock()
	if _, exists := s.PtyRunning[id]; exists {
		s.PtyMutex.Unlock()
		return fmt.Errorf("already running: %q", id)
	}

	pt, err := gopty.New()
	if err != nil {
		s.PtyMutex.Unlock()
		return fmt.Errorf("pty.New: %w", err)
	}
	if err := pt.Resize(int(cols), int(rows)); err != nil {
		s.PtyMutex.Unlock()
		pt.Close()
		return fmt.Errorf("pty.Resize: %w", err)
	}

	cmd := pt.Command(pm, "run", script_name)
	cmd.Dir = dir

	if err := cmd.Start(); err != nil {
		s.PtyMutex.Unlock()
		pt.Close()
		return fmt.Errorf("pty.Start: %w", err)
	}

	proc := &PtyProcess{pty: pt, cmd: cmd, done: make(chan struct{})}
	s.PtyRunning[id] = proc
	s.PtyMutex.Unlock()

	go func() {
		defer close(proc.done)
		buf := make([]byte, 4096)
		for {
			n, err := pt.Read(buf)
			if n > 0 {
				proc.append_log(buf[:n])
				s.App.Event.Emit("pty:data", PTYDataPayload{
					ID:   id,
					Data: base64.StdEncoding.EncodeToString(buf[:n]),
				})
			}
			if err != nil {
				break
			}
		}

		exitCode := 0
		cmd.Wait()
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}

		s.PtyMutex.Lock()
		delete(s.PtyRunning, id)
		s.PtyMutex.Unlock()

		pt.Close()
		s.App.Event.Emit("pty:done", PTYDonePayload{ID: id, ExitCode: exitCode})
	}()

	return nil
}

func (s *SelfServerService) StopScript(id string) error {
	s.PtyMutex.RLock()
	proc, ok := s.PtyRunning[id]
	s.PtyMutex.RUnlock()

	if !ok {
		return fmt.Errorf("script %q not running", id)
	}

	if runtime.GOOS == "windows" {
		return proc.cmd.Process.Kill()
	}

	// Ctrl-C → SIGINT delivered to the foreground process group via the PTY
	if _, err := proc.pty.Write([]byte{0x03}); err != nil {
		return proc.cmd.Process.Kill()
	}

	select {
	case <-proc.done:
	case <-time.After(2 * time.Second):
		proc.cmd.Process.Kill()
		// Wait for goroutine cleanup after Kill; force-remove from map if it stalls.
		select {
		case <-proc.done:
		case <-time.After(2 * time.Second):
			s.PtyMutex.Lock()
			delete(s.PtyRunning, id)
			s.PtyMutex.Unlock()
		}
	}
	return nil
}

func (s *SelfServerService) PTYWrite(id, b64data string) error {
	data, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return err
	}
	s.PtyMutex.RLock()
	proc, ok := s.PtyRunning[id]
	s.PtyMutex.RUnlock()
	if !ok {
		return fmt.Errorf("script %q not running", id)
	}
	_, err = proc.pty.Write(data)
	return err
}

func (s *SelfServerService) PTYResize(id string, cols, rows uint16) error {
	s.PtyMutex.RLock()
	proc, ok := s.PtyRunning[id]
	s.PtyMutex.RUnlock()
	if !ok {
		return nil
	}
	return proc.pty.Resize(int(cols), int(rows))
}

// ---- Package / script discovery ---------------------------------------------

func (s *SelfServerService) ParsePackageJSON(path string) ([]ScriptInfo, error) {
	const max_size = 1 << 20 // 1 MB
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > max_size {
		return nil, fmt.Errorf("package.json too large (%d bytes)", info.Size())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil, err
	}
	result := make([]ScriptInfo, 0, len(pkg.Scripts))
	for name, cmd := range pkg.Scripts {
		result = append(result, ScriptInfo{Name: name, Command: cmd})
	}
	return result, nil
}

func (s *SelfServerService) DetectPackageManager(dir string) string {
	if _, err := os.Stat(filepath.Join(dir, "yarn.lock")); err == nil {
		return "yarn"
	}
	if _, err := os.Stat(filepath.Join(dir, "pnpm-lock.yaml")); err == nil {
		return "pnpm"
	}
	return "npm"
}

// ---- PTY log helpers (unexported) -------------------------------------------

const (
	ansi_reset  = "\x1b[0m"
	ansi_green  = "\x1b[32m"
	ansi_yellow = "\x1b[33m"
	ansi_red    = "\x1b[31m"
	ansi_gray   = "\x1b[90m"
	ansi_bold   = "\x1b[1m"
	ansi_blue   = "\x1b[34m"
)

func (s *SelfServerService) emit_server_log(entry server.LogEntry) {
	color := ansi_green
	if entry.Status >= 300 && entry.Status < 400 {
		color = ansi_yellow
	} else if entry.Status >= 400 {
		color = ansi_red
	}
	line := fmt.Sprintf(
		"%s%s%s %s%-6s%s %s %s%d%s %s%dB%s %s%s%s\r\n",
		ansi_gray, time.Now().Format("15:04:05"), ansi_reset,
		ansi_bold, entry.Method, ansi_reset,
		entry.Path,
		color, entry.Status, ansi_reset,
		ansi_gray, entry.Bytes, ansi_reset,
		ansi_gray, entry.Elapsed.Round(time.Millisecond), ansi_reset,
	)
	s.App.Event.Emit("pty:data", PTYDataPayload{
		ID:   entry.Source,
		Data: base64.StdEncoding.EncodeToString([]byte(line)),
	})
}

func (s *SelfServerService) emit_server_started(port uint16, path string) {
	abs_dir, err := filepath.Abs(path)
	if err != nil {
		abs_dir = path
	}
	banner := fmt.Sprintf(
		"\r\n  %s%sSelf Server%s\r\n  %sServing %s%s\r\n  %shttp://localhost:%d%s\r\n\r\n",
		ansi_bold, ansi_green, ansi_reset,
		ansi_gray, abs_dir, ansi_reset,
		ansi_blue, port, ansi_reset,
	)
	s.App.Event.Emit("pty:data", PTYDataPayload{
		ID:   fmt.Sprintf("server:%d", port),
		Data: base64.StdEncoding.EncodeToString([]byte(banner)),
	})
}

// ---- Port scan helpers ------------------------------------------------------

func scan_lsof() ([]PortInfo, error) {
	out, err := exec.Command("lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n").Output()
	if err != nil && len(out) == 0 {
		return nil, nil
	}
	var result []PortInfo
	for _, line := range strings.Split(string(out), "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}
		name_parts := strings.Split(fields[8], ":")
		port_num, err := strconv.ParseUint(name_parts[len(name_parts)-1], 10, 16)
		if err != nil || port_num < port_range_start || port_num > port_range_end {
			continue
		}
		pid, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}
		result = append(result, PortInfo{Port: uint16(port_num), PID: pid, Process: fields[0]})
	}
	return result, nil
}

func scan_netstat() ([]PortInfo, error) {
	out, err := exec.Command("netstat", "-ano").Output()
	if err != nil {
		return nil, fmt.Errorf("netstat: %w", err)
	}
	var result []PortInfo
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[3] != "LISTENING" {
			continue
		}
		addr_parts := strings.Split(fields[1], ":")
		port_num, err := strconv.ParseUint(addr_parts[len(addr_parts)-1], 10, 16)
		if err != nil || port_num < port_range_start || port_num > port_range_end {
			continue
		}
		pid, err := strconv.Atoi(fields[4])
		if err != nil {
			continue
		}
		name_out, _ := exec.Command("tasklist", "/FI",
			fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH").Output()
		name := ""
		if parts := strings.Split(string(name_out), ","); len(parts) > 0 {
			name = strings.Trim(parts[0], `"`)
		}
		result = append(result, PortInfo{Port: uint16(port_num), PID: pid, Process: name})
	}
	return result, nil
}

func find_PID_for_port(port uint16) (int, error) {
	switch runtime.GOOS {
	case "linux", "darwin":
		out, err := exec.Command("lsof", fmt.Sprintf("-ti:%d", port)).Output()
		if err != nil || len(out) == 0 {
			return 0, fmt.Errorf("no process found on port %d", port)
		}
		return strconv.Atoi(strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0]))
	case "windows":
		rows, err := scan_netstat()
		if err != nil {
			return 0, err
		}
		for _, row := range rows {
			if row.Port == port {
				return row.PID, nil
			}
		}
		return 0, fmt.Errorf("no process found on port %d", port)
	default:
		return 0, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}
