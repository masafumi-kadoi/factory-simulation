# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### 実装可能なタスクのみを計画
- 計画段階で「実装可能なタスク」のみをリストアップ
- 「将来やるかもしれないタスク」は含めない
- 「検討中のタスク」は含めない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

### タスクが大きすぎる場合
- タスクを小さなサブタスクに分割
- 分割したサブタスクをこのファイルに追加
- サブタスクを1つずつ完了させる

---

## フェーズ1: 基盤整備（階層マッピング・レイヤー変換）

- [x] app.js: `_flattenScenario()` 実行後に `modulerMap`（内部stationID → 親moduler ID）を構築する
  - [x] フラット展開済みステーションを走査し、dot-IDから直接の親を抽出する
  - [x] ネスト対応: "moduler-1.moduler-2.proc-1" → 親は "moduler-1.moduler-2"
  - [x] `this.modulerMap` としてAppインスタンスに保持する

- [x] app.js: `_transformForLayer1(rawActiveWorks)` メソッドを実装する
  - [x] 内部ステーションの `at_station` → 親modulerの `at_station` に変換
  - [x] 内部→内部の `moving` → 親modulerの `at_station` に変換
  - [x] 外部→内部の `moving` → 外部→親modulerの `moving` に変換
  - [x] 内部→外部の `moving` → 親moduler→外部の `moving` に変換
  - [x] ネスト変換: 1階層のみ適用（第2レイヤーの変換はModulerModal側で適用）

- [x] app.js: `_filterForModuler(rawActiveWorks, modulerId)` メソッドを実装する
  - [x] 指定modulerの直接の内部ステーションに関するワークのみを抽出する
  - [x] 内部にネストされたモジュラーがある場合、その子ステーションは1階層上に変換する

## フェーズ2: Visualizer3D変更（折りたたみ廃止・ダブルクリック対応）

- [x] visualizer.js: 折りたたみ関連機能を削除する
  - [x] `modulerCollapseState` プロパティを削除
  - [x] `toggleModulerCollapse()` メソッドを削除
  - [x] `_applyCollapseState()` メソッドを削除
  - [x] `_isInsideCollapsedModuler()` メソッドを削除
  - [x] `_getDisplayPosition()` の折りたたみリダイレクトを削除（常に実ポジションを返す）
  - [x] `_updateModulerSignalText()` を削除
  - [x] `loadScenario()` 内の折りたたみ初期化コードを削除
  - [x] シングルクリック時のモジュラー展開/折りたたみ処理を削除

- [x] visualizer.js: ダブルクリック検出を実装する
  - [x] `_onModulerDoubleClick` コールバックプロパティを追加
  - [x] `setOnModulerDoubleClick(callback)` メソッドを追加
  - [x] `_handleClick` を変更: 300msタイマーでシングルクリック/ダブルクリックを判別
  - [x] ダブルクリック対象がモジュラーステーションの場合、コールバックを呼び出す
  - [x] シングルクリックの場合は既存のワーク情報モーダルを表示

- [x] visualizer.js: 同一ステーションの複数ワークをオフセット配置する
  - [x] `updateWorks()` で同一stationIdのワークを検出
  - [x] ワークIDのソート順で円形にオフセット配置する（radius=15, angle分割）

## フェーズ3: Layer1用シナリオフィルタリング

- [x] app.js: メインVisualizerに渡すシナリオをLayer1用にフィルタリングする
  - [x] `_buildLayer1Scenario(flatScenario)` メソッドを実装する
  - [x] stations: トップレベルのみ（IDにドットを含まないもの）
  - [x] connections: moduler外部接続をmodulerステーションへの接続にリライトする
  - [x] 内部接続（from/to両方がドットID）は除外する
  - [x] `_init()` でVisualizerにLayer1シナリオを渡す

## フェーズ4: ModulerModal実装

- [x] moduler-modal.js: ModulerModalクラスを新規作成する
  - [x] `constructor(parentElement, zIndexBase)`: 初期化
  - [x] `open(scenario, modulerName)`: モーダルDOM作成、Visualizer3D初期化、シナリオロード
  - [x] `update(works, signalStates, currentTime)`: ワーク状態更新
  - [x] `close()`: Visualizer3D.clear()、DOM削除、子モーダルも閉じる
  - [x] `isOpen()`: モーダルが開いているかどうか

