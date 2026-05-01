package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"testing"
)

// === Phase 2-4: Moduler signal derivation tests ===

func newModulerWithInternals(inputMonitors, outputMonitors []string) (*domain.Scenario, *domain.Station) {
	// Create a Moduler with 3 internal stations: entry, proc, exit
	entry := domain.NewStation("mod-1.entry-0", domain.StationTypeEntry, map[string]interface{}{})
	entry.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeEntry)
	entry.InitializeSignals()

	proc := domain.NewStation("mod-1.proc-1", domain.StationTypeProcessing, map[string]interface{}{})
	proc.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeProcessing)
	proc.InitializeSignals()

	exit := domain.NewStation("mod-1.exit-0", domain.StationTypeExit, map[string]interface{}{})
	exit.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeExit)
	exit.InitializeSignals()

	inputMonitorInterfaces := make([]interface{}, len(inputMonitors))
	for i, s := range inputMonitors {
		inputMonitorInterfaces[i] = s
	}
	outputMonitorInterfaces := make([]interface{}, len(outputMonitors))
	for i, s := range outputMonitors {
		outputMonitorInterfaces[i] = s
	}

	moduler := domain.NewStation("mod-1", domain.StationTypeModuler, map[string]interface{}{
		"inputMonitorStationIds":  inputMonitorInterfaces,
		"outputMonitorStationIds": outputMonitorInterfaces,
	})
	moduler.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeModuler)
	moduler.InitializeSignals()
	moduler.InternalStationIDs = []string{"mod-1.entry-0", "mod-1.proc-1", "mod-1.exit-0"}

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*moduler, *entry, *proc, *exit},
	}

	return scenario, &scenario.Stations[0]
}

func TestDeriveModulerSignals_InputMonitor(t *testing.T) {
	scenario, moduler := newModulerWithInternals(
		[]string{"mod-1.entry-0"},
		[]string{"mod-1.exit-0"},
	)

	// No work anywhere → all false
	deriveModulerSignals(moduler, scenario)
	if moduler.GetSignal(domain.SignalInputWorkPresent) {
		t.Error("expected IWP=OFF when no work at input monitor")
	}

	// Place work at entry (input monitor)
	entryStation := scenario.GetStation("mod-1.entry-0")
	entryStation.SetWork(domain.NewWork("w1", "work-1"))
	entryStation.SetSignal(domain.SignalInputWorkPresent, true)

	deriveModulerSignals(moduler, scenario)
	if !moduler.GetSignal(domain.SignalInputWorkPresent) {
		t.Error("expected IWP=ON when work at input monitor station")
	}
}

func TestDeriveModulerSignals_OutputMonitor(t *testing.T) {
	scenario, moduler := newModulerWithInternals(
		[]string{"mod-1.entry-0"},
		[]string{"mod-1.exit-0"},
	)

	// Place work at exit (output monitor)
	exitStation := scenario.GetStation("mod-1.exit-0")
	exitStation.SetWork(domain.NewWork("w1", "work-1"))
	exitStation.SetSignal(domain.SignalInputWorkPresent, true)

	deriveModulerSignals(moduler, scenario)
	if !moduler.GetSignal(domain.SignalOutputWorkPresent) {
		t.Error("expected OWP=ON when work at output monitor station")
	}
}

func TestDeriveModulerSignals_ProcessingWork(t *testing.T) {
	scenario, moduler := newModulerWithInternals(
		[]string{"mod-1.entry-0"},
		[]string{"mod-1.exit-0"},
	)

	// Place work at proc (non-monitor internal station)
	procStation := scenario.GetStation("mod-1.proc-1")
	procStation.SetWork(domain.NewWork("w1", "work-1"))
	procStation.SetSignal(domain.SignalInputWorkPresent, true)

	deriveModulerSignals(moduler, scenario)
	if !moduler.GetSignal(domain.SignalProcessingWorkPresent) {
		t.Error("expected PWP=ON when work at non-monitor internal station")
	}
	if moduler.GetSignal(domain.SignalInputWorkPresent) {
		t.Error("expected IWP=OFF (proc is not input monitor)")
	}
}

