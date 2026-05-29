# 設計書

## 概要

Processingステーションにおける状態信号（inputWorkPresent / processingWorkPresent / outputWorkPresent）の遷移モデルを、排他的遷移モデルに修正する。

## 新しい信号遷移モデル

### 状態遷移図

```
[Idle]
  inputWorkPresent=OFF  processingWorkPresent=OFF  outputWorkPresent=OFF
  running=OFF  complete=OFF
   │
   │  inputReady=ON
   │  （ルール: inputWorkPresent=OFF & processingWorkPresent=OFF & outputWorkPresent=OFF → inputReady=ON）
   │  ハンドシェイク成立 → ワーク搬送開始
   ▼
[搬入完了 / WorkArrived]
  inputWorkPresent=ON   processingWorkPresent=OFF  outputWorkPresent=OFF
  running=OFF  complete=OFF
   │
   │  inputReady=OFF（ルール: inputWorkPresent=ON → inputReady=OFF）
   │  processReady=ON（ルール: inputWorkPresent=ON & running=OFF & complete=OFF → processReady=ON）
   ▼
[加工開始 / ProcessingStarted]
  inputWorkPresent=OFF  processingWorkPresent=ON   outputWorkPresent=OFF
  running=ON   complete=OFF
   │
   │  processReady=OFF（ルール: running=ON → processReady=OFF）
   │  processingTime 経過
   ▼
[加工完了 / ProcessingCompleted]
  inputWorkPresent=OFF  processingWorkPresent=OFF  outputWorkPresent=ON
  running=OFF  complete=ON
   │
   │  outputReady=ON（ルール: complete=ON & outputWorkPresent=ON → outputReady=ON）
   │  ハンドシェイク成立 → ワーク搬送開始
   ▼
[搬出完了 / WorkDeparted]
  inputWorkPresent=OFF  processingWorkPresent=OFF  outputWorkPresent=OFF
  running=OFF  complete=OFF
   │
   │  outputReady=OFF（ルール: outputWorkPresent=OFF → outputReady=OFF）
   │  inputReady=ON（ルール: inputWorkPresent=OFF & processingWorkPresent=OFF & outputWorkPresent=OFF → inputReady=ON）
   ▼
[Idle] に戻る
```

### 信号の意味（新定義）

| 信号名 | 意味 |
|--------|------|
| inputWorkPresent | ワークが搬入位置にある（上流から受け入れ済み、加工未開始） |
| processingWorkPresent | ワークが加工位置にある（加工中または加工準備中） |
| outputWorkPresent | ワークが搬出位置にある（加工完了、下流への搬出待ち） |

3信号は排他的であり、同時に ON になるのは最大1つ。すべて OFF の場合はステーション内にワークがない（Idle）。

## 全状態×全ルール 検証マトリクス

### デフォルトルール（修正後）

| ID | 条件 | 結果 |
|----|------|------|
| R1 | inputWorkPresent=OFF & processingWorkPresent=OFF & outputWorkPresent=OFF | inputReady=ON |
| R2 | inputWorkPresent=ON | inputReady=OFF |
| R3 | inputWorkPresent=ON & running=OFF & complete=OFF | processReady=ON |
| R4 | running=ON | processReady=OFF |
| R5 | complete=ON & outputWorkPresent=ON | outputReady=ON |
| R6 | outputWorkPresent=OFF | outputReady=OFF |

### 検証結果

#### 状態1: Idle

| ルール | 条件判定 | 発火 | 結果 | 正否 |
|--------|---------|------|------|------|
| R1 | IWP=OFF & PWP=OFF & OWP=OFF → YES | 発火 | inputReady=ON | 正しい |
| R2 | IWP=ON → NO | - | - | - |
| R3 | IWP=ON → NO | - | - | - |
| R4 | RUN=ON → NO | - | - | - |
| R5 | CPL=ON → NO | - | - | - |
| R6 | OWP=OFF → YES | 発火 | outputReady=OFF | 正しい |

#### 状態2: 搬入完了（IWP=ON, PWP=OFF, OWP=OFF, RUN=OFF, CPL=OFF）

| ルール | 条件判定 | 発火 | 結果 | 正否 |
|--------|---------|------|------|------|
| R1 | IWP=OFF → NO | - | - | - |
| R2 | IWP=ON → YES | 発火 | inputReady=OFF | 正しい |
| R3 | IWP=ON & RUN=OFF & CPL=OFF → YES | 発火 | processReady=ON | 正しい |
| R4 | RUN=ON → NO | - | - | - |
| R5 | CPL=ON → NO | - | - | - |
| R6 | OWP=OFF → YES | 発火 | outputReady=OFF | 正しい |

#### 状態3: 加工中（IWP=OFF, PWP=ON, OWP=OFF, RUN=ON, CPL=OFF）

| ルール | 条件判定 | 発火 | 結果 | 正否 |
|--------|---------|------|------|------|
| R1 | IWP=OFF & PWP=OFF → NO（PWP=ON） | - | - | - |
| R2 | IWP=ON → NO | - | - | - |
| R3 | IWP=ON → NO | - | - | - |
| R4 | RUN=ON → YES | 発火 | processReady=OFF | 正しい |
| R5 | CPL=ON → NO | - | - | - |
| R6 | OWP=OFF → YES | 発火 | outputReady=OFF | 正しい |

