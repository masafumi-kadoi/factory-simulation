package api

import (
	"factory-simulation/simulation-core/internal/simulation"
	"factory-simulation/simulation-core/internal/wdhexport"
	"fmt"
	"log"
	"net/http"
	"time"
)

// RunRequest is the internal request from realtime-gateway
type RunRequest struct {
	FactoryID         string                             `json:"factoryId"`
	DataSourceID      string                             `json:"dataSourceId"`
	SimulationTime    float64                            `json:"simulationTime"`
	StartDatetime     string                             `json:"startDatetime"`
	InitialConditions map[string]InitialConditionStation `json:"initialConditions"`
}

// HandleRun handles POST /run (internal endpoint called by realtime-gateway)
func (h *Handler) HandleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Disable the per-connection WriteTimeout for this long-running handler.
	// The global WriteTimeout (5 min) would fire before a long simulation finishes,
	// causing the gateway to mark the execution "failed" even though simulation data
	// was successfully written to DB.
	rc := http.NewResponseController(w)
	if err := rc.SetWriteDeadline(time.Time{}); err != nil {
		log.Printf("[run] warning: failed to clear write deadline: %v", err)
	}

	var req RunRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.FactoryID == "" {
		respondError(w, http.StatusBadRequest, "factoryId is required")
		return
	}
	if req.DataSourceID == "" {
		respondError(w, http.StatusBadRequest, "dataSourceId is required")
		return
	}
	if req.SimulationTime <= 0 {
		req.SimulationTime = 86400 // default 24h
	}

	// Parse baseTime — accept RFC3339 (with timezone) or bare datetime (treated as UTC)
	baseTime := time.Now()
	if req.StartDatetime != "" {
		if t, err := time.Parse(time.RFC3339, req.StartDatetime); err == nil {
			baseTime = t
		} else if t, err := time.Parse("2006-01-02T15:04:05", req.StartDatetime); err == nil {
			baseTime = t.UTC()
		}
	}

	scenario, fetchErr := h.repo.GetScenarioFromFactory(req.FactoryID)
	if fetchErr != nil {
		respondError(w, http.StatusNotFound, fetchErr.Error())
		return
	}

	// Build initial conditions
	workIDsByStation := make(map[string][]string)
	initialWorks := make(map[string]simulation.InitialWorkCondition)
	for stationID, cond := range req.InitialConditions {
		if len(cond.WorkIDs) > 0 {
			workIDsByStation[stationID] = cond.WorkIDs
		}
		if cond.CurrentWork != nil && cond.CurrentWork.ID != "" {
			initialWorks[stationID] = simulation.InitialWorkCondition{
				WorkID:        cond.CurrentWork.ID,
				QualityStatus: cond.CurrentWork.QualityStatus,
				ElapsedTime:   cond.ElapsedTime,
			}
		}
	}

	// Run simulation
	simID := req.DataSourceID // use data_source_id as simulation ID
	dsShort := req.DataSourceID
	if len(dsShort) > 8 {
		dsShort = dsShort[:8]
	}
	friendlyName := fmt.Sprintf("sim_%s", dsShort)
	engine := simulation.NewEngineWithInitialConditions(scenario, workIDsByStation, initialWorks)
	_, statusLogs, workEvents, lineageLogs, err := engine.Run(simID, friendlyName, req.SimulationTime)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("simulation failed: %v", err))
		return
	}

	// Flatten scenario for WDH export
	flatScenario := simulation.FlattenScenario(scenario)

	// Write to WDH tables
	writer := wdhexport.NewDirectWriter(h.repo.GetDBConn(), req.DataSourceID, baseTime)
	input := wdhexport.WriteInput{
		Scenario:          flatScenario,
		WorkEvents:        workEvents,
		LineageLogs:       lineageLogs,
		StationStatusLogs: statusLogs,
	}
	if err := writer.Write(input); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("failed to write WDH: %v", err))
		return
	}

	log.Printf("[run] completed: dataSourceId=%s events=%d signals=%d",
		req.DataSourceID, len(workEvents), len(statusLogs))

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"dataSourceId": req.DataSourceID,
		"status":       "completed",
		"workEvents":   len(workEvents),
		"signalEvents": len(statusLogs),
	})
}
