package simulation

import (
	"fmt"
	"testing"

	"factory-simulation/simulation-core/internal/domain"
)

// ===========================================================
// Helper functions for complex scenario construction
// ===========================================================

func cstn(t domain.StationType, id string, cfg map[string]interface{}) domain.Station {
	return *domain.NewStation(id, t, cfg)
}

func cSrc(id, workType string, workCount int) domain.Station {
	return cstn(domain.StationTypeSource, id, map[string]interface{}{
		"workType": workType, "workCount": float64(workCount), "departureTime": 0.5,
	})
}

func cProc(id string, arrT, procT, depT float64) domain.Station {
	return cstn(domain.StationTypeProcessing, id, map[string]interface{}{
		"arrivalTime": arrT, "processingTime": procT, "departureTime": depT,
	})
}

func cDrain(id string) domain.Station {
	return cstn(domain.StationTypeDrain, id, map[string]interface{}{"arrivalTime": 0.5})
}

func cMerge2(id string, procT float64, outputType string) domain.Station {
	return cstn(domain.StationTypeMerge, id, map[string]interface{}{
		"mergeCount": float64(2), "processingTime": procT,
		"arrivalTime": 0.5, "departureTime": 0.5,
		"outputWorkType": outputType,
		"inPorts": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	})
}

func cSplit2(id string, procT float64) domain.Station {
	return cstn(domain.StationTypeSplit, id, map[string]interface{}{
		"splitCount": float64(2), "processingTime": procT,
		"arrivalTime": 0.5, "departureTime": 0.5,
		"outPorts": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	})
}

func mkC(from, to string, fp, tp int) domain.Connection {
	return domain.Connection{From: from, To: to, Condition: domain.RoutingDefault, FromPortIndex: fp, ToPortIndex: tp}
}

// moduler12 creates a Moduler station with 12 internal stations:
// entry → p0 → p1 → ... → p9 → exit  (1 entry + 10 proc + 1 exit)
func moduler12(id string, procT float64) domain.Station {
	p := func(pid string) domain.Station {
		return cstn(domain.StationTypeProcessing, pid, map[string]interface{}{
			"arrivalTime": 0.3, "processingTime": procT, "departureTime": 0.3,
		})
	}
	internal := []domain.Station{
		cstn(domain.StationTypeEntry, "entry", map[string]interface{}{}),
		p("p0"), p("p1"), p("p2"), p("p3"), p("p4"),
		p("p5"), p("p6"), p("p7"), p("p8"), p("p9"),
		cstn(domain.StationTypeExit, "exit", map[string]interface{}{}),
	}
	conns := []domain.Connection{
		mkC("entry", "p0", -1, -1),
		mkC("p0", "p1", -1, -1), mkC("p1", "p2", -1, -1), mkC("p2", "p3", -1, -1),
		mkC("p3", "p4", -1, -1), mkC("p4", "p5", -1, -1), mkC("p5", "p6", -1, -1),
		mkC("p6", "p7", -1, -1), mkC("p7", "p8", -1, -1), mkC("p8", "p9", -1, -1),
		mkC("p9", "exit", -1, -1),
	}
	return domain.Station{
		ID: id, Type: domain.StationTypeModuler,
		InPorts:  []domain.Port{{Capacity: 1}},
		OutPorts: []domain.Port{{Capacity: 1}},
		Config:   map[string]interface{}{},
		SubScenario: &domain.SubScenario{
			Stations:    internal,
			Connections: conns,
		},
		EntryCount: 1, ExitCount: 1,
	}
}

func cTotalDestroyed(events []WorkEventLog) int {
	n := 0
	for _, e := range events {
		if e.EventType == string(EventWorkDestroyed) {
			n++
		}
	}
	return n
}

