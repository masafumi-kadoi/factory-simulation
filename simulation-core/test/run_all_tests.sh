#!/bin/bash

# Factory Simulation - Test Runner
# This script runs all test scenarios and reports results

API_BASE="http://localhost:8080/api"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "==========================================="
echo "  Factory Simulation - Test Suite"
echo "==========================================="
echo ""

# Counter
TOTAL=0
PASSED=0
FAILED=0

# Array to store failed tests
declare -a FAILED_TESTS

# Function to run a single test
run_test() {
    local test_file=$1
    local test_name=$(basename "$test_file")

    TOTAL=$((TOTAL + 1))

    echo "Running test: $test_name"

    # Read test file
    if [ ! -f "$test_file" ]; then
        echo -e "${RED}✗ FAIL${NC} - Test file not found"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$test_name: File not found")
        return 1
    fi

    # Extract scenario
    local scenario=$(cat "$test_file" | jq '.scenario')

    # Create scenario via API
    local scenario_response=$(curl -s -X POST "$API_BASE/scenarios" \
        -H "Content-Type: application/json" \
        -d "$scenario" 2>&1)

    local scenario_id=$(echo "$scenario_response" | grep -o '"scenarioId":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$scenario_id" ]; then
        echo -e "${RED}✗ FAIL${NC} - Failed to create scenario"
        echo "  Response: $scenario_response"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$test_name: Failed to create scenario")
        return 1
    fi

    echo "  Scenario ID: $scenario_id"

    # Run simulation
    local sim_response=$(curl -s -X POST "$API_BASE/simulations" \
        -H "Content-Type: application/json" \
        -d "{\"scenarioId\": \"$scenario_id\", \"simulationTime\": 1000.0, \"initialConditions\": {}}" 2>&1)

    local sim_id=$(echo "$sim_response" | grep -o '"simulationId":"[^"]*"' | cut -d'"' -f4)
    local sim_status=$(echo "$sim_response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$sim_id" ]; then
        echo -e "${RED}✗ FAIL${NC} - Failed to run simulation"
        echo "  Response: $sim_response"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$test_name: $(echo "$sim_response" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)")
        return 1
    fi

    if [ "$sim_status" != "completed" ]; then
        echo -e "${RED}✗ FAIL${NC} - Simulation did not complete successfully"
        echo "  Status: $sim_status"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$test_name: Simulation status = $sim_status")
        return 1
    fi

    echo "  Simulation ID: $sim_id"
    echo "  Status: $sim_status"

    # Get logs and verify
    local logs_response=$(curl -s "$API_BASE/simulations/$sim_id/logs")
    local work_events=$(echo "$logs_response" | jq -r '.workEvents | length')

    echo "  Work Events: $work_events"

    echo -e "${GREEN}✓ PASS${NC}"
    PASSED=$((PASSED + 1))
    echo ""

    return 0
}

# Find and run all test files
for test_file in "$TEST_DIR"/*.json; do
    if [ -f "$test_file" ]; then
        run_test "$test_file"
    fi
done

# Print summary
echo ""
echo "==========================================="
echo "  Test Results Summary"
echo "==========================================="
echo ""
echo "Total tests: $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

# Print failed tests details
if [ $FAILED -gt 0 ]; then
    echo "Failed tests:"
    for failed_test in "${FAILED_TESTS[@]}"; do
        echo -e "  ${RED}✗${NC} $failed_test"
    done
    echo ""
fi

echo "==========================================="

# Exit with error if any test failed
if [ $FAILED -gt 0 ]; then
    exit 1
fi

exit 0
