#!/usr/bin/env bash
# Live モードテスト実行スクリプト
# 使い方: bash run-live-test.sh [速度倍率]
#
# 前提条件:
#   - factory-simulation スタックが起動済み（https://localhost でアクセス可能）
#   - simdb-test-driver が central モードで起動済み（http://localhost:8099）
#   - wdh-data.zip が simdb-test-driver の data/ ディレクトリにコピー済み

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRIVER_URL="http://localhost:8099"
GATEWAY_URL="https://localhost"
SPEED="${1:-10.0}"
ZIP_NAME="demo-4moduler-20process.zip"
ZIP_PATH="/data/${ZIP_NAME}"

# ── 色付きログ ─────────────────────────────────────────────
info()    { echo -e "\033[0;34m[INFO]\033[0m $*"; }
success() { echo -e "\033[0;32m[OK]\033[0m $*"; }
error()   { echo -e "\033[0;31m[ERROR]\033[0m $*" >&2; }
warn()    { echo -e "\033[0;33m[WARN]\033[0m $*"; }

# ── 前提チェック ───────────────────────────────────────────
info "前提条件を確認中..."

if ! curl -s "$DRIVER_URL/status" > /dev/null 2>&1; then
    error "simdb-test-driver に接続できません: $DRIVER_URL"
    error "  cd test-tools/simdb-test-driver && docker compose up -d simdb-driver"
    exit 1
fi
success "simdb-test-driver 接続確認"

if ! curl -sk "$GATEWAY_URL/api/data-sources" > /dev/null 2>&1; then
    error "Gateway に接続できません: $GATEWAY_URL"
    error "  docker compose up -d  (factory-simulation ルートで実行)"
    exit 1
fi
success "Gateway 接続確認"

# ── DataSource の準備 ─────────────────────────────────────
# data_source.json に既存IDが記録されている場合はそれを使用
DS_JSON="$SCRIPT_DIR/data_source.json"
EXISTING_ID=""
if [ -f "$DS_JSON" ]; then
    EXISTING_ID=$(python3 -c "import json; d=json.load(open('$DS_JSON')); print(d.get('id',''))" 2>/dev/null || echo "")
fi

DS_ID=""
if [ -n "$EXISTING_ID" ]; then
    # 既存 DataSource が有効か確認
    STATUS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "$GATEWAY_URL/api/data-sources/$EXISTING_ID")
    if [ "$STATUS_CODE" = "200" ]; then
        DS_ID="$EXISTING_ID"
        info "既存 DataSource を使用: $DS_ID"
    fi
fi