func runComplexScenario(t *testing.T, scenario *domain.Scenario, simID string, timeLimit float64) []WorkEventLog {
	t.Helper()
	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run(simID, simID, timeLimit)
	if err != nil {
		t.Fatalf("[%s] simulation failed: %v", simID, err)
	}
	destroyed := cTotalDestroyed(workEvents)
	t.Logf("[%s] works destroyed: %d", simID, destroyed)
	if destroyed == 0 {
		t.Errorf("[%s] expected at least 1 work destroyed, got 0", simID)
		for _, we := range workEvents {
			t.Logf("  [%.1f] %s %s type=%s station=%s port=%d", we.Timestamp, we.EventType, we.WorkFriendlyName, we.WorkType, we.StationID, we.PortIndex)
		}
	}
	return workEvents
}

// buildBaseScenario builds the common 103-station topology:
//
//	srcA → pA1→pA2→pA3 ─┐
//	srcB → pB1→pB2→pB3 ─┤→ mergeAB → mod1 → pC1→pC2 ─┐
//	                                                      ├→ mergeAll → mod3 → split1
//	srcC → pD1→pD2 → mod2 ──────────────────────────────┘
//	  split1 port0 → pE1→pE2→pE3 → mod4 → pF1→pF2 → drain1
//	  split1 port1 → pG1→pG2→pG3 → mod5 → pH1→pH2 → drain2
//	srcD → pI1→pI2→pI3 → drain3
//	srcE → pJ1→pJ2→pJ3 → drain4
//
// Total: 5 src + 26 proc + 2 merge + 1 split + 5×13 Moduler + 4 drain = 103 stations
func buildBaseScenario(id, name string,
	typeA, typeB, typeC, typeD, typeE string,
	typeAB, typeAll string,
	pt1, pt2, pt3 float64, // Moduler processing times
) *domain.Scenario {
	stations := []domain.Station{
		// Sources
		cSrc("srcA", typeA, 2), cSrc("srcB", typeB, 2),
		cSrc("srcC", typeC, 2), cSrc("srcD", typeD, 2), cSrc("srcE", typeE, 2),

		// Path A: srcA processing chain
		cProc("pA1", 0.5, pt1, 0.5), cProc("pA2", 0.5, pt1, 0.5), cProc("pA3", 0.5, pt1, 0.5),
		// Path B: srcB processing chain
		cProc("pB1", 0.5, pt2, 0.5), cProc("pB2", 0.5, pt2, 0.5), cProc("pB3", 0.5, pt2, 0.5),

		// Merge A+B
		cMerge2("mergeAB", pt1, typeAB),

		// mod1: processes merged AB
		moduler12("mod1", pt1),

		// Post-mod1 processing before final merge
		cProc("pC1", 0.5, pt2, 0.5), cProc("pC2", 0.5, pt2, 0.5),

		// Path C: srcC chain
		cProc("pD1", 0.5, pt3, 0.5), cProc("pD2", 0.5, pt3, 0.5),

		// mod2: processes C before merging with AB
		moduler12("mod2", pt3),

		// Merge (mod1-output) + (mod2-output)
		cMerge2("mergeAll", pt2, typeAll),

		// mod3: main assembly
		moduler12("mod3", pt2),

		// Split into 2 output lines
		cSplit2("split1", pt1),

		// Output line 1 (port 0)
		cProc("pE1", 0.5, pt1, 0.5), cProc("pE2", 0.5, pt2, 0.5), cProc("pE3", 0.5, pt3, 0.5),
		moduler12("mod4", pt3),
		cProc("pF1", 0.5, pt1, 0.5), cProc("pF2", 0.5, pt2, 0.5),
		cDrain("drain1"),

		// Output line 2 (port 1)
		cProc("pG1", 0.5, pt2, 0.5), cProc("pG2", 0.5, pt3, 0.5), cProc("pG3", 0.5, pt1, 0.5),
		moduler12("mod5", pt1),
		cProc("pH1", 0.5, pt3, 0.5), cProc("pH2", 0.5, pt1, 0.5),
		cDrain("drain2"),

		// Independent line D
		cProc("pI1", 0.5, pt1, 0.5), cProc("pI2", 0.5, pt2, 0.5), cProc("pI3", 0.5, pt3, 0.5),
		cDrain("drain3"),

		// Independent line E
		cProc("pJ1", 0.5, pt3, 0.5), cProc("pJ2", 0.5, pt1, 0.5), cProc("pJ3", 0.5, pt2, 0.5),
		cDrain("drain4"),
	}

	connections := []domain.Connection{
		// Path A → mergeAB port 0
		mkC("srcA", "pA1", -1, -1), mkC("pA1", "pA2", -1, -1), mkC("pA2", "pA3", -1, -1),
		mkC("pA3", "mergeAB", -1, 0),
		// Path B → mergeAB port 1
		mkC("srcB", "pB1", -1, -1), mkC("pB1", "pB2", -1, -1), mkC("pB2", "pB3", -1, -1),
		mkC("pB3", "mergeAB", -1, 1),
		// mergeAB → mod1 → pC1 → pC2 → mergeAll port 0
		mkC("mergeAB", "mod1", -1, -1),
		mkC("mod1", "pC1", -1, -1), mkC("pC1", "pC2", -1, -1),
		mkC("pC2", "mergeAll", -1, 0),
		// Path C → mod2 → mergeAll port 1
		mkC("srcC", "pD1", -1, -1), mkC("pD1", "pD2", -1, -1),
		mkC("pD2", "mod2", -1, -1),
		mkC("mod2", "mergeAll", -1, 1),
		// mergeAll → mod3 → split1
		mkC("mergeAll", "mod3", -1, -1),
		mkC("mod3", "split1", -1, -1),
		// split1 port 0 → line 1 → drain1
		mkC("split1", "pE1", 0, -1), mkC("pE1", "pE2", -1, -1), mkC("pE2", "pE3", -1, -1),
		mkC("pE3", "mod4", -1, -1),
		mkC("mod4", "pF1", -1, -1), mkC("pF1", "pF2", -1, -1), mkC("pF2", "drain1", -1, -1),
		// split1 port 1 → line 2 → drain2
		mkC("split1", "pG1", 1, -1), mkC("pG1", "pG2", -1, -1), mkC("pG2", "pG3", -1, -1),
		mkC("pG3", "mod5", -1, -1),
		mkC("mod5", "pH1", -1, -1), mkC("pH1", "pH2", -1, -1), mkC("pH2", "drain2", -1, -1),
		// Independent line D → drain3
		mkC("srcD", "pI1", -1, -1), mkC("pI1", "pI2", -1, -1), mkC("pI2", "pI3", -1, -1),
		mkC("pI3", "drain3", -1, -1),
		// Independent line E → drain4
		mkC("srcE", "pJ1", -1, -1), mkC("pJ1", "pJ2", -1, -1), mkC("pJ2", "pJ3", -1, -1),
		mkC("pJ3", "drain4", -1, -1),
	}

	return &domain.Scenario{ID: id, Name: name, Stations: stations, Connections: connections}
}

