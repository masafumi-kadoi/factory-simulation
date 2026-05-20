// seed registers 10 complex factory simulation scenarios via the API.
// Usage: go run ./cmd/seed [--base-url http://localhost:8080]
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
)

var baseURL string

// ---------------------------------------------------------------
// API request types (mirrors simulation-core API)
// ---------------------------------------------------------------

type Station struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name,omitempty"`
	Type        string                 `json:"type"`
	ParentID    *string                `json:"parentId"`
	Config      map[string]interface{} `json:"config"`
	SubScenario *SubScenario           `json:"subScenario,omitempty"`
	EntryCount  int                    `json:"entryCount,omitempty"`
	ExitCount   int                    `json:"exitCount,omitempty"`
}

type SubScenario struct {
	Stations    []Station    `json:"stations"`
	Connections []Connection `json:"connections"`
}

type Connection struct {
	From          string `json:"from"`
	To            string `json:"to"`
	Condition     string `json:"condition"`
	FromPortIndex int    `json:"fromPortIndex"`
	ToPortIndex   int    `json:"toPortIndex"`
}

type ScenarioRequest struct {
	Name        string       `json:"name"`
	Stations    []Station    `json:"stations"`
	Connections []Connection `json:"connections"`
}

// ---------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------

func src(id, workType string, workCount int) Station {
	return Station{ID: id, Type: "source", Config: map[string]interface{}{
		"workType": workType, "workCount": float64(workCount), "departureTime": 0.5,
	}}
}

func proc(id string, arrT, procT, depT float64) Station {
	return Station{ID: id, Type: "processing", Config: map[string]interface{}{
		"arrivalTime": arrT, "processingTime": procT, "departureTime": depT,
	}}
}

func drain(id string) Station {
	return Station{ID: id, Type: "drain", Config: map[string]interface{}{"arrivalTime": 0.5}}
}

func merge2(id string, procT float64, outputType string) Station {
	return Station{ID: id, Type: "merge", Config: map[string]interface{}{
		"mergeCount": float64(2), "processingTime": procT,
		"arrivalTime": 0.5, "departureTime": 0.5,
		"outputWorkType": outputType,
		"inPorts": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}}
}

func split2(id string, procT float64) Station {
	return Station{ID: id, Type: "split", Config: map[string]interface{}{
		"splitCount": float64(2), "processingTime": procT,
		"arrivalTime": 0.5, "departureTime": 0.5,
		"outPorts": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}}
}

func conn(from, to string, fp, tp int) Connection {
	return Connection{From: from, To: to, Condition: "default", FromPortIndex: fp, ToPortIndex: tp}
}

// moduler12 creates a Moduler with 12 internal stations (entry + 10 proc + exit)
func machine12(id string, procT float64) Station {
	p := func(pid string) Station {
		return Station{ID: pid, Type: "processing", Config: map[string]interface{}{
			"arrivalTime": 0.3, "processingTime": procT, "departureTime": 0.3,
		}}
	}
	return Station{
		ID: id, Type: "machine",
		Config:     map[string]interface{}{},
		EntryCount: 1, ExitCount: 1,
		SubScenario: &SubScenario{
			Stations: []Station{
				{ID: "entry", Type: "entry", Config: map[string]interface{}{}},
				p("p0"), p("p1"), p("p2"), p("p3"), p("p4"),
				p("p5"), p("p6"), p("p7"), p("p8"), p("p9"),
				{ID: "exit", Type: "exit", Config: map[string]interface{}{}},
			},
			Connections: []Connection{
				conn("entry", "p0", -1, -1),
				conn("p0", "p1", -1, -1), conn("p1", "p2", -1, -1), conn("p2", "p3", -1, -1),
				conn("p3", "p4", -1, -1), conn("p4", "p5", -1, -1), conn("p5", "p6", -1, -1),
				conn("p6", "p7", -1, -1), conn("p7", "p8", -1, -1), conn("p8", "p9", -1, -1),
				conn("p9", "exit", -1, -1),
			},
		},
	}
}