func TestDeriveModulerSignals_Running(t *testing.T) {
	scenario, moduler := newModulerWithInternals(
		[]string{"mod-1.entry-0"},
		[]string{"mod-1.exit-0"},
	)

	// Set proc to running
	procStation := scenario.GetStation("mod-1.proc-1")
	procStation.SetSignal(domain.SignalRunning, true)

	deriveModulerSignals(moduler, scenario)
	if !moduler.GetSignal(domain.SignalRunning) {
		t.Error("expected RUN=ON when any internal station is running")
	}

	// Turn off running
	procStation.SetSignal(domain.SignalRunning, false)
	deriveModulerSignals(moduler, scenario)
	if moduler.GetSignal(domain.SignalRunning) {
		t.Error("expected RUN=OFF when no internal station is running")
	}
}

// === Phase 2-5: Edge case tests ===

func TestDeriveModulerSignals_EmptyInternals(t *testing.T) {
	moduler := domain.NewStation("mod-empty", domain.StationTypeModuler, map[string]interface{}{})
	moduler.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeModuler)
	moduler.InitializeSignals()
	moduler.InternalStationIDs = nil // empty

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*moduler},
	}

	// Should not panic
	deriveModulerSignals(&scenario.Stations[0], scenario)

	if scenario.Stations[0].GetSignal(domain.SignalInputWorkPresent) {
		t.Error("expected all signals OFF for empty Moduler")
	}
}

func TestDeriveModulerSignals_NonexistentMonitorID(t *testing.T) {
	moduler := domain.NewStation("mod-1", domain.StationTypeModuler, map[string]interface{}{
		"inputMonitorStationIds":  []interface{}{"nonexistent-station"},
		"outputMonitorStationIds": []interface{}{},
	})
	moduler.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeModuler)
	moduler.InitializeSignals()
	moduler.InternalStationIDs = []string{"mod-1.proc-1"}

	proc := domain.NewStation("mod-1.proc-1", domain.StationTypeProcessing, map[string]interface{}{})
	proc.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeProcessing)
	proc.InitializeSignals()
	proc.SetWork(domain.NewWork("w1", "work-1"))
	proc.SetSignal(domain.SignalInputWorkPresent, true)

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*moduler, *proc},
	}

	// Should not panic; proc is not in any monitor set → goes to processing
	deriveModulerSignals(&scenario.Stations[0], scenario)
	if !scenario.Stations[0].GetSignal(domain.SignalProcessingWorkPresent) {
		t.Error("expected PWP=ON (proc is not in any monitor set)")
	}
}

func TestIsInternalStation(t *testing.T) {
	// Test with stationModulerMap (map-based lookup)
	e := &Engine{
		stationModulerMap: map[string]string{
			"mod-1.proc-1":         "mod-1",
			"outer.inner.proc-1":   "outer.inner",
		},
	}
	if !e.isInternalStation("mod-1.proc-1") {
		t.Error("expected true for mod-1.proc-1")
	}
	if e.isInternalStation("proc-1") {
		t.Error("expected false for proc-1")
	}
	if !e.isInternalStation("outer.inner.proc-1") {
		t.Error("expected true for nested station ID")
	}

	// Test fallback (nil map → dot-based check)
	eFallback := &Engine{}
	if !eFallback.isInternalStation("mod-1.proc-1") {
		t.Error("fallback: expected true for mod-1.proc-1")
	}
	if eFallback.isInternalStation("proc-1") {
		t.Error("fallback: expected false for proc-1")
	}
}

