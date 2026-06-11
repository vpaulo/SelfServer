package server

import (
	"fmt"
	"log"
	"sync"
)

type Manager struct {
	mu      sync.RWMutex
	servers map[uint16]*LiveServer
}

func NewManager() *Manager {
	return &Manager{
		servers: make(map[uint16]*LiveServer),
	}
}

func (m *Manager) Start(path string, port uint16, onLog func(LogEntry)) error {
	m.mu.Lock()
	if _, exists := m.servers[port]; exists {
		m.mu.Unlock()
		return fmt.Errorf("server already registered on port %d", port)
	}
	srv := &LiveServer{path: path, port: port, OnLog: onLog}
	m.servers[port] = srv
	m.mu.Unlock() // release before Start() blocks on ListenAndServe

	go func() {
		if err := srv.Start(); err != nil {
			log.Printf("server %d: %v", port, err)
			m.mu.Lock()
			delete(m.servers, port)
			m.mu.Unlock()
		}
	}()

	return nil
}

func (m *Manager) Restart(port uint16) error {
	m.mu.RLock()
	srv, ok := m.servers[port]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("server on port %d not found", port)
	}

	if err := srv.Stop(); err != nil {
		return err
	}

	return srv.Start()
}

func (m *Manager) Stop(port uint16) error {
	m.mu.Lock()
	srv, ok := m.servers[port]
	if ok {
		delete(m.servers, port)
	}
	m.mu.Unlock() // release BEFORE the slow Shutdown() call

	if !ok {
		return fmt.Errorf("server on port %d not found", port)
	}

	return srv.Stop()
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	snapshot := make([]*LiveServer, 0, len(m.servers))
	for _, srv := range m.servers {
		snapshot = append(snapshot, srv)
	}
	m.servers = make(map[uint16]*LiveServer)
	m.mu.Unlock()

	var wg sync.WaitGroup
	for _, srv := range snapshot {
		wg.Add(1)
		go func(s *LiveServer) {
			defer wg.Done()
			if err := s.Stop(); err != nil {
				log.Printf("stop %d: %v", s.port, err)
			}
		}(srv)
	}
	wg.Wait()
}
