# sim-visualizer 通信フロー

## 概要

sim-visualizerはシミュレーション結果の3D可視化ツールです。simulation-core APIからシミュレーション結果とログを取得し、Three.jsで3Dアニメーションとして再生します。バックエンドを持たないフロントエンド専用サービスです。

## 接続先

| 接続先 | ベースURL | 用途 |
|--------|----------|------|
| simulation-core | `http://localhost:8080/api` | シミュレーション結果・ログ取得 |

## URLパラメータ

| パラメータ | 用途 | リンク元 |
|-----------|------|---------|
| `sim` | シミュレーションID指定 | sim-editor (レガシー) |
| `simulationId` | シミュレーションID指定 | sim-executor, sim-portal |
| (なし) | シミュレーション一覧表示 | 直接アクセス |

`sim`と`simulationId`は同等で、どちらでも動作します。

## ページ別通信フロー

### シミュレーション一覧モード (URLパラメータなし)

```
ページロード時:

1. シミュレーション一覧取得
   GET http://localhost:8080/api/simulations
   → レスポンス: [{simulationId, friendlyName, scenarioId, status, endTime, endReason, createdAt}]
   → 新しい順にソート
   → ギャラリー形式で一覧表示

2. ユーザーがシミュレーションを選択
   → URLを ?sim={simulationId} に更新
   → 3Dビューアモードに遷移
```

### 3Dビューアモード (?sim={id} or ?simulationId={id})

```
ページロード時:

1. シミュレーション結果取得
   GET http://localhost:8080/api/simulations/{simulationId}
   → レスポンス:
     {
       simulationId, scenarioId, friendlyName,
       status, startTime, endTime, endReason,
       summary: {totalWorksCreated, totalWorksDestroyed, totalEvents}
     }
   → ヘッダーにシミュレーション情報を表示
   → scenarioIdを取得（次のリクエストで使用）

2. シナリオ構造取得
   GET http://localhost:8080/api/scenarios/{scenarioId}
   → レスポンス:
     {
       scenarioId, name,
       stations: [{id, type, config}],
       connections: [{from, to, condition}]
     }
   → 3Dシーンにステーションとコネクションを配置
   → Force-directedアルゴリズムでレイアウト計算

3. イベントログ取得
   GET http://localhost:8080/api/simulations/{simulationId}/logs
   → レスポンス:
     {
       stationStatusLogs: [{stationId, timestamp, statusType, value}],
       workEvents: [{workId, workFriendlyName, stationId, timestamp, eventType}],
       workLineage: [...]
     }
   → タイムラインデータとして保持
   → 最大タイムスタンプからタイムライン長を計算

4. 3Dシーン初期化
   → Three.jsシーン構築（ステーション、グリッド、ライティング）
   → タイムラインスライダー設定
   → 再生コントロール設定
```

#### 再生中のデータフロー（API通信なし）

```
再生中:

  → タイムラインの現在時刻に基づいて:

  1. ワークの存在判定
     workEvents を走査
     - WorkCreated/WorkArrived → ワークをステーションに配置
     - WorkDeparted → ワークの移動アニメーション開始
     - WorkDestroyed → ワークを削除

  2. ワーク位置の補間
     Departed → 次のArrived 間の時間で位置を線形補間
     → 3D空間上でステーション間を移動するアニメーション

  3. ステーション状態の更新
     stationStatusLogs を参照
     → 色や表示の変更（Idle/Processing/Completed）

  ※ 再生中は全てクライアントサイド処理、API通信なし
```

## 通信シーケンス図

```
Browser (sim-visualizer)           simulation-core          PostgreSQL
    │                                    │                      │
    │ [一覧モード]                        │                      │
    │ GET /api/simulations               │                      │
    │───────────────────────────────────>│ SELECT simulation_runs│
    │                                    │─────────────────────>│
    │                                    │<─────────────────────│
    │<───────────────────────────────────│                      │
    │ → ギャラリー表示                    │                      │
    │                                    │                      │
    │ [ユーザーがシミュレーション選択]      │                      │
    │                                    │                      │
    │ GET /api/simulations/{simId}       │                      │
    │───────────────────────────────────>│ SELECT simulation_run│
    │                                    │─────────────────────>│
    │<───────────────────────────────────│                      │
    │                                    │                      │
    │ GET /api/scenarios/{scenarioId}    │                      │
    │───────────────────────────────────>│ SELECT scenarios +   │
    │                                    │ stations + connections│
    │                                    │─────────────────────>│
    │<───────────────────────────────────│                      │
    │                                    │                      │
    │ GET /api/simulations/{simId}/logs  │                      │
    │───────────────────────────────────>│ SELECT work_events + │
    │                                    │ station_status_logs  │
    │                                    │─────────────────────>│
    │<───────────────────────────────────│                      │
    │                                    │                      │
    │ [3Dシーン構築 + タイムライン設定]    │                      │
    │                                    │                      │
    │ [Play/Pause/Seek]                  │                      │
    │ → クライアントサイド処理のみ         │                      │
    │   (API通信なし)                     │                      │
```

## 3D表示要素

| 要素 | 表現 | データソース |
|------|------|-------------|
| Source ステーション | 緑色のボックス | scenarios.stations (type=source) |
| Processing ステーション | 青色のボックス | scenarios.stations (type=processing) |
| Drain ステーション | グレーのボックス | scenarios.stations (type=drain) |
| コネクション | ステーション間の線 | scenarios.connections |
| ワーク | 赤色の球体 + ID表示 | workEvents (タイムライン依存) |
| グリッド | 地面のグリッド | 固定 |

## ユーザー操作

| 操作 | 効果 | API通信 |
|------|------|---------|
| Play | タイムライン再生開始 | なし |
| Pause | タイムライン一時停止 | なし |
| Reset | タイムライン先頭に戻る | なし |
| Speed (0.5x-10x) | 再生速度変更 | なし |
| スライダー操作 | タイムラインシーク | なし |
| 左ドラッグ | 視点回転 | なし |
| ホイール | ズーム | なし |
| 右ドラッグ | パン | なし |
| ステーション名トグル | 表示/非表示 | なし |
| ワークIDトグル | 表示/非表示 | なし |