// ===========================================================
// Scenario 01: 自動車エンジン組立ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario01(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-01", "自動車エンジン組立ライン",
		"engine-block", "piston", "crankshaft", "camshaft", "valve",
		"engine-sub", "engine-complete",
		1.0, 1.5, 2.0,
	)
	runComplexScenario(t, scenario, "sim-01", 300.0)
}

// ===========================================================
// Scenario 02: 電子基板製造ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario02(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-02", "電子基板製造ライン",
		"pcb-base", "ic-chip", "resistor", "capacitor", "connector",
		"pcb-mounted", "pcb-complete",
		0.8, 1.2, 1.6,
	)
	runComplexScenario(t, scenario, "sim-02", 300.0)
}

// ===========================================================
// Scenario 03: 食品加工ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario03(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-03", "食品加工ライン",
		"raw-meat", "seasoning", "packaging-material", "sauce", "label",
		"seasoned-meat", "packaged-food",
		1.2, 0.9, 1.8,
	)
	runComplexScenario(t, scenario, "sim-03", 300.0)
}

// ===========================================================
// Scenario 04: 薬品製造ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario04(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-04", "薬品製造ライン",
		"api", "excipient", "coating", "capsule", "packaging",
		"tablet-core", "finished-tablet",
		2.0, 1.5, 1.0,
	)
	runComplexScenario(t, scenario, "sim-04", 300.0)
}