- [x] moduler-modal.js: モーダルUIを実装する
  - [x] オーバーレイ（半透明背景、背景の第1レイヤーが透けて見える）
  - [x] ヘッダー: モジュラー名 + 閉じるボタン
  - [x] 3Dコンテナ領域（画面の80% × 70%）
  - [x] 閉じる: ×ボタンクリック / オーバーレイ外クリック

- [x] moduler-modal.js: ネスト対応を実装する
  - [x] 内部Visualizer3DにonModulerDoubleClickコールバックを設定
  - [x] 子ModulerModalインスタンスの生成・管理（z-indexインクリメント）
  - [x] close()時に子モーダルも再帰的にclose()する

## フェーズ5: App統合（モーダル管理・フレーム更新）

- [x] app.js: `_buildInternalScenario(flatScenario, modulerId)` メソッドを実装する
  - [x] フラット展開済みシナリオからmodulerの直接の内部ステーションを抽出する
  - [x] 内部接続を抽出する
  - [x] ステーションIDからプレフィックスを除去して表示用IDにする

- [x] app.js: `_openModulerModal(modulerId)` メソッドを実装する
  - [x] 内部シナリオを構築する
  - [x] ModulerModalインスタンスを生成し開く
  - [x] `this.openModals` リストに追加する

- [x] app.js: アニメーションループで全モーダルを更新する
  - [x] `_updateSimulation()` で rawActiveWorks を計算後、layer1用に変換してメインVisualizerに渡す
  - [x] 各openModalに対してフィルタリングしたワーク状態を渡す
  - [x] モーダルが閉じられた場合、openModalsリストから削除する

- [x] app.js: Visualizer3Dのダブルクリックコールバックを設定する
  - [x] `this.visualizer.setOnModulerDoubleClick(id => this._openModulerModal(id))` を設定

## フェーズ6: ブラウザテスト・調整

- [ ] テストシナリオの準備
  - [ ] Source → Moduler(Entry→Processing→Exit) → Drain の基本シナリオが存在することを確認
  - [ ] ネストされたモジュラーを含むシナリオが存在することを確認（なければ作成）

- [ ] 基本動作テスト
  - [ ] シミュレーション実行後、Visualizerで再生してモジュラー上でワークが静止することを確認
  - [ ] ダブルクリックでモーダルが開き、内部アニメーションが表示されることを確認
  - [ ] モーダル表示中に第1レイヤーも動作していることを確認
  - [ ] 再生/一時停止/シークが全レイヤーで同期することを確認

- [ ] ネスト動作テスト
  - [ ] ネストされたモジュラーで第3レイヤーモーダルが開くことを確認

- [ ] 既存機能テスト
  - [ ] ワーク情報モーダル（ワーククリック）が動作することを確認
  - [ ] ステーション名表示/非表示が動作することを確認
  - [ ] インターロック表示が動作することを確認

## フェーズ7: ドキュメント更新

- [ ] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日
{YYYY-MM-DD}

### 計画と実績の差分

**計画と異なった点**:
- {計画時には想定していなかった技術的な変更点}
- {実装方針の変更とその理由}

**新たに必要になったタスク**:
- {実装中に追加したタスク}
- {なぜ追加が必要だったか}

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- {タスク名}
  - スキップ理由: {具体的な技術的理由}
  - 代替実装: {何に置き換わったか}

**⚠️ 注意**: 「時間の都合」「難しい」などの理由でスキップしたタスクはここに記載しないこと。全タスク完了が原則。

### 学んだこと

**技術的な学び**:
- {実装を通じて学んだ技術的な知見}
- {新しく使った技術やパターン}

**プロセス上の改善点**:
- {タスク管理で良かった点}
- {ステアリングファイルの活用方法}

### 次回への改善提案
- {次回の機能追加で気をつけること}
- {より効率的な実装方法}
- {タスク計画の改善点}
