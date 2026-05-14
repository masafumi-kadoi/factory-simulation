# タスクリスト: 複合テストシナリオ作成・実行・可視化

## フェーズ1: シナリオJSON作成

- [x] シナリオ11 (自動車組立ライン) JSON作成
  - [x] Source×2 (frame/engine workType)
  - [x] Processing×3 (frame-1, frame-2, engine-1)
  - [x] Merge×1 (mergeCount=2, outputWorkType=assembled-car)
  - [x] Moduler×1 (entry→paint→inspect→exit)
  - [x] Split×1 (splitCount=2)
  - [x] Processing×2 QC後処理
  - [x] Drain×2
  - [x] 全接続定義 (portIndex含む)

- [x] シナリオ12 (並行生産ライン) JSON作成
  - [x] Source×1 (raw-part, workCount=8)
  - [x] Switch divert (portCount=2, round-robin)
  - [x] Processing×4 (line-a×2, line-b×2, line-a-2はカスタムインターロック)
  - [x] Switch merge (portCount=2, round-robin)
  - [x] Moduler×1 (entry→assemble→pack→exit)
  - [x] Drain×1

- [x] シナリオ13 (初期条件テスト) JSON作成
  - [x] Source×2 (typeA/typeB, workIds事前定義)
  - [x] initialConditions (currentWork+elapsedTime)
  - [x] 2独立ライン (typeA→mod→drain-a, typeB→drain-b)

## フェーズ2: API実行

- [x] シナリオ11 登録 → 実行 → simulationId取得 (e870db45)
- [x] シナリオ12 登録 → 実行 → simulationId取得 (a7596cf6)
- [x] シナリオ13 登録 → 実行（初期条件なし/あり2回）→ simulationId取得 (3b563bce, 7b0aa026)
- [x] 各シミュレーションの結果サマリー確認

## フェーズ3: 結果確認

- [x] 各シミュレーションのworkEvents件数確認
  - シナリオ11: created=8, destroyed=8 ✅
  - シナリオ12: created=8, destroyed=8 ✅
  - シナリオ13 (初期条件なし): created=6, destroyed=6 ✅
  - シナリオ13 (初期条件あり): created=6, destroyed=7 (1初期ワーク追加) ✅
- [x] 期待値（worksCreated/worksDestroyed）の検証
- [x] visualizer URL一覧をユーザーに提示

## 実装後の振り返り

- **実施日**: 2026-05-15
- **計画と実績の差分**:
  - DB migration 015によりscenariosテーブルが削除されていたため、手動再作成が必要だった
  - シナリオ12のSwitch接続はFromPortIndex=-1（ポートインデックス不要、順序でルーティング）
  - シナリオ13の初期条件付き実行: created=6+1初期ワーク=7 destroyed（期待通り）
- **確認済み機能**:
  - Source (workType, workCount, departureTime)
  - Processing (arrivalTime, processingTime, departureTime, カスタムinterlockRules)
  - Merge (mergeCount=2, inPorts, outputWorkType)
  - Split (splitCount=2, outPorts, portIndex routing)
  - Moduler (entryCount=1, exitCount=1, subScenario with entry→proc→proc→exit)
  - Switch divert (portCount=2, round-robin)
  - Switch merge (portCount=2, round-robin)
  - Drain (multiple)
  - initialConditions (workIds, currentWork+elapsedTime)
- **Visualizer URLs**:
  - シナリオ11: https://localhost/visualizer/?sim=e870db45-db6e-44ff-b85c-81d13b7eccb3
  - シナリオ12: https://localhost/visualizer/?sim=a7596cf6-41df-4019-9530-054562d6b131
  - シナリオ13 (通常): https://localhost/visualizer/?sim=3b563bce-1659-490a-a055-14e8e636ccef
  - シナリオ13 (初期条件): https://localhost/visualizer/?sim=7b0aa026-8c25-4378-a9a9-6a20ce55f2fd
