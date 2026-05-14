#!/bin/sh
# Complex scenario runner - runs from inside the Docker network
# Usage: sh run_complex_tests.sh
set -e

API="http://simulation-core:8080/api"

extract_field() {
  # Extract value of a simple JSON field (string)
  echo "$1" | sed 's/.*"'"$2"'":"\([^"]*\)".*/\1/'
}

run_scenario() {
  local label="$1"
  local scenario_file="$2"
  local sim_time="${3:-500.0}"

  echo ""
  echo "============================================"
  echo "  $label"
  echo "============================================"

  # Register scenario
  echo "[1/3] シナリオ登録..."
  local REG
  REG=$(wget -qO- --post-file="$scenario_file" \
    --header "Content-Type: application/json" \
    "$API/scenarios" 2>&1)

  if ! echo "$REG" | grep -q "scenarioId"; then
    echo "ERROR: 登録失敗 - $REG"
    return 1
  fi

  local SID
  SID=$(extract_field "$REG" "scenarioId")
  echo "[1/3] 完了: ScenarioID=$SID"

  # Run simulation
  echo "[2/3] シミュレーション実行 (timeLimit=${sim_time}s)..."
  local SIM_JSON="{\"scenarioId\":\"$SID\",\"simulationTime\":$sim_time}"
  local SIM
  SIM=$(wget -qO- --post-data "$SIM_JSON" \
    --header "Content-Type: application/json" \
    "$API/simulations" 2>&1)

  if ! echo "$SIM" | grep -q "simulationId"; then
    echo "ERROR: 実行失敗 - $SIM"
    return 1
  fi

  local SIMID
  SIMID=$(extract_field "$SIM" "simulationId")
  local STATUS
  STATUS=$(extract_field "$SIM" "status")
  echo "[2/3] 完了: SimID=$SIMID Status=$STATUS"

  # Get event counts
  echo "[3/3] ログ取得..."
  local LOGS
  LOGS=$(wget -qO- "$API/simulations/$SIMID/logs" 2>&1)
  local CREATED
  CREATED=$(echo "$LOGS" | grep -o '"WorkCreated"' | wc -l | tr -d ' ')
  local DESTROYED
  DESTROYED=$(echo "$LOGS" | grep -o '"WorkDestroyed"' | wc -l | tr -d ' ')
  local ARRIVED
  ARRIVED=$(echo "$LOGS" | grep -o '"WorkArrived"' | wc -l | tr -d ' ')

  echo "[3/3] WorkEvents: Created=$CREATED Destroyed=$DESTROYED Arrived=$ARRIVED"
  echo ""
  echo ">>> Visualizer URL: https://localhost/visualizer/?sim=$SIMID"
  echo ">>> SimID: $SIMID"
}

# Extract scenario JSON from test wrapper files
echo "=== テストファイルから シナリオJSONを抽出 ==="

# シナリオ11
awk '/"scenario": {/{p=1;d=0} p{for(i=1;i<=length;i++){c=substr($0,i,1);if(c=="{")d++;if(c=="}"){d--;if(d==0){print substr($0,1,i);p=0;exit}}}; if(p) print}' \
  /tmp/test11.json | sed '1s/^[^{]*//' > /tmp/s11.json
echo "s11.json: $(wc -c < /tmp/s11.json) bytes"

# シナリオ12
awk '/"scenario": {/{p=1;d=0} p{for(i=1;i<=length;i++){c=substr($0,i,1);if(c=="{")d++;if(c=="}"){d--;if(d==0){print substr($0,1,i);p=0;exit}}}; if(p) print}' \
  /tmp/test12.json | sed '1s/^[^{]*//' > /tmp/s12.json
echo "s12.json: $(wc -c < /tmp/s12.json) bytes"

# シナリオ13
awk '/"scenario": {/{p=1;d=0} p{for(i=1;i<=length;i++){c=substr($0,i,1);if(c=="{")d++;if(c=="}"){d--;if(d==0){print substr($0,1,i);p=0;exit}}}; if(p) print}' \
  /tmp/test13.json | sed '1s/^[^{]*//' > /tmp/s13.json
echo "s13.json: $(wc -c < /tmp/s13.json) bytes"

echo ""
echo "=== シミュレーション実行 ==="

run_scenario "シナリオ11: 自動車組立ライン (Merge/Split/Moduler)" /tmp/s11.json 500.0
run_scenario "シナリオ12: 並行生産ライン (Switch divert/merge)" /tmp/s12.json 500.0
run_scenario "シナリオ13: 初期条件テスト (workIds/elapsedTime)" /tmp/s13.json 500.0

echo ""
echo "=== 全テスト完了 ==="
