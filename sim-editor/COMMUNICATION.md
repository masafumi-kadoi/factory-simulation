# sim-editor 通信フロー

## 概要

sim-editorはシナリオのビジュアル設計ツールです。シナリオの読み書きにsimulation-core APIを、SimDB接続テストにsim-executor-backend APIを使用します。ローカルの下書きシナリオはlocalStorageに保存されます。

## 接続先

| 接続先 | ベースURL | 用途 |
|--------|----------|------|
| simulation-core | `http://localhost:8080/api` | シナリオのCRUD |
| sim-executor-backend | `http://localhost:8084/api/executor` | SimDB接続テスト |
| localStorage | - | ローカル下書き保存 |

## データソース

sim-editorは2種類のデータソースを持ちます。

| ソース | 識別子 | URLパラメータ | 用途 |
|--------|--------|-------------|------|
| API (PostgreSQL) | scenarioId (UUID) | `?scenarioId=` | 保存済みシナリオ |
| localStorage | id (ローカル生成) | `?id=` | ローカル下書き |

## ページ別通信フロー

### シナリオ一覧 (index.html / list.js)

```
ページロード時:

1. localStorageから下書きシナリオを読み込み
   localStorage.getItem('sim-editor-scenarios')
   → JSON.parse → ローカル下書き一覧

2. APIから保存済みシナリオを取得
   GET http://localhost:8080/api/scenarios
   → レスポンス: {scenarios: [{scenarioId, name, stationCount, connectionCount, simdbConfig}]}
   → 保存済みシナリオ一覧

3. 画面描画
   → "Saved Scenarios" セクション（API由来）
   → "Local Drafts" セクション（localStorage由来）
```

**アクション:**

| 操作 | 対象 | 遷移先 |
|------|------|--------|
| Edit (API) | 保存済みシナリオ | `editor.html?scenarioId={uuid}` |
| Edit (Local) | 下書きシナリオ | `editor.html?id={localId}` |
| New | 新規下書き作成 | `editor.html?id={newLocalId}` |
| Duplicate | 下書きのみ | ページ内で複製 |
| Delete | 下書きのみ | ページ内で削除 |

### ビジュアルエディタ (editor.html / editor.js)

#### 初期化フロー

```
ページロード時:

1. URLパラメータ判定
   params.get('id') || params.get('scenarioId')

2a. scenarioIdパラメータの場合（API経由）
    GET http://localhost:8080/api/scenarios/{scenarioId}
    → レスポンス: {scenarioId, name, simdbConfig, stations[], connections[]}
    → 内部データ構造に変換（x,y座標を自動計算）
    → savedToAPI = true

2b. idパラメータの場合（localStorage）
    localStorage.getItem('sim-editor-scenarios')
    → 該当IDのシナリオを検索
    → savedToAPI = false

3. キャンバスとプロパティパネルを初期化
```

#### 保存フロー (Ctrl+S)

```
保存ボタン / Ctrl+S 押下時:

1. バリデーション実行
   → Source/Drain存在チェック, 接続チェック等

2. APIにシナリオを送信
   POST http://localhost:8080/api/scenarios
   → リクエスト:
     {
       name: "シナリオ名",
       simdbConfig: {host, port, database, user, password},
       stations: [{id, type, locationId, config}],
       connections: [{from, to, condition}]
     }
   → レスポンス: {scenarioId: "uuid"}

3. scenarioIdを保持（以降の保存で更新用に使用）

4. localStorageにも保存（バックアップ）
```

#### SimDB接続テスト (properties.js)

```
プロパティパネルの「接続テスト」ボタン押下時:

前提: シナリオがAPIに保存済み（scenarioIdが必要）

1. SimDB接続テスト
   POST http://localhost:8084/api/executor/simdb/test-connection
   → リクエスト: {scenarioId: "uuid"}
   → レスポンス: {success: true, locations: [{locationId, locationName}]}

2. 成功時:
   → LocationMasterデータをキャッシュ
   → ステーションのLocationドロップダウンに反映
   → 「接続成功」メッセージ表示

3. 失敗時:
   → エラーメッセージ表示
```

#### Export/Import

```
Export (Ctrl+E):
  → シナリオデータをJSONファイルとしてダウンロード
  → API通信なし

Import (Ctrl+I):
  → ファイル選択 → JSONパース → エディタに読み込み
  → API通信なし
```

## 通信シーケンス図

```
Browser (sim-editor)
  │
  ├──[List Page Load]──────────────────────────────────────┐
  │   localStorage.getItem('sim-editor-scenarios') ─────> localStorage
  │   GET /api/scenarios ───────────────────────────────> simulation-core
  │
  ├──[Open API Scenario]───────────────────────────────────┐
  │   GET /api/scenarios/{scenarioId} ──────────────────> simulation-core
  │
  ├──[Save Scenario (Ctrl+S)]──────────────────────────────┐
  │   POST /api/scenarios ──────────────────────────────> simulation-core
  │   localStorage.setItem('sim-editor-scenarios') ─────> localStorage
  │
  ├──[Test SimDB Connection]───────────────────────────────┐
  │   POST /api/executor/simdb/test-connection ─────────> sim-executor-backend
  │                                                         │
  │                                              ┌──────────┴──────────┐
  │                                              │ sim-executor-backend │
  │                                              │ GET /api/scenarios/  │
  │                                              │ {id} (simdbConfig)   │
  │                                              │ ──> simulation-core  │
  │                                              │                      │
  │                                              │ SELECT LocationMaster│
  │                                              │ ──> SimDB (外部DB)   │
  │                                              └─────────────────────┘
  │
  └──[Export / Import]─────────────────────────────────────┐
      → ファイルI/Oのみ（API通信なし）
```
