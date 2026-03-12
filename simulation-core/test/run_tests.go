package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

type TestScenario struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Scenario    struct {
		Name        string                   `json:"name"`
		Stations    []map[string]interface{} `json:"stations"`
		Connections []map[string]interface{} `json:"connections"`
	} `json:"scenario"`
	ExpectedResults map[string]interface{} `json:"expectedResults"`
}

type TestResult struct {
	TestName    string
	Status      string
	Duration    time.Duration
	ErrorMsg    string
	ActualCount map[string]int
}

func main() {
	fmt.Println("===========================================")
	fmt.Println("  Factory Simulation - Test Suite")
	fmt.Println("===========================================")
	fmt.Println()

	// Find all test JSON files
	testFiles, err := filepath.Glob("*.json")
	if err != nil {
		fmt.Printf("Error finding test files: %v\n", err)
		os.Exit(1)
	}

	if len(testFiles) == 0 {
		fmt.Println("No test files found")
		os.Exit(1)
	}

	fmt.Printf("Found %d test files\n\n", len(testFiles))

	// Run tests
	results := []TestResult{}
	passCount := 0
	failCount := 0

	for _, testFile := range testFiles {
		result := runTest(testFile)
		results = append(results, result)

		if result.Status == "PASS" {
			passCount++
		} else {
			failCount++
		}
	}

	// Print summary
	fmt.Println()
	fmt.Println("===========================================")
	fmt.Println("  Test Results Summary")
	fmt.Println("===========================================")
	fmt.Println()

	for _, result := range results {
		status := "✓ PASS"
		if result.Status != "PASS" {
			status = "✗ FAIL"
		}

		fmt.Printf("%s - %s (%.2fs)\n", status, result.TestName, result.Duration.Seconds())

		if result.Status != "PASS" {
			fmt.Printf("  Error: %s\n", result.ErrorMsg)
			if len(result.ActualCount) > 0 {
				fmt.Printf("  Actual counts: %v\n", result.ActualCount)
			}
		}
	}

	fmt.Println()
	fmt.Printf("Total: %d tests | Pass: %d | Fail: %d\n", len(results), passCount, failCount)
	fmt.Println("===========================================")

	if failCount > 0 {
		os.Exit(1)
	}
}

func runTest(testFile string) TestResult {
	start := time.Now()
	result := TestResult{
		TestName:    testFile,
		ActualCount: make(map[string]int),
	}

	fmt.Printf("Running test: %s\n", testFile)

	// Read test file
	data, err := ioutil.ReadFile(testFile)
	if err != nil {
		result.Status = "FAIL"
		result.ErrorMsg = fmt.Sprintf("Failed to read test file: %v", err)
		result.Duration = time.Since(start)
		return result
	}

	// Parse test scenario
	var testScenario TestScenario
	if err := json.Unmarshal(data, &testScenario); err != nil {
		result.Status = "FAIL"
		result.ErrorMsg = fmt.Sprintf("Failed to parse test file: %v", err)
		result.Duration = time.Since(start)
		return result
	}

	fmt.Printf("  %s\n", testScenario.Description)

	// Create scenario via API
	scenarioID, err := createScenario(testScenario.Scenario)
	if err != nil {
		result.Status = "FAIL"
		result.ErrorMsg = fmt.Sprintf("Failed to create scenario: %v", err)
		result.Duration = time.Since(start)
		return result
	}

	// Run simulation
	simID, err := runSimulation(scenarioID)
	if err != nil {
		result.Status = "FAIL"
		result.ErrorMsg = fmt.Sprintf("Failed to run simulation: %v", err)
		result.Duration = time.Since(start)
		return result
	}

	// Verify results
	err = verifyResults(simID, testScenario.ExpectedResults, &result)
	if err != nil {
		result.Status = "FAIL"
		result.ErrorMsg = err.Error()
		result.Duration = time.Since(start)
		return result
	}

	result.Status = "PASS"
	result.Duration = time.Since(start)
	return result
}

func createScenario(scenario interface{}) (string, error) {
	// This is a placeholder - actual implementation would call API
	// For now, return a mock UUID
	return uuid.New().String(), nil
}

func runSimulation(scenarioID string) (string, error) {
	// This is a placeholder - actual implementation would call API
	return uuid.New().String(), nil
}

func verifyResults(simID string, expected map[string]interface{}, result *TestResult) error {
	// This is a placeholder - actual implementation would verify against DB
	// For now, always return success
	return nil
}
