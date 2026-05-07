package api

import (
	"factory-simulation/simulation-core/internal/simulation"
	"factory-simulation/simulation-core/internal/wdhexport"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type ExportWDHRequest struct {
	BaseTime *string `json:"baseTime"`
}

func (h *Handler) HandleExportWDH(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/simulations/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[0] == "" {
		respondError(w, http.StatusBadRequest, "Simulation ID is required")
		return
	}
	simulationID := parts[0]

	sim, err := h.repo.GetSimulation(simulationID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Sprintf("Simulation not found: %v", err))
		return
	}

	if sim.Status != "completed" {
		respondError(w, http.StatusBadRequest, "Simulation is not completed")
		return
	}

	scenario, err := h.repo.GetScenarioWithPassword(sim.ScenarioID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get scenario: %v", err))
		return
	}

	flatScenario := simulation.FlattenScenario(scenario)

	workEvents, err := h.repo.GetWorkEvents(simulationID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get work events: %v", err))
		return
	}

	lineageLogs, err := h.repo.GetWorkLineage(simulationID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get lineage: %v", err))
		return
	}

	statusLogs, err := h.repo.GetStationStatusLogs(simulationID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get status logs: %v", err))
		return
	}

	baseTime := sim.CreatedAt

	var req ExportWDHRequest
	if r.Body != nil && r.ContentLength > 0 {
		if err := parseJSON(r, &req); err == nil && req.BaseTime != nil {
			if parsed, err := time.Parse(time.RFC3339, *req.BaseTime); err == nil {
				baseTime = parsed
			}
		}
	}

	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "postgres")

	exporter := wdhexport.NewExporter(wdhexport.ExportConfig{
		Host:     dbHost,
		Port:     dbPort,
		User:     dbUser,
		Password: dbPassword,
		BaseTime: baseTime,
	})

	result, err := exporter.Export(wdhexport.ExportInput{
		SimulationID:      simulationID,
		Scenario:          flatScenario,
		WorkEvents:        workEvents,
		LineageLogs:       lineageLogs,
		StationStatusLogs: statusLogs,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Export failed: %v", err))
		return
	}

	respondJSON(w, http.StatusOK, result)
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
