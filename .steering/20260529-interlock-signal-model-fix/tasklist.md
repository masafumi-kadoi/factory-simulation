# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

---

## フェーズ1: 仕様書の更新

- [x] SIMULATION-ENGINE.md の Processing セクションを新しい信号遷移モデルに更新
  - [x] 信号フロー図（WorkArrived / ProcessingStarted / ProcessingCompleted / WorkDeparted）
  - [x] デフォルトルール表（R1 の条件修正）
- [x] README.md の状態遷移図（L193-201）を更新
- [x] ARCHITECTURE.md の信号一覧の説明文（L72-74）を更新
- [x] docs/architecture.md のクラス図内の信号フィールド説明（L821-823）を更新

## フェーズ2: コア実装

- [x] domain/interlock.go: Processing デフォルトルール R1 の条件を修正
  - [x] `inputWorkPresent=OFF` → `inputWorkPresent=OFF & processingWorkPresent=OFF & outputWorkPresent=OFF`
- [x] simulation/engine.go: handleWorkArrived() の信号セットを修正
  - [x] `processingWorkPresent=ON` と `outputWorkPresent=ON` のセットを削除
- [x] simulation/engine.go: handleProcessingStarted() に信号遷移を追加
  - [x] `inputWorkPresent=OFF` と `processingWorkPresent=ON` を追加
- [x] simulation/engine.go: handleProcessingCompleted() に信号遷移を追加
  - [x] `processingWorkPresent=OFF` と `outputWorkPresent=ON` を追加
- [x] Machine / Moduler が同じデフォルトルールを使用しているか確認し、必要に応じて同様の修正を適用
  - [x] Moduler/Machine の R1 も同様に3条件に修正済み

## フェーズ3: テスト修正と検証

- [x] simulation/interlock_test.go の既存テストを新モデルに合わせて修正
  - [x] TestEvaluateRules_ProcessingWorkArrived: コメント修正（IWP=ON のみ設定は既に正しい）
  - [x] TestEvaluateRules_ProcessingComplete: OWP=ON, CPL=ON のみに修正
  - [x] TestEvaluateRules_ProcessingWorkDeparted: 完了状態を OWP=ON のみに修正
  - [x] TestEvaluateRules_CrossStationReference: 完了状態を OWP=ON のみに修正
- [x] 加工中（PWP=ON, RUN=ON）で inputReady=OFF を検証するテストを追加
- [x] 搬出待ち（OWP=ON, CPL=ON）で inputReady=OFF を検証するテストを追加
- [x] ~~統合テスト（test/10_interlock_signal_test.json）の期待値を更新~~（実装方針変更により不要: テストランナーからの自動読み込みなし。定性的な期待値記述のみで信号値の具体的アサーションがないため変更不要）
- [x] `go test ./...` で全テスト通過を確認

## フェーズ4: 最終確認

- [x] シミュレーション実行（Docker Compose）で正常動作を確認
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日
2026-05-29

### 計画と実績の差分

**計画と異なった点**:
- Switch divert ステーションも通常パス（handleWorkArrived）を通っており、IWP=ON のみへの変更が Switch divert にも波及した。Switch divert は透過ステーション（加工なし）のため OWP=ON も同時セットが必要で、Switch 用の分岐を追加した。
- Moduler/Machine のデフォルトルール R1 にも同じ問題があり、追加で修正した（計画の「確認し、必要に応じて修正」で対応済み）。

**新たに必要になったタスク**:
- Switch divert 用の OWP=ON 同時セット分岐（engine.go handleWorkArrived 内）
- TestEvaluateRules_CrossStationReference テストの信号設定修正

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- 統合テスト（test/10_interlock_signal_test.json）の期待値更新: テストランナーからの自動読み込みなし、定性的な期待値のみのため変更不要

### 学んだこと

**技術的な学び**:
- handleWorkArrived の通常パスは Processing / Drain / Switch divert 等複数のステーション種別が通るため、信号変更の影響範囲が広い。ステーション種別ごとの分岐が必要。
- Entry/Exit/Switch は透過ステーションで IWP/OWP を同時セットするモデル、Processing/Machine/Moduler は排他的フェーズモデルという2種類のモデルが共存している。

**プロセス上の改善点**:
- 信号モデルの変更は全ステーション種別への影響を事前に確認すべき。テスト実行で Switch の問題を発見できた。

### 次回への改善提案
- Entry/Exit/Switch 等の透過ステーションの信号モデルも将来的に整理を検討（今回はスコープ外）
- フロントエンドの信号説明テキスト（local-window.js）も今回のモデル変更に合わせて更新を検討