if [ -z "$DS_ID" ]; then
    # シナリオ登録
    info "シナリオを登録中..."
    SCENARIO_RESP=$(curl -sk -X POST "$GATEWAY_URL/api/scenarios" \
        -H 'Content-Type: application/json' \
        -d "@$SCRIPT_DIR/scenario.json")
    SCENARIO_ID=$(echo "$SCENARIO_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

    if [ -z "$SCENARIO_ID" ]; then
        warn "シナリオ登録でIDが取得できませんでした。既存シナリオを検索します..."
        SCENARIO_ID=$(curl -sk "$GATEWAY_URL/api/scenarios" | python3 -c "
import json,sys
scenarios = json.load(sys.stdin)
for s in scenarios:
    if s.get('name') == 'Demo-4Moduler-20Process':
        print(s['id'])
        break
" 2>/dev/null || echo "")
    fi

    if [ -z "$SCENARIO_ID" ]; then
        error "シナリオ登録失敗。レスポンス: $SCENARIO_RESP"
        exit 1
    fi
    success "シナリオ登録: $SCENARIO_ID"

    # DataSource 作成
    info "DataSource を作成中..."
    DS_RESP=$(curl -sk -X POST "$GATEWAY_URL/api/data-sources" \
        -H 'Content-Type: application/json' \
        -d "{\"friendlyName\": \"demo-4moduler-live\", \"scenarioId\": \"$SCENARIO_ID\"}")
    DS_ID=$(echo "$DS_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

    if [ -z "$DS_ID" ]; then
        error "DataSource 作成失敗。レスポンス: $DS_RESP"
        exit 1
    fi
    success "DataSource 作成: $DS_ID"

    # data_source.json を更新
    python3 -c "
import json
data = {
    'id': '$DS_ID',
    'friendlyName': 'demo-4moduler-live',
    'scenarioId': '$SCENARIO_ID',
    'sourceType': 'simulation',
    'note': 'このファイルはデモ環境で作成したDataSourceの設定情報です。'
}
with open('$DS_JSON', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
    info "data_source.json を更新しました"
fi

# endedAt をクリア（Live モード用）
curl -sk -X PATCH "$GATEWAY_URL/api/data-sources/$DS_ID" \
    -H 'Content-Type: application/json' \
    -d '{"endedAt": null}' > /dev/null

# ── ZIP を data/ にコピー ──────────────────────────────────
DRIVER_DATA_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")/simdb-test-driver/data"
if [ ! -f "$DRIVER_DATA_DIR/$ZIP_NAME" ]; then
    info "ZIP を simdb-test-driver/data/ にコピー中..."
    cp "$SCRIPT_DIR/wdh-data.zip" "$DRIVER_DATA_DIR/$ZIP_NAME"
    success "コピー完了: $DRIVER_DATA_DIR/$ZIP_NAME"
fi

# ── driver の設定確認 ─────────────────────────────────────
DRIVER_DS_ID=$(curl -s "$DRIVER_URL/status" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data_source_id',''))" 2>/dev/null || echo "")
if [ "$DRIVER_DS_ID" != "$DS_ID" ]; then
    warn "ドライバーの data_source_id ($DRIVER_DS_ID) がテスト対象 ($DS_ID) と異なります"
    warn "  .env の SIMDB_DATA_SOURCE_ID=$DS_ID を設定してドライバーを再起動してください"
    warn "  cd test-tools/simdb-test-driver && docker compose up -d simdb-driver"
    echo ""
fi

# ── ロード ────────────────────────────────────────────────
info "データをロード中: $ZIP_PATH"
LOAD_RESP=$(curl -s -X POST "$DRIVER_URL/load" \
    -H 'Content-Type: application/json' \
    -d "{\"type\": \"zip\", \"path\": \"$ZIP_PATH\"}")
if [ "$(echo "$LOAD_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',''))" 2>/dev/null)" != "True" ]; then
    error "ロード失敗: $LOAD_RESP"
    exit 1
fi

STATUS=$(curl -s "$DRIVER_URL/status")
TOTAL=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total_events',0))" 2>/dev/null || echo "?")
success "ロード完了: $TOTAL イベント"

# ── 速度設定 + 再生開始 ───────────────────────────────────
info "速度 ${SPEED}x で再生開始..."
curl -s -X PATCH "$DRIVER_URL/speed" \
    -H 'Content-Type: application/json' \
    -d "{\"multiplier\": $SPEED}" > /dev/null

curl -s -X POST "$DRIVER_URL/play" > /dev/null
success "再生開始"

# ── 進捗モニター ──────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Visualizer URL:"
echo "  https://localhost/visualizer/?ds=${DS_ID}&live=1"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "再生進捗を監視中（Ctrl+C で中断）..."

while true; do
    STATUS=$(curl -s "$DRIVER_URL/status" 2>/dev/null)
    STATE=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('state','?'))" 2>/dev/null || echo "?")
    IDX=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('current_event_index',0))" 2>/dev/null || echo "?")
    TOT=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total_events',0))" 2>/dev/null || echo "?")
    ELAPSED=$(echo "$STATUS" | python3 -c "import json,sys; print(f\"{json.load(sys.stdin).get('elapsed_scenario_sec',0):.1f}\")" 2>/dev/null || echo "?")

    PERCENT="?"
    if [ "$TOT" != "0" ] && [ "$TOT" != "?" ]; then
        PERCENT=$(python3 -c "print(f'{int($IDX)*100//$TOT}%')" 2>/dev/null || echo "?")
    fi

    printf "\r  [%s] event %s / %s (%s) scenario=%.1fs  " \
        "$STATE" "$IDX" "$TOT" "$PERCENT" "$ELAPSED" 2>/dev/null || true

    if [ "$STATE" = "completed" ] || [ "$STATE" = "error" ]; then
        echo ""
        break
    fi
    sleep 2
done

if [ "$STATE" = "completed" ]; then
    success "再生完了 ($IDX / $TOT イベント)"

    # endedAt を設定
    info "endedAt を設定中..."
    END_TIME=$(python3 -c "
import subprocess, json
result = subprocess.run(
    ['docker', 'exec', 'factory-simulation-db', 'psql', '-U', 'postgres', 'factory_simulation',
     '-t', '-c', \"SELECT MAX(event_time) FROM item_movement WHERE data_source_id='$DS_ID';\"],
    capture_output=True, text=True
)
t = result.stdout.strip().replace(' ', 'T').replace('+00', 'Z')
print(t)
" 2>/dev/null || echo "")

    if [ -n "$END_TIME" ]; then
        curl -sk -X PATCH "$GATEWAY_URL/api/data-sources/$DS_ID" \
            -H 'Content-Type: application/json' \
            -d "{\"endedAt\": \"$END_TIME\"}" > /dev/null
        success "endedAt 設定: $END_TIME"
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  テスト完了！"
    echo ""
    echo "  再生モード Visualizer:"
    echo "  https://localhost/visualizer/?ds=${DS_ID}"
    echo ""
    echo "  Live モード再テスト:"
    echo "  bash run-live-test.sh $SPEED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    error "再生中にエラーが発生しました（state: $STATE）"
    exit 1
fi
