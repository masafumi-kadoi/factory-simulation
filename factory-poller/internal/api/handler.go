package api

import (
	"encoding/json"
	"log"
	"net/http"

	"factory-poller/internal/poller"
)

type Handler struct {
	mgr *poller.Manager
}

func NewHandler(mgr *poller.Manager) *Handler {
	return &Handler{mgr: mgr}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/poller/start", h.handleStart)
	mux.HandleFunc("/poller/stop", h.handleStop)
	mux.HandleFunc("/poller/status", h.handleStatus)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
}

type startRequest struct {
	FactoryID            string `json:"factoryId"`
	ExternalDBHost       string `json:"externalDbHost"`
	ExternalDBPort       int    `json:"externalDbPort"`
	ExternalDBName       string `json:"externalDbName"`
	ExternalDBUser       string `json:"externalDbUser"`
	ExternalDBPass       string `json:"externalDbPass"`
	ExternalDSID         string `json:"externalDsId"`
	InternalDataSourceID string `json:"internalDataSourceId"` // optional, reuse existing
}

func (h *Handler) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var req startRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.FactoryID == "" {
		http.Error(w, "factoryId is required", 400)
		return
	}

	cfg := poller.Config{
		FactoryID:            req.FactoryID,
		ExternalDBHost:       req.ExternalDBHost,
		ExternalDBPort:       req.ExternalDBPort,
		ExternalDBName:       req.ExternalDBName,
		ExternalDBUser:       req.ExternalDBUser,
		ExternalDBPass:       req.ExternalDBPass,
		ExternalDSID:         req.ExternalDSID,
		InternalDataSourceID: req.InternalDataSourceID,
	}

	dsID, err := h.mgr.Start(cfg)
	if err != nil {
		log.Printf("[api] start error: %v", err)
		http.Error(w, err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":       "started",
		"dataSourceId": dsID,
	})
}

func (h *Handler) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var req struct {
		FactoryID string `json:"factoryId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := h.mgr.Stop(req.FactoryID); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	factoryID := r.URL.Query().Get("factoryId")
	running, dsID := h.mgr.Status(factoryID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"running":      running,
		"factoryId":    factoryID,
		"dataSourceId": dsID,
	})
}