// buildBaseScenario constructs the standard 103-station scenario:
//
//	srcA→pA1→pA2→pA3─┐
//	srcB→pB1→pB2→pB3─┤→mergeAB→mod1→pC1→pC2─┐
//	                                            ├→mergeAll→mod3→split1
//	srcC→pD1→pD2→mod2────────────────────────┘
//	  port0→pE1→pE2→pE3→mod4→pF1→pF2→drain1
//	  port1→pG1→pG2→pG3→mod5→pH1→pH2→drain2
//	srcD→pI1→pI2→pI3→drain3
//	srcE→pJ1→pJ2→pJ3→drain4
func buildBaseScenario(name, typeA, typeB, typeC, typeD, typeE, typeAB, typeAll string, pt1, pt2, pt3 float64) ScenarioRequest {
	stations := []Station{
		src("srcA", typeA, 2), src("srcB", typeB, 2),
		src("srcC", typeC, 2), src("srcD", typeD, 2), src("srcE", typeE, 2),

		proc("pA1", 0.5, pt1, 0.5), proc("pA2", 0.5, pt1, 0.5), proc("pA3", 0.5, pt1, 0.5),
		proc("pB1", 0.5, pt2, 0.5), proc("pB2", 0.5, pt2, 0.5), proc("pB3", 0.5, pt2, 0.5),
		merge2("mergeAB", pt1, typeAB),
		machine12("mod1", pt1),
		proc("pC1", 0.5, pt2, 0.5), proc("pC2", 0.5, pt2, 0.5),
		proc("pD1", 0.5, pt3, 0.5), proc("pD2", 0.5, pt3, 0.5),
		machine12("mod2", pt3),
		merge2("mergeAll", pt2, typeAll),
		machine12("mod3", pt2),
		split2("split1", pt1),
		proc("pE1", 0.5, pt1, 0.5), proc("pE2", 0.5, pt2, 0.5), proc("pE3", 0.5, pt3, 0.5),
		machine12("mod4", pt3),
		proc("pF1", 0.5, pt1, 0.5), proc("pF2", 0.5, pt2, 0.5),
		drain("drain1"),
		proc("pG1", 0.5, pt2, 0.5), proc("pG2", 0.5, pt3, 0.5), proc("pG3", 0.5, pt1, 0.5),
		machine12("mod5", pt1),
		proc("pH1", 0.5, pt3, 0.5), proc("pH2", 0.5, pt1, 0.5),
		drain("drain2"),
		proc("pI1", 0.5, pt1, 0.5), proc("pI2", 0.5, pt2, 0.5), proc("pI3", 0.5, pt3, 0.5),
		drain("drain3"),
		proc("pJ1", 0.5, pt3, 0.5), proc("pJ2", 0.5, pt1, 0.5), proc("pJ3", 0.5, pt2, 0.5),
		drain("drain4"),
	}

	connections := []Connection{
		conn("srcA", "pA1", -1, -1), conn("pA1", "pA2", -1, -1), conn("pA2", "pA3", -1, -1),
		conn("pA3", "mergeAB", -1, 0),
		conn("srcB", "pB1", -1, -1), conn("pB1", "pB2", -1, -1), conn("pB2", "pB3", -1, -1),
		conn("pB3", "mergeAB", -1, 1),
		conn("mergeAB", "mod1", -1, -1),
		conn("mod1", "pC1", -1, -1), conn("pC1", "pC2", -1, -1),
		conn("pC2", "mergeAll", -1, 0),
		conn("srcC", "pD1", -1, -1), conn("pD1", "pD2", -1, -1),
		conn("pD2", "mod2", -1, -1),
		conn("mod2", "mergeAll", -1, 1),
		conn("mergeAll", "mod3", -1, -1),
		conn("mod3", "split1", -1, -1),
		conn("split1", "pE1", 0, -1), conn("pE1", "pE2", -1, -1), conn("pE2", "pE3", -1, -1),
		conn("pE3", "mod4", -1, -1),
		conn("mod4", "pF1", -1, -1), conn("pF1", "pF2", -1, -1), conn("pF2", "drain1", -1, -1),
		conn("split1", "pG1", 1, -1), conn("pG1", "pG2", -1, -1), conn("pG2", "pG3", -1, -1),
		conn("pG3", "mod5", -1, -1),
		conn("mod5", "pH1", -1, -1), conn("pH1", "pH2", -1, -1), conn("pH2", "drain2", -1, -1),
		conn("srcD", "pI1", -1, -1), conn("pI1", "pI2", -1, -1), conn("pI2", "pI3", -1, -1),
		conn("pI3", "drain3", -1, -1),
		conn("srcE", "pJ1", -1, -1), conn("pJ1", "pJ2", -1, -1), conn("pJ2", "pJ3", -1, -1),
		conn("pJ3", "drain4", -1, -1),
	}

	return ScenarioRequest{Name: name, Stations: stations, Connections: connections}
}