func TestDeriveModulerSignals_NestedModuler(t *testing.T) {
	// Outer Moduler contains an inner Moduler
	// Inner Moduler's signals should propagate to outer Moduler
	innerEntry := domain.NewStation("outer.inner.entry-0", domain.StationTypeEntry, map[string]interface{}{})
	innerEntry.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeEntry)
	innerEntry.InitializeSignals()

	innerProc := domain.NewStation("outer.inner.proc-1", domain.StationTypeProcessing, map[string]interface{}{})
	innerProc.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeProcessing)
	innerProc.InitializeSignals()

	innerModuler := domain.NewStation("outer.inner", domain.StationTypeModuler, map[string]interface{}{
		"inputMonitorStationIds":  []interface{}{"outer.inner.entry-0"},
		"outputMonitorStationIds": []interface{}{},
	})
	innerModuler.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeModuler)
	innerModuler.InitializeSignals()
	innerModuler.InternalStationIDs = []string{"outer.inner.entry-0", "outer.inner.proc-1"}

	outerModuler := domain.NewStation("outer", domain.StationTypeModuler, map[string]interface{}{
		"inputMonitorStationIds":  []interface{}{"outer.inner"},
		"outputMonitorStationIds": []interface{}{},
	})
	outerModuler.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeModuler)
	outerModuler.InitializeSignals()
	outerModuler.InternalStationIDs = []string{"outer.inner", "outer.inner.entry-0", "outer.inner.proc-1"}

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*outerModuler, *innerModuler, *innerEntry, *innerProc},
	}

	// Set work at inner entry
	entryStation := scenario.GetStation("outer.inner.entry-0")
	entryStation.SetWork(domain.NewWork("w1", "work-1"))
	entryStation.SetSignal(domain.SignalInputWorkPresent, true)

	// Derive inner Moduler signals first
	innerMod := scenario.GetStation("outer.inner")
	deriveModulerSignals(innerMod, scenario)

	if !innerMod.GetSignal(domain.SignalInputWorkPresent) {
		t.Error("expected inner Moduler IWP=ON")
	}

	// Now derive outer Moduler signals (inner Moduler is an input monitor)
	outerMod := &scenario.Stations[0]
	deriveModulerSignals(outerMod, scenario)

	// Inner Moduler has IWP=ON → outer sees it as having work at its input monitor
	if !outerMod.GetSignal(domain.SignalInputWorkPresent) {
		t.Error("expected outer Moduler IWP=ON (inner Moduler has IWP=ON)")
	}
}

func TestFlatten_SetsInternalStationIDs(t *testing.T) {
	// Create a simple Moduler with SubScenario
	entry := domain.Station{
		ID:   "entry-0",
		Type: domain.StationTypeEntry,
	}
	proc := domain.Station{
		ID:     "proc-1",
		Type:   domain.StationTypeProcessing,
		Config: map[string]interface{}{},
	}
	exit := domain.Station{
		ID:   "exit-0",
		Type: domain.StationTypeExit,
	}

	moduler := domain.Station{
		ID:         "mod-1",
		Type:       domain.StationTypeModuler,
		EntryCount: 1,
		ExitCount:  1,
		Config: map[string]interface{}{
			"inputMonitorStationIds":  []interface{}{"entry-0"},
			"outputMonitorStationIds": []interface{}{"exit-0"},
		},
		SubScenario: &domain.SubScenario{
			Stations:    []domain.Station{entry, proc, exit},
			Connections: []domain.Connection{},
		},
	}

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{moduler},
	}

	flat := FlattenScenario(scenario)

	// Find the Moduler in flattened stations
	var flatModuler *domain.Station
	for i := range flat.Stations {
		if flat.Stations[i].ID == "mod-1" {
			flatModuler = &flat.Stations[i]
			break
		}
	}

	if flatModuler == nil {
		t.Fatal("expected mod-1 in flattened stations")
	}

	if len(flatModuler.InternalStationIDs) != 3 {
		t.Errorf("expected 3 internal station IDs, got %d", len(flatModuler.InternalStationIDs))
	}

	// Check monitor station IDs are prefixed
	inputMonitors := getStringSliceConfig(flatModuler, "inputMonitorStationIds")
	if len(inputMonitors) != 1 || inputMonitors[0] != "mod-1.entry-0" {
		t.Errorf("expected prefixed input monitor [mod-1.entry-0], got %v", inputMonitors)
	}

	outputMonitors := getStringSliceConfig(flatModuler, "outputMonitorStationIds")
	if len(outputMonitors) != 1 || outputMonitors[0] != "mod-1.exit-0" {
		t.Errorf("expected prefixed output monitor [mod-1.exit-0], got %v", outputMonitors)
	}
}
