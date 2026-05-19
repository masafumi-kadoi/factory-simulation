package notify

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
)

// Hub manages LISTEN/NOTIFY and fans out to WebSocket subscribers
type Hub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan string]struct{} // dataSourceID → set of channels
	connStr     string
	listener    *pq.Listener
}

func NewHub(connStr string) *Hub {
	return &Hub{
		subscribers: make(map[string]map[chan string]struct{}),
		connStr:     connStr,
	}
}

func (h *Hub) Start() error {
	l := pq.NewListener(h.connStr, 10*time.Second, time.Minute, func(ev pq.ListenerEventType, err error) {
		if err != nil {
			log.Printf("[notify] listener error: %v", err)
		}
	})
	h.listener = l
	go h.loop()
	return nil
}

func (h *Hub) Subscribe(dataSourceID string) (chan string, func()) {
	ch := make(chan string, 64)
	channel := "events_" + dataSourceID

	h.mu.Lock()
	if h.subscribers[dataSourceID] == nil {
		h.subscribers[dataSourceID] = make(map[chan string]struct{})
		if h.listener != nil {
			if err := h.listener.Listen(channel); err != nil {
				log.Printf("[notify] listen %s: %v", channel, err)
			}
		}
	}
	h.subscribers[dataSourceID][ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subscribers[dataSourceID], ch)
		if len(h.subscribers[dataSourceID]) == 0 {
			delete(h.subscribers, dataSourceID)
			if h.listener != nil {
				h.listener.Unlisten(channel)
			}
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

func (h *Hub) loop() {
	for {
		if h.listener == nil {
			time.Sleep(time.Second)
			continue
		}
		select {
		case n, ok := <-h.listener.Notify:
			if !ok {
				log.Println("[notify] channel closed, reconnecting")
				time.Sleep(5 * time.Second)
				continue
			}
			if n == nil {
				continue
			}
			// channel is "events_{uuid}"
			if !strings.HasPrefix(n.Channel, "events_") {
				log.Printf("[notify] unexpected channel format: %s", n.Channel)
				continue
			}
			dataSourceID := n.Channel[7:]
			h.broadcast(dataSourceID, n.Extra)
		case <-time.After(90 * time.Second):
			if err := h.listener.Ping(); err != nil {
				log.Printf("[notify] ping error: %v", err)
			}
		}
	}
}

func (h *Hub) broadcast(dataSourceID, payload string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers[dataSourceID] {
		select {
		case ch <- payload:
		default:
			log.Printf("[notify] subscriber channel full for %s, dropping", dataSourceID)
		}
	}
}

func (h *Hub) ConnStr() string {
	return h.connStr
}

func BuildConnStr(host, port, user, password, dbname string) string {
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)
}