// ---------------------------------------------------------------
// 10 scenario definitions
// ---------------------------------------------------------------

func scenarios() []ScenarioRequest {
	base := []ScenarioRequest{
		buildBaseScenario("【テスト01】自動車エンジン組立ライン",
			"engine-block", "piston", "crankshaft", "camshaft", "valve",
			"engine-sub", "engine-complete", 1.0, 1.5, 2.0),
		buildBaseScenario("【テスト02】電子基板製造ライン",
			"pcb-base", "ic-chip", "resistor", "capacitor", "connector",
			"pcb-mounted", "pcb-complete", 0.8, 1.2, 1.6),
		buildBaseScenario("【テスト03】食品加工ライン",
			"raw-meat", "seasoning", "packaging-material", "sauce", "label",
			"seasoned-meat", "packaged-food", 1.2, 0.9, 1.8),
		buildBaseScenario("【テスト04】薬品製造ライン",
			"api", "excipient", "coating", "capsule", "packaging",
			"tablet-core", "finished-tablet", 2.0, 1.5, 1.0),
		buildBaseScenario("【テスト05】半導体製造ライン",
			"wafer", "dopant", "metal-layer", "photo-resist", "dielectric",
			"doped-wafer", "finished-wafer", 1.5, 2.0, 2.5),
		buildBaseScenario("【テスト06】家電製品組立ライン",
			"chassis", "motor", "electronics", "display", "casing",
			"motor-assembly", "finished-appliance", 0.8, 1.0, 1.4),
		buildBaseScenario("【テスト07】航空機部品製造ライン",
			"titanium-billet", "composite-sheet", "fastener", "seal", "wire-harness",
			"structural-sub", "aircraft-component", 3.0, 2.0, 2.5),
		buildBaseScenario("【テスト08】精密機械製造ライン",
			"gear-blank", "spring-steel", "jewel", "mainspring", "escapement",
			"gear-assembly", "watch-movement", 0.5, 0.8, 1.2),
		buildBaseScenario("【テスト09】複合素材製造ライン",
			"carbon-fiber", "resin", "core-material", "adhesive", "release-film",
			"composite-layup", "finished-composite", 2.5, 3.0, 1.5),
	}

	// Scenario 10: extended topology
	s10 := buildScenario10()
	return append(base, s10)
}