// ===========================================================
// Scenario 05: 半導体製造ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario05(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-05", "半導体製造ライン",
		"wafer", "dopant", "metal-layer", "photo-resist", "dielectric",
		"doped-wafer", "finished-wafer",
		1.5, 2.0, 2.5,
	)
	runComplexScenario(t, scenario, "sim-05", 300.0)
}

// ===========================================================
// Scenario 06: 家電製品組立ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario06(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-06", "家電製品組立ライン",
		"chassis", "motor", "electronics", "display", "casing",
		"motor-assembly", "finished-appliance",
		0.8, 1.0, 1.4,
	)
	runComplexScenario(t, scenario, "sim-06", 300.0)
}

// ===========================================================
// Scenario 07: 航空機部品製造ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario07(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-07", "航空機部品製造ライン",
		"titanium-billet", "composite-sheet", "fastener", "seal", "wire-harness",
		"structural-sub", "aircraft-component",
		3.0, 2.0, 2.5,
	)
	runComplexScenario(t, scenario, "sim-07", 400.0)
}

// ===========================================================
// Scenario 08: 精密機械製造（時計部品）(~103 stations)
// ===========================================================
func TestComplex_Scenario08(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-08", "精密機械製造ライン",
		"gear-blank", "spring-steel", "jewel", "mainspring", "escapement",
		"gear-assembly", "watch-movement",
		0.5, 0.8, 1.2,
	)
	runComplexScenario(t, scenario, "sim-08", 300.0)
}

// ===========================================================
// Scenario 09: 複合素材製造ライン (~103 stations)
// ===========================================================
func TestComplex_Scenario09(t *testing.T) {
	scenario := buildBaseScenario(
		"complex-09", "複合素材製造ライン",
		"carbon-fiber", "resin", "core-material", "adhesive", "release-film",
		"composite-layup", "finished-composite",
		2.5, 3.0, 1.5,
	)
	runComplexScenario(t, scenario, "sim-09", 400.0)
}

