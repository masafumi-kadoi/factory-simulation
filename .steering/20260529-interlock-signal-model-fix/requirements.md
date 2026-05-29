# 要求内容

## 概要

Processingステーションのインターロック信号モデルを修正し、inputWorkPresent / processingWorkPresent / outputWorkPresent の3信号がワークの位置（フェーズ）を正しく表現する排他的な遷移モデルに変更する。

## 背景

現行の実装では、WorkArrived時に inputWorkPresent / processingWorkPresent / outputWorkPresent を全て同時に ON にしている。この挙動では3信号が「ワークの有無」を冗長に表しているだけで、搬入→加工→搬出というワークの位置遷移を表現できていない。

また、信号が排他的でないことにより、デフォルトのインターロックルール R1（`inputWorkPresent=OFF → inputReady=ON`）が加工中や搬出待ちの状態でも発火してしまい、1ステーション1ワークの原則が論理的に破綻する問題がある。

## 実装対象の機能

### 1. 状態信号の排他的遷移モデル

- inputWorkPresent / processingWorkPresent / outputWorkPresent は同時に1つだけ ON となる排他的な関係にする
- 各イベントで適切な信号のみをセットする:
  - WorkArrived: inputWorkPresent=ON のみ
  - ProcessingStarted: inputWorkPresent→OFF, processingWorkPresent→ON
  - ProcessingCompleted: processingWorkPresent→OFF, outputWorkPresent→ON
  - WorkDeparted: outputWorkPresent→OFF

### 2. デフォルトインターロックルール R1 の条件修正

- 現行: `inputWorkPresent=OFF → inputReady=ON`
- 修正: `inputWorkPresent=OFF & processingWorkPresent=OFF & outputWorkPresent=OFF → inputReady=ON`
- ステーション内にワークが一切ない（Idle）状態でのみ inputReady=ON とする

## 受け入れ条件

### 状態信号の排他的遷移

- [ ] WorkArrived時に inputWorkPresent=ON, processingWorkPresent=OFF, outputWorkPresent=OFF となる
- [ ] ProcessingStarted時に inputWorkPresent=OFF, processingWorkPresent=ON, outputWorkPresent=OFF となる
- [ ] ProcessingCompleted時に inputWorkPresent=OFF, processingWorkPresent=OFF, outputWorkPresent=ON となる
- [ ] WorkDeparted時に inputWorkPresent=OFF, processingWorkPresent=OFF, outputWorkPresent=OFF となる
- [ ] 全状態を通じて、3信号のうち ON になるのは最大1つである

### インターロックルール R1 の修正

- [ ] Idle状態でのみ inputReady=ON となる
- [ ] 加工中（processingWorkPresent=ON）に inputReady=OFF である
- [ ] 搬出待ち（outputWorkPresent=ON）に inputReady=OFF である
- [ ] 全状態×全ルールの組み合わせで不正な発火がない

### 既存テストとの整合

- [ ] 既存のインターロックテストが新モデルに合わせて更新されている
- [ ] シミュレーション統合テストが正常に動作する

## 成功指標

- 全状態×全ルールの網羅的検証で不正発火が0件
- 既存のシミュレーションシナリオが正常に動作する

## スコープ外

以下はこのフェーズでは実装しません:

- Merge / Split / Entry / Exit / Switch 等の他ステーション種別の信号モデル変更
- フロントエンドのインターロックエディタUIの変更
- フロントエンドの信号説明テキスト（local-window.js）の変更

## 参照ドキュメント

- `SIMULATION-ENGINE.md` - シミュレーションエンジン動作仕様書
- `simulation-core/internal/domain/interlock.go` - インターロック定義
- `simulation-core/internal/simulation/engine.go` - シミュレーションエンジン
- `simulation-core/internal/simulation/interlock.go` - ルール評価エンジン
