package server

import (
	"errors"
	"fmt"
	"log"
	"sync"
)

var ErrServerNotFound = errors.New("server not found")

type Manager struct {
	mutex   sync.RWMutex
	servers map[uint16]*LiveServer
}

func NewManager() *Manager {
	return &Manager{
		servers: make(map[uint16]*LiveServer),
	}
}

func (m *Manager) Start(path string, port uint16, on_log func(LogEntry)) error {
	m.mutex.Lock()
	if _, exists := m.servers[port]; exists {
		m.mutex.Unlock()
		return fmt.Errorf("server already registered on port %d", port)
	}
	srv := &LiveServer{path: path, port: port, OnLog: on_log}
	m.servers[port] = srv
	m.mutex.Unlock() // release before Start() blocks on ListenAndServe

	go func() {
		if err := srv.Start(); err != nil {
			log.Printf("server %d: %v", port, err)
			m.mutex.Lock()
			delete(m.servers, port)
			m.mutex.Unlock()
		}
	}()

	return nil
}

func (m *Manager) Restart(port uint16) error {
	m.mutex.RLock()
	srv, ok := m.servers[port]
	m.mutex.RUnlock()

	if !ok {
		return fmt.Errorf("server on port %d: %w", port, ErrServerNotFound)
	}

	if err := srv.Stop(); err != nil {
		return err
	}

	go func() {
		if err := srv.Start(); err != nil {
			log.Printf("server %d restart failed: %v", port, err)
			m.mutex.Lock()
			delete(m.servers, port)
			m.mutex.Unlock()
		}
	}()

	return nil
}

func (m *Manager) Stop(port uint16) error {
	m.mutex.Lock()
	srv, ok := m.servers[port]
	if ok {
		delete(m.servers, port)
	}
	m.mutex.Unlock() // release BEFORE the slow Shutdown() call

	if !ok {
		return fmt.Errorf("server on port %d: %w", port, ErrServerNotFound)
	}

	return srv.Stop()
}

func (m *Manager) StopAll() {
	m.mutex.Lock()
	snapshot := make([]*LiveServer, 0, len(m.servers))
	for _, srv := range m.servers {
		snapshot = append(snapshot, srv)
	}
	m.servers = make(map[uint16]*LiveServer)
	m.mutex.Unlock()

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