// ===========================================================
// Scenario 10: 完全自動化工場（多品種） — 拡張トポロジー (~120 stations)
// 3つのMerge、2つのSplit、6つのModuler
// ===========================================================
func TestComplex_Scenario10(t *testing.T) {
	// Extended topology:
	// LineX: srcX1→px1→px2 ─┐
	//                         ├→ mergeX → modX1 → px3→px4 ─┐
	// LineY: srcY1→py1→py2 ─┘                               ├→ mergeXY → modZ1 → splitZ
	// LineZ: srcZ1→pz1→pz2 → modZ0 ──────────────────────────┘
	//   splitZ port0 → pOut1→pOut2→pOut3 → modOut1 → pOut4→pOut5 → drain-a
	//   splitZ port1 → pQa1→pQa2→pQa3 → modOut2 → pQa4→pQa5 → drain-b
	//
	// LineA: srcA1→pa1→pa2→pa3 ─┐
	//                             ├→ mergeA → modA1 → pa4→pa5→pa6 → splitA
	// LineB: srcB1→pb1→pb2→pb3 ─┘
	//   splitA port0 → pad1→pad2 → modA2 → pad3→pad4 → drain-c
	//   splitA port1 → pbe1→pbe2 → modA3 → pbe3→pbe4 → drain-d
	//
	// Independent: srcI1→pi1→pi2→pi3→pi4→pi5 → drain-e
	// Independent: srcJ1→pj1→pj2→pj3→pj4→pj5 → drain-f

	stations := []domain.Station{
		// --- Group XYZ ---
		cSrc("srcX1", "type-x", 2), cSrc("srcY1", "type-y", 2), cSrc("srcZ1", "type-z", 2),
		cProc("px1", 0.5, 1.0, 0.5), cProc("px2", 0.5, 1.2, 0.5),
		cProc("py1", 0.5, 0.8, 0.5), cProc("py2", 0.5, 1.0, 0.5),
		cMerge2("mergeX", 1.5, "type-xy"),
		moduler12("modX1", 1.0),
		cProc("px3", 0.5, 1.2, 0.5), cProc("px4", 0.5, 1.0, 0.5),
		cProc("pz1", 0.5, 2.0, 0.5), cProc("pz2", 0.5, 1.5, 0.5),
		moduler12("modZ0", 1.5),
		cMerge2("mergeXY", 1.5, "type-xyz"),
		moduler12("modZ1", 1.2),
		cSplit2("splitZ", 1.0),
		cProc("pOut1", 0.5, 1.0, 0.5), cProc("pOut2", 0.5, 0.8, 0.5), cProc("pOut3", 0.5, 1.2, 0.5),
		moduler12("modOut1", 0.8),
		cProc("pOut4", 0.5, 1.0, 0.5), cProc("pOut5", 0.5, 0.8, 0.5),
		cDrain("drain-a"),
		cProc("pQa1", 0.5, 1.5, 0.5), cProc("pQa2", 0.5, 1.0, 0.5), cProc("pQa3", 0.5, 0.8, 0.5),
		moduler12("modOut2", 1.0),
		cProc("pQa4", 0.5, 1.2, 0.5), cProc("pQa5", 0.5, 1.0, 0.5),
		cDrain("drain-b"),

		// --- Group AB ---
		cSrc("srcA1", "type-a", 2), cSrc("srcB1", "type-b", 2),
		cProc("pa1", 0.5, 1.0, 0.5), cProc("pa2", 0.5, 1.2, 0.5), cProc("pa3", 0.5, 0.8, 0.5),
		cProc("pb1", 0.5, 0.9, 0.5), cProc("pb2", 0.5, 1.1, 0.5), cProc("pb3", 0.5, 1.3, 0.5),
		cMerge2("mergeA", 1.5, "type-ab"),
		moduler12("modA1", 1.0),
		cProc("pa4", 0.5, 1.0, 0.5), cProc("pa5", 0.5, 1.2, 0.5), cProc("pa6", 0.5, 0.8, 0.5),
		cSplit2("splitA", 1.0),
		cProc("pad1", 0.5, 1.0, 0.5), cProc("pad2", 0.5, 0.8, 0.5),
		moduler12("modA2", 1.0),
		cProc("pad3", 0.5, 1.2, 0.5), cProc("pad4", 0.5, 1.0, 0.5),
		cDrain("drain-c"),
		cProc("pbe1", 0.5, 1.0, 0.5), cProc("pbe2", 0.5, 1.2, 0.5),
		moduler12("modA3", 1.0),
		cProc("pbe3", 0.5, 0.8, 0.5), cProc("pbe4", 0.5, 1.0, 0.5),
		cDrain("drain-d"),

		// --- Independent lines ---
		cSrc("srcI1", "type-i", 2),
		cProc("pi1", 0.5, 1.0, 0.5), cProc("pi2", 0.5, 1.2, 0.5), cProc("pi3", 0.5, 0.8, 0.5),
		cProc("pi4", 0.5, 1.0, 0.5), cProc("pi5", 0.5, 1.2, 0.5),
		cDrain("drain-e"),

		cSrc("srcJ1", "type-j", 2),
		cProc("pj1", 0.5, 1.0, 0.5), cProc("pj2", 0.5, 0.8, 0.5), cProc("pj3", 0.5, 1.2, 0.5),
		cProc("pj4", 0.5, 1.0, 0.5), cProc("pj5", 0.5, 0.8, 0.5),
		cDrain("drain-f"),
	}

	connections := []domain.Connection{
		// Group XYZ
		mkC("srcX1", "px1", -1, -1), mkC("px1", "px2", -1, -1), mkC("px2", "mergeX", -1, 0),
		mkC("srcY1", "py1", -1, -1), mkC("py1", "py2", -1, -1), mkC("py2", "mergeX", -1, 1),
		mkC("mergeX", "modX1", -1, -1),
		mkC("modX1", "px3", -1, -1), mkC("px3", "px4", -1, -1),
		mkC("px4", "mergeXY", -1, 0),
		mkC("srcZ1", "pz1", -1, -1), mkC("pz1", "pz2", -1, -1),
		mkC("pz2", "modZ0", -1, -1),
		mkC("modZ0", "mergeXY", -1, 1),
		mkC("mergeXY", "modZ1", -1, -1),
		mkC("modZ1", "splitZ", -1, -1),
		mkC("splitZ", "pOut1", 0, -1),
		mkC("pOut1", "pOut2", -1, -1), mkC("pOut2", "pOut3", -1, -1),
		mkC("pOut3", "modOut1", -1, -1),
		mkC("modOut1", "pOut4", -1, -1), mkC("pOut4", "pOut5", -1, -1), mkC("pOut5", "drain-a", -1, -1),
		mkC("splitZ", "pQa1", 1, -1),
		mkC("pQa1", "pQa2", -1, -1), mkC("pQa2", "pQa3", -1, -1),
		mkC("pQa3", "modOut2", -1, -1),
		mkC("modOut2", "pQa4", -1, -1), mkC("pQa4", "pQa5", -1, -1), mkC("pQa5", "drain-b", -1, -1),

		// Group AB
		mkC("srcA1", "pa1", -1, -1), mkC("pa1", "pa2", -1, -1), mkC("pa2", "pa3", -1, -1),
		mkC("pa3", "mergeA", -1, 0),
		mkC("srcB1", "pb1", -1, -1), mkC("pb1", "pb2", -1, -1), mkC("pb2", "pb3", -1, -1),
		mkC("pb3", "mergeA", -1, 1),
		mkC("mergeA", "modA1", -1, -1),
		mkC("modA1", "pa4", -1, -1), mkC("pa4", "pa5", -1, -1), mkC("pa5", "pa6", -1, -1),
		mkC("pa6", "splitA", -1, -1),
		mkC("splitA", "pad1", 0, -1),
		mkC("pad1", "pad2", -1, -1),
		mkC("pad2", "modA2", -1, -1),
		mkC("modA2", "pad3", -1, -1), mkC("pad3", "pad4", -1, -1), mkC("pad4", "drain-c", -1, -1),
		mkC("splitA", "pbe1", 1, -1),
		mkC("pbe1", "pbe2", -1, -1),
		mkC("pbe2", "modA3", -1, -1),
		mkC("modA3", "pbe3", -1, -1), mkC("pbe3", "pbe4", -1, -1), mkC("pbe4", "drain-d", -1, -1),

		// Independent lines
		mkC("srcI1", "pi1", -1, -1), mkC("pi1", "pi2", -1, -1), mkC("pi2", "pi3", -1, -1),
		mkC("pi3", "pi4", -1, -1), mkC("pi4", "pi5", -1, -1), mkC("pi5", "drain-e", -1, -1),
		mkC("srcJ1", "pj1", -1, -1), mkC("pj1", "pj2", -1, -1), mkC("pj2", "pj3", -1, -1),
		mkC("pj3", "pj4", -1, -1), mkC("pj4", "pj5", -1, -1), mkC("pj5", "drain-f", -1, -1),
	}

	scenario := &domain.Scenario{ID: "complex-10", Name: "完全自動化工場", Stations: stations, Connections: connections}
	runComplexScenario(t, scenario, "sim-10", 400.0)
}

// Ensure fmt is used
var _ = fmt.Sprintf
