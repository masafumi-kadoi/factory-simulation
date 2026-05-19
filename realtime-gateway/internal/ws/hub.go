package ws

import (
	"encoding/json"
	"factory-simulation/realtime-gateway/internal/notify"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:      func(r *http.Request) bool { return true },
	ReadBufferSize:   1024,
	WriteBufferSize:  4096,
	HandshakeTimeout: 10 * time.Second,
}

type clientMsg struct {
	Type         string `json:"type"`
	DataSourceID string `json:"data_source_id"`
}

type serverMsg struct {
	Type       string          `json:"type"`
	Data       json.RawMessage `json:"data,omitempty"`
	ServerTime string          `json:"server_time,omitempty"`
}

type client struct {
	conn         *websocket.Conn
	send         chan []byte
	mu           sync.Mutex
	cancelSub    func()
	dataSourceID string
}

func ServeWS(hub *notify.Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade: %v", err)
		return
	}

	c := &client{
		conn: conn,
		send: make(chan []byte, 256),
	}

	go c.writePump()
	c.readPump(hub)
}

func (c *client) readPump(hub *notify.Hub) {
	defer func() {
		if c.cancelSub != nil {
			c.cancelSub()
		}
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		return nil
	})

	for {
		var msg clientMsg
		if err := c.conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[ws] read error: %v", err)
			}
			return
		}
		c.conn.SetReadDeadline(time.Now().Add(120 * time.Second))

		switch msg.Type {
		case "subscribe":
			if c.cancelSub != nil {
				c.cancelSub()
			}
			c.dataSourceID = msg.DataSourceID
			ch, cancel := hub.Subscribe(msg.DataSourceID)
			c.cancelSub = cancel
			go c.forwardEvents(ch)

		case "unsubscribe":
			if c.cancelSub != nil {
				c.cancelSub()
				c.cancelSub = nil
			}
		}
	}
}

func (c *client) forwardEvents(ch chan string) {
	for payload := range ch {
		raw := json.RawMessage(payload)
		msg := serverMsg{Type: "event", Data: raw}
		b, _ := json.Marshal(msg)
		select {
		case c.send <- b:
		default:
			log.Printf("[ws] send buffer full for %s", c.dataSourceID)
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			// Send application-level heartbeat
			hb := serverMsg{
				Type:       "heartbeat",
				ServerTime: time.Now().UTC().Format(time.RFC3339Nano),
			}
			b, _ := json.Marshal(hb)
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
			// Send WebSocket-level ping so browser auto-responds with pong,
			// which updates the server read deadline and keeps connection alive.
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