#### 状態4: 加工完了/搬出待ち（IWP=OFF, PWP=OFF, OWP=ON, RUN=OFF, CPL=ON）

| ルール | 条件判定 | 発火 | 結果 | 正否 |
|--------|---------|------|------|------|
| R1 | IWP=OFF & PWP=OFF & OWP=OFF → NO（OWP=ON） | - | - | - |
| R2 | IWP=ON → NO | - | - | - |
| R3 | IWP=ON → NO | - | - | - |
| R4 | RUN=ON → NO | - | - | - |
| R5 | CPL=ON & OWP=ON → YES | 発火 | outputReady=ON | 正しい |
| R6 | OWP=OFF → NO | - | - | - |

**全状態で不正発火なし。**

## コンポーネント設計

### 1. エンジン（simulation/engine.go）

**変更箇所: handleWorkArrived()**

現行:
```go
station.SetSignal(SignalInputWorkPresent, true)
station.SetSignal(SignalProcessingWorkPresent, true)
station.SetSignal(SignalOutputWorkPresent, true)
```

修正後:
```go
station.SetSignal(SignalInputWorkPresent, true)
// processingWorkPresent, outputWorkPresent は OFF のまま
```

**変更箇所: handleProcessingStarted()**

現行:
```go
station.SetSignal(SignalRunning, true)
```

修正後:
```go
station.SetSignal(SignalInputWorkPresent, false)
station.SetSignal(SignalProcessingWorkPresent, true)
station.SetSignal(SignalRunning, true)
```

**変更箇所: handleProcessingCompleted()**

現行:
```go
station.SetSignal(SignalRunning, false)
station.SetSignal(SignalComplete, true)
```

修正後:
```go
station.SetSignal(SignalProcessingWorkPresent, false)
station.SetSignal(SignalOutputWorkPresent, true)
station.SetSignal(SignalRunning, false)
station.SetSignal(SignalComplete, true)
```

**変更箇所: handleWorkDeparted()**

現行・修正後とも同じ（全信号 OFF）:
```go
station.SetSignal(SignalInputWorkPresent, false)
station.SetSignal(SignalProcessingWorkPresent, false)
station.SetSignal(SignalOutputWorkPresent, false)
station.SetSignal(SignalComplete, false)
station.SetSignal(SignalProcessReady, false)
```

### 2. デフォルトルール定義（domain/interlock.go）

**変更箇所: Processing のデフォルトルール R1**

現行:
```go
{Target: SignalInputReady, Value: true, Conditions: []RuleCondition{
    {Signal: SignalInputWorkPresent, Expected: false},
}}
```

修正後:
```go
{Target: SignalInputReady, Value: true, Conditions: []RuleCondition{
    {Signal: SignalInputWorkPresent, Expected: false},
    {Signal: SignalProcessingWorkPresent, Expected: false},
    {Signal: SignalOutputWorkPresent, Expected: false},
}}
```

### 3. 仕様書（SIMULATION-ENGINE.md）

Processing ステーションのセクションを新しい信号フローに合わせて更新する。

## テスト戦略

### ユニットテスト（simulation/interlock_test.go）

既存テストの修正:
- `TestEvaluateRules_ProcessingInitial`: 変更なし（Idle状態は同じ）
- `TestEvaluateRules_ProcessingWorkArrived`: IWP=ON のみ設定に修正
- `TestEvaluateRules_ProcessingComplete`: PWP→OFF, OWP→ON を反映
- `TestEvaluateRules_ProcessingWorkDeparted`: 変更なし（全OFF は同じ）

追加テスト:
- 加工中（PWP=ON, RUN=ON）で inputReady=OFF を検証
- 搬出待ち（OWP=ON, CPL=ON）で inputReady=OFF を検証

### 統合テスト

- `test/10_interlock_signal_test.json` の期待値を新モデルに合わせて更新

## 影響範囲

### 変更するファイル

```
simulation-core/internal/simulation/engine.go     # 状態信号のセット箇所
simulation-core/internal/domain/interlock.go       # デフォルトルール R1
simulation-core/internal/simulation/interlock_test.go  # ユニットテスト
simulation-core/test/10_interlock_signal_test.json     # 統合テスト
SIMULATION-ENGINE.md                                   # 仕様書（Processingセクション）
README.md                                              # 状態遷移図（L193-201）
ARCHITECTURE.md                                        # 信号一覧の説明文（L72-74）
docs/architecture.md                                   # クラス図内の信号フィールド説明（L821-823）
```

### 影響を受ける可能性のあるステーション種別

- **Processing**: 直接の変更対象
- **Machine / Moduler**: Processing と同じデフォルトルールを使用している場合、同様の修正が必要か確認
- **Source / Drain / Entry / Exit / Merge / Split / Switch**: スコープ外だが、同様の問題がないか確認

## 実装の順序

1. SIMULATION-ENGINE.md の Processing セクションを更新（仕様の確定）
2. domain/interlock.go のデフォルトルール R1 を修正
3. simulation/engine.go の各イベントハンドラの信号セットを修正
4. ユニットテストを新モデルに合わせて修正・追加
5. 統合テストの期待値を更新
6. go test で全テスト通過を確認
