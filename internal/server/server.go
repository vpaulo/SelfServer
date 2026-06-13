package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/bep/debounce"
	"github.com/fsnotify/fsnotify"
	"github.com/gorilla/websocket"
)

type reload_message struct {
	Type string `json:"type"` // "reload" | "css"
	File string `json:"file"`
}

type websocket_hub struct {
	mutex   sync.Mutex
	clients map[*websocket.Conn]bool
}

func new_websocket_hub() *websocket_hub {
	return &websocket_hub{clients: make(map[*websocket.Conn]bool)}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1")
	},
}

func (h *websocket_hub) websocket_handler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	h.mutex.Lock()
	h.clients[conn] = true
	h.mutex.Unlock()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			h.mutex.Lock()
			delete(h.clients, conn)
			h.mutex.Unlock()
			conn.Close()
			return
		}
	}
}

func (h *websocket_hub) broadcast(msg reload_message) {
	data, _ := json.Marshal(msg)

	h.mutex.Lock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		clients = append(clients, conn)
	}
	h.mutex.Unlock()

	var dead []*websocket.Conn
	for _, conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			conn.Close()
			dead = append(dead, conn)
		}
	}

	if len(dead) > 0 {
		h.mutex.Lock()
		for _, conn := range dead {
			delete(h.clients, conn)
		}
		h.mutex.Unlock()
	}
}

func (h *websocket_hub) closeAll() {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	for conn := range h.clients {
		conn.Close()
		delete(h.clients, conn)
	}
}

const reload_script = `
<script>
(function () {
  function connect() {
    var ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onclose = function () { setTimeout(connect, 1000); };
    ws.onmessage = function (event) {
      var data = JSON.parse(event.data);
      if (data.type === 'css') {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
          link.href = link.href.split('?')[0] + '?v=' + Date.now();
        });
        return;
      }
      location.reload();
    };
  }
  connect();
}());
</script>
`

func injecting_handler(root string, hub *websocket_hub) http.Handler {
	fs := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws" {
			hub.websocket_handler(w, r)
			return
		}

		path := filepath.Join(root, filepath.Clean("/"+r.URL.Path))
		if !strings.HasPrefix(path, root+string(filepath.Separator)) && path != root {
			http.NotFound(w, r)
			return
		}

		ext := strings.ToLower(filepath.Ext(path))

		if ext != ".html" && ext != ".htm" {
			fs.ServeHTTP(w, r)
			return
		}

		data, err := os.ReadFile(path)
		if err != nil {
			fs.ServeHTTP(w, r)
			return
		}

		body := string(data)
		if idx := strings.LastIndex(body, "</body>"); idx != -1 {
			body = body[:idx] + reload_script + body[idx:]
		} else {
			body += reload_script
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, body)
	})
}

func watch_directory(root string, hub *websocket_hub) (*fsnotify.Watcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	ignored := []string{".git", "node_modules", ".idea", "dist", "build"}

	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || !info.IsDir() {
			return nil
		}
		for _, ig := range ignored {
			if strings.Contains(path, ig) {
				return filepath.SkipDir
			}
		}
		return watcher.Add(path)
	})

	debounced_broadcast := debounce.New(80 * time.Millisecond)

	go func() {
		defer watcher.Close()
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				ext := strings.ToLower(filepath.Ext(event.Name))
				msg := reload_message{Type: "reload", File: event.Name}
				if ext == ".css" {
					msg.Type = "css"
				}
				debounced_broadcast(func() { hub.broadcast(msg) })

				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = watcher.Add(event.Name)
				}

			case _, ok := <-watcher.Errors:
				if !ok {
					return
				}
			}
		}
	}()

	return watcher, nil
}

type LogEntry struct {
	Source      string
	SourceLabel string
	Method      string
	Path        string
	Status      int
	Bytes       int64
	Elapsed     time.Duration
}

type response_recorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *response_recorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *response_recorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

func logging_handler(next http.Handler, port uint16, onLog func(LogEntry)) http.Handler {
	if onLog == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &response_recorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		elapsed := time.Since(start)
		onLog(LogEntry{
			Source:      fmt.Sprintf("server:%d", port),
			SourceLabel: fmt.Sprintf(":%d", port),
			Method:      r.Method,
			Path:        r.URL.Path,
			Status:      rec.status,
			Bytes:       rec.bytes,
			Elapsed:     elapsed,
		})
	})
}

type LiveServer struct {
	path    string
	port    uint16
	server  *http.Server
	hub     *websocket_hub
	watcher *fsnotify.Watcher
	OnLog   func(LogEntry)
}

func (l *LiveServer) Start() error {
	dir := "."

	if len(l.path) > 1 {
		dir = l.path
	}

	absDir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}

	hub := new_websocket_hub()
	l.hub = hub

	watcher, err := watch_directory(absDir, hub)
	if err != nil {
		return err
	}
	l.watcher = watcher

	mux := http.NewServeMux()
	mux.Handle("/", logging_handler(injecting_handler(absDir, hub), l.port, l.OnLog))

	addr := fmt.Sprintf(":%d", l.port)
	url := fmt.Sprintf("http://localhost:%d", l.port)

	l.server = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	fmt.Printf("Serving %s\n", absDir)
	fmt.Printf("Live at %s\n", url)

	err = l.server.ListenAndServe()
	if err != nil && err != http.ErrServerClosed {
		return err
	}

	return nil
}

func (l *LiveServer) Stop() error {
	if l.watcher != nil {
		l.watcher.Close()
	}
	if l.hub != nil {
		l.hub.closeAll()
	}
	if l.server == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return l.server.Shutdown(ctx)
}