func buildScenario10() ScenarioRequest {
	stations := []Station{
		// Group XYZ
		src("srcX1", "type-x", 2), src("srcY1", "type-y", 2), src("srcZ1", "type-z", 2),
		proc("px1", 0.5, 1.0, 0.5), proc("px2", 0.5, 1.2, 0.5),
		proc("py1", 0.5, 0.8, 0.5), proc("py2", 0.5, 1.0, 0.5),
		merge2("mergeX", 1.5, "type-xy"),
		machine12("modX1", 1.0),
		proc("px3", 0.5, 1.2, 0.5), proc("px4", 0.5, 1.0, 0.5),
		proc("pz1", 0.5, 2.0, 0.5), proc("pz2", 0.5, 1.5, 0.5),
		machine12("modZ0", 1.5),
		merge2("mergeXY", 1.5, "type-xyz"),
		machine12("modZ1", 1.2),
		split2("splitZ", 1.0),
		proc("pOut1", 0.5, 1.0, 0.5), proc("pOut2", 0.5, 0.8, 0.5), proc("pOut3", 0.5, 1.2, 0.5),
		machine12("modOut1", 0.8),
		proc("pOut4", 0.5, 1.0, 0.5), proc("pOut5", 0.5, 0.8, 0.5),
		drain("drain-a"),
		proc("pQa1", 0.5, 1.5, 0.5), proc("pQa2", 0.5, 1.0, 0.5), proc("pQa3", 0.5, 0.8, 0.5),
		machine12("modOut2", 1.0),
		proc("pQa4", 0.5, 1.2, 0.5), proc("pQa5", 0.5, 1.0, 0.5),
		drain("drain-b"),
		// Group AB
		src("srcA1", "type-a", 2), src("srcB1", "type-b", 2),
		proc("pa1", 0.5, 1.0, 0.5), proc("pa2", 0.5, 1.2, 0.5), proc("pa3", 0.5, 0.8, 0.5),
		proc("pb1", 0.5, 0.9, 0.5), proc("pb2", 0.5, 1.1, 0.5), proc("pb3", 0.5, 1.3, 0.5),
		merge2("mergeA", 1.5, "type-ab"),
		machine12("modA1", 1.0),
		proc("pa4", 0.5, 1.0, 0.5), proc("pa5", 0.5, 1.2, 0.5), proc("pa6", 0.5, 0.8, 0.5),
		split2("splitA", 1.0),
		proc("pad1", 0.5, 1.0, 0.5), proc("pad2", 0.5, 0.8, 0.5),
		machine12("modA2", 1.0),
		proc("pad3", 0.5, 1.2, 0.5), proc("pad4", 0.5, 1.0, 0.5),
		drain("drain-c"),
		proc("pbe1", 0.5, 1.0, 0.5), proc("pbe2", 0.5, 1.2, 0.5),
		machine12("modA3", 1.0),
		proc("pbe3", 0.5, 0.8, 0.5), proc("pbe4", 0.5, 1.0, 0.5),
		drain("drain-d"),
		// Independent
		src("srcI1", "type-i", 2),
		proc("pi1", 0.5, 1.0, 0.5), proc("pi2", 0.5, 1.2, 0.5), proc("pi3", 0.5, 0.8, 0.5),
		proc("pi4", 0.5, 1.0, 0.5), proc("pi5", 0.5, 1.2, 0.5),
		drain("drain-e"),
		src("srcJ1", "type-j", 2),
		proc("pj1", 0.5, 1.0, 0.5), proc("pj2", 0.5, 0.8, 0.5), proc("pj3", 0.5, 1.2, 0.5),
		proc("pj4", 0.5, 1.0, 0.5), proc("pj5", 0.5, 0.8, 0.5),
		drain("drain-f"),
	}

	connections := []Connection{
		conn("srcX1", "px1", -1, -1), conn("px1", "px2", -1, -1), conn("px2", "mergeX", -1, 0),
		conn("srcY1", "py1", -1, -1), conn("py1", "py2", -1, -1), conn("py2", "mergeX", -1, 1),
		conn("mergeX", "modX1", -1, -1),
		conn("modX1", "px3", -1, -1), conn("px3", "px4", -1, -1), conn("px4", "mergeXY", -1, 0),
		conn("srcZ1", "pz1", -1, -1), conn("pz1", "pz2", -1, -1),
		conn("pz2", "modZ0", -1, -1), conn("modZ0", "mergeXY", -1, 1),
		conn("mergeXY", "modZ1", -1, -1), conn("modZ1", "splitZ", -1, -1),
		conn("splitZ", "pOut1", 0, -1),
		conn("pOut1", "pOut2", -1, -1), conn("pOut2", "pOut3", -1, -1),
		conn("pOut3", "modOut1", -1, -1),
		conn("modOut1", "pOut4", -1, -1), conn("pOut4", "pOut5", -1, -1), conn("pOut5", "drain-a", -1, -1),
		conn("splitZ", "pQa1", 1, -1),
		conn("pQa1", "pQa2", -1, -1), conn("pQa2", "pQa3", -1, -1),
		conn("pQa3", "modOut2", -1, -1),
		conn("modOut2", "pQa4", -1, -1), conn("pQa4", "pQa5", -1, -1), conn("pQa5", "drain-b", -1, -1),
		conn("srcA1", "pa1", -1, -1), conn("pa1", "pa2", -1, -1), conn("pa2", "pa3", -1, -1),
		conn("pa3", "mergeA", -1, 0),
		conn("srcB1", "pb1", -1, -1), conn("pb1", "pb2", -1, -1), conn("pb2", "pb3", -1, -1),
		conn("pb3", "mergeA", -1, 1),
		conn("mergeA", "modA1", -1, -1),
		conn("modA1", "pa4", -1, -1), conn("pa4", "pa5", -1, -1), conn("pa5", "pa6", -1, -1),
		conn("pa6", "splitA", -1, -1),
		conn("splitA", "pad1", 0, -1),
		conn("pad1", "pad2", -1, -1), conn("pad2", "modA2", -1, -1),
		conn("modA2", "pad3", -1, -1), conn("pad3", "pad4", -1, -1), conn("pad4", "drain-c", -1, -1),
		conn("splitA", "pbe1", 1, -1),
		conn("pbe1", "pbe2", -1, -1), conn("pbe2", "modA3", -1, -1),
		conn("modA3", "pbe3", -1, -1), conn("pbe3", "pbe4", -1, -1), conn("pbe4", "drain-d", -1, -1),
		conn("srcI1", "pi1", -1, -1), conn("pi1", "pi2", -1, -1), conn("pi2", "pi3", -1, -1),
		conn("pi3", "pi4", -1, -1), conn("pi4", "pi5", -1, -1), conn("pi5", "drain-e", -1, -1),
		conn("srcJ1", "pj1", -1, -1), conn("pj1", "pj2", -1, -1), conn("pj2", "pj3", -1, -1),
		conn("pj3", "pj4", -1, -1), conn("pj4", "pj5", -1, -1), conn("pj5", "drain-f", -1, -1),
	}

	return ScenarioRequest{Name: "【テスト10】完全自動化工場（多品種混流）", Stations: stations, Connections: connections}
}

// ---------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------

func postScenario(req ScenarioRequest) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	resp, err := client.Post(baseURL+"/api/scenarios", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		ScenarioID string `json:"scenarioId"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse response: %w (body: %s)", err, string(respBody))
	}
	return result.ScenarioID, nil
}

// ---------------------------------------------------------------
// main
// ---------------------------------------------------------------

func main() {
	flag.StringVar(&baseURL, "base-url", "https://localhost", "Base URL of simulation API")
	flag.Parse()

	list := scenarios()
	successCount := 0
	for i, s := range list {
		fmt.Printf("[%02d/10] %s ... ", i+1, s.Name)
		id, err := postScenario(s)
		if err != nil {
			fmt.Printf("FAILED: %v\n", err)
		} else {
			fmt.Printf("OK (id=%s)\n", id)
			successCount++
		}
	}

	fmt.Printf("\n%d/%d scenarios registered.\n", successCount, len(list))
	if successCount < len(list) {
		os.Exit(1)
	}
}
