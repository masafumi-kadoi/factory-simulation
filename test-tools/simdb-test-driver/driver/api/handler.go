package api

import (
	"encoding/json"
	"net/http"
	"os"

	"simdb-test-driver/player"
	"simdb-test-driver/source"
)

type Handler struct {
	p *player.Player
}

func New(p *player.Player) *Handler {
	return &Handler{p: p}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /load", h.load)
	mux.HandleFunc("GET /status", h.status)
	mux.HandleFunc("GET /scenario", h.scenario)
	mux.HandleFunc("POST /play", h.play)
	mux.HandleFunc("POST /pause", h.pause)
	mux.HandleFunc("POST /reset", h.reset)
	mux.HandleFunc("PATCH /speed", h.speed)
}

// --- /load ---

type loadRequest struct {
	Type string `json:"type"` // builtin | zip | directory | db
	Path string `json:"path"` // zip / directory 用
	DSN  string `json:"dsn"`  // db 用
}

func (h *Handler) load(w http.ResponseWriter, r *http.Request) {
	var req loadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	var src source.DataSource
	switch req.Type {
	case "builtin", "":
		src = source.NewBuiltinSource()
	case "zip":
		if req.Path == "" {
			writeErr(w, http.StatusBadRequest, "path is required for type=zip")
			return
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "cannot read zip: "+err.Error())
			return
		}
		src = source.NewZipSource("zip:"+req.Path, data)
	case "directory":
		if req.Path == "" {
			writeErr(w, http.StatusBadRequest, "path is required for type=directory")
			return
		}
		if _, err := os.Stat(req.Path); os.IsNotExist(err) {
			writeErr(w, http.StatusBadRequest, "directory not found: "+req.Path)
			return
		}
		src = source.NewDirectorySource(req.Path)
	case "db":
		if req.DSN == "" {
			writeErr(w, http.StatusBadRequest, "dsn is required for type=db")
			return
		}
		src = source.NewDBSource(req.DSN)
	default:
		writeErr(w, http.StatusBadRequest, "unknown type: "+req.Type)
		return
	}

	if err := h.p.Load(src); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, nil)
}

// --- /status ---

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.p.Status())
}

// --- /scenario ---

type scenarioResponse struct {
	Name              string  `json:"name"`
	TotalEvents       int     `json:"total_events"`
	TotalDurationSec  float64 `json:"total_duration_sec"`
}

func (h *Handler) scenario(w http.ResponseWriter, r *http.Request) {
	st := h.p.Status()
	dur := 0.0
	// Player から直接イベント情報は持たないため status から近似
	_ = dur
	writeJSON(w, http.StatusOK, scenarioResponse{
		Name:        st.SourceName,
		TotalEvents: st.TotalEvents,
	})
}

// --- /play ---

func (h *Handler) play(w http.ResponseWriter, r *http.Request) {
	if err := h.p.Play(); err != nil {
		code := http.StatusInternalServerError
		if err.Error() == "already running" {
			code = http.StatusConflict
		}
		writeErr(w, code, err.Error())
		return
	}
	writeOK(w, nil)
}

// --- /pause ---

func (h *Handler) pause(w http.ResponseWriter, r *http.Request) {
	if err := h.p.Pause(); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	writeOK(w, nil)
}

// --- /reset ---

func (h *Handler) reset(w http.ResponseWriter, r *http.Request) {
	if err := h.p.Reset(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, nil)
}

// --- /speed ---

type speedRequest struct {
	Multiplier float64 `json:"multiplier"`
}

func (h *Handler) speed(w http.ResponseWriter, r *http.Request) {
	var req speedRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.p.SetSpeed(req.Multiplier); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeOK(w, map[string]float64{"multiplier": req.Multiplier})
}

// --- helpers ---

func writeOK(w http.ResponseWriter, extra any) {
	body := map[string]any{"ok": true}
	if extra != nil {
		for k, v := range extra.(map[string]float64) {
			body[k] = v
		}
	}
	writeJSON(w, http.StatusOK, body)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
