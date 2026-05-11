# 要求内容

## 概要

合流（N入力→1出力）と分岐（1入力→N出力）を統一的に扱える新ステーション型 `StationTypeSwitch` を追加する。接続先の搬入可・搬出可を考慮しながら、設定可能な選択戦略でポートを動的に選ぶ。

## 背景

既存の `StationTypeMerge` はワークを結合する専用型であり、複数ラインを1本に合流させながらワークをパススルーするユースケースに対応できない。また `StationTypeSplit` は1つのワークをN個に分割する専用型であり、1ラインをN本に振り分けるユースケースも実現できない。工場の合流・分岐コンベヤを表現するための汎用ステーション型が必要。

## 実装対象の機能

### 1. Switch ステーション型（合流 / 分岐）

- `direction: "merge"` — N入力ラインを1本に合流（ワークはパススルー、結合しない）
- `direction: "divert"` — 1本のラインをN出力に振り分け（ワークはパススルー、複製しない）
- ポート数は `portCount` で指定（2以上）

### 2. ポート選択戦略（selectMode）

接続先ステーションの搬入可・搬出可信号を自動フィルタとして適用したうえで、以下の戦略でポートを選択する。

| selectMode | 動作 |
|---|---|
| `round-robin` | 順番に優先。優先ポートが未準備なら他の準備済みポートに fallback。選択後に優先を進める |
| `sequence` | `sequence` 配列を繰り返し。優先ポートが未準備なら fallback。選択後に位置を進める |
| `priority` | `priorityOrder` の先頭から準備済みポートを探す。fallback なし（stall あり） |
| `first-available` | 接続リスト順に最初の準備済みポートを選択（優先なし） |

### 3. シナリオ JSON での設定

GUIからシナリオJSONに書き込むことを前提とした設定インターフェース。

```json
{
  "type": "switch",
  "config": {
    "direction": "merge",
    "portCount": 2,
    "selectMode": "round-robin",
    "sequence": [0, 1],
    "priorityOrder": [0, 1],
    "processingTime": 0.0,
    "arrivalTime": 0.1,
    "departureTime": 0.1
  }
}
```

## 受け入れ条件

### 合流（merge）
- [ ] 2つの上流から交互にワークを受け取れる（round-robin）
- [ ] 優先ポートが未準備のとき他のポートから受け取れる（fallback）
- [ ] ワークは結合されず個別のまま下流に流れる
- [ ] 上流の outputReady=false のポートは選択肢に上がらない

### 分岐（divert）
- [ ] selectMode に従って出力先ポートを選択できる
- [ ] ワークは複製されず1つの出力先にのみ送られる
- [ ] 下流の inputReady=false のポートは選択肢に上がらない

### 共通
- [ ] `go build ./...` が通る
- [ ] `go test ./...` が通る
- [ ] 既存の Merge / Split シナリオのテストが変化しない

## スコープ外

- GUI でのシナリオ編集 UI（本タスクは engine + JSON のみ）
- Switch ステーションを含む Moduler サブシナリオ
- N入力 → M出力のルーティング（同時に merge + divert）
- ワーク属性（workType など）に基づく条件分岐

## 参照ドキュメント

- `docs/architecture.md` — アーキテクチャ設計書
- `simulation-core/internal/domain/station.go` — ステーション型定義
- `simulation-core/internal/domain/interlock.go` — インターロック設定
- `simulation-core/internal/simulation/engine.go` — シミュレーションエンジン
