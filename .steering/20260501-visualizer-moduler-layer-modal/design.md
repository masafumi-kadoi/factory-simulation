# 設計書

## アーキテクチャ概要

レイヤー分離型のモジュラー可視化アーキテクチャを採用する。Appがワークイベントを一元管理し、レイヤーごとにフィルタリングしたワーク状態を各Visualizerインスタンスに配信する。

```
┌─────────────────────────────────────────────────────┐
│  App (タイムライン管理・ワーク状態計算)                │
│                                                      │
│  rawActiveWorks ─────┬──→ transformForLayer1()        │
│  (全ステーション)     │     → Layer1 Visualizer3D     │
│                      │                                │
│                      └──→ filterForModuler(id)        │
│                            → ModulerModal             │
│                              └→ Layer2 Visualizer3D   │
│                                 ├→ ダブルクリックで    │
│                                 │  さらにModal (再帰)  │
│                                 └→ Layer3 ...         │
└─────────────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. App (app.js) — ワーク状態のレイヤー分離

**責務**:
- フラット展開されたワークイベントからレイヤー別のワーク状態を計算する
- モジュラー階層マッピング（stationID → parentModulerID）を構築・保持する
- 開いているModulerModalのリストを管理し、アニメーションフレームごとに全モーダルを更新する

**実装の要点**:

**(a) 階層マッピングの構築**

`_flattenScenario()` 実行後、`modulerMap`（内部stationID → 親moduler ID）を構築する。ネスト対応のため、各内部ステーションは**直接の親**のみをマッピングする。

```
modulerMap = {
  "moduler-1.entry-0": "moduler-1",
  "moduler-1.proc-1": "moduler-1",
  "moduler-1.exit-0": "moduler-1",
  "moduler-1.moduler-2.entry-0": "moduler-1.moduler-2",
  "moduler-1.moduler-2.proc-1": "moduler-1.moduler-2",
  ...
}
```

**(b) rawActiveWorks → Layer1用変換**

`_updateSimulation()` で計算した `rawActiveWorks` を第1レイヤー用に変換する:

| rawActiveWorksの状態 | stationIDの所属 | Layer1での変換結果 |
|---------------------|-----------------|-------------------|
| `at_station` at "moduler-1.proc-1" | moduler-1の内部 | `at_station` at "moduler-1" |
| `moving` from "moduler-1.proc-1" to "moduler-1.exit-0" | 両方moduler-1の内部 | `at_station` at "moduler-1" |
| `moving` from "source-1" to "moduler-1.entry-0" | 外部→内部 | `moving` from "source-1" to "moduler-1" |
| `moving` from "moduler-1.exit-0" to "drain-1" | 内部→外部 | `moving` from "moduler-1" to "drain-1" |
| `at_station` at "source-1" | トップレベル | そのまま |

ネストの場合、変換は**1階層のみ**適用する。第2レイヤーから見た第3レイヤーの変換は、ModulerModal内で同じロジックを適用する。

**(c) モーダル用フィルタリング**

指定されたモジュラーIDに対して、`rawActiveWorks` からそのモジュラーの内部ステーションに関するワークのみを抽出する。

**(d) 複数ワークのオフセット**

同一モジュラーに複数ワークが存在する場合、Layer1の `at_station` 変換後にワークIDのソート順で円形にオフセット配置する。これはVisualizer3D側で処理する。

### 2. Visualizer3D (visualizer.js) — 変更点

**責務**:
- 与えられたシナリオ（ステーション・接続）を3D描画する
- 与えられたワーク状態を表示する
- モジュラーステーションのダブルクリックイベントをコールバックで通知する

**実装の要点**:

**(a) 折りたたみ機能の廃止**

以下を削除:
- `modulerCollapseState` / `toggleModulerCollapse()` / `_applyCollapseState()`
- `_isInsideCollapsedModuler()` / `_getDisplayPosition()` のリダイレクトロジック
- シングルクリックでのモジュラー展開/折りたたみ処理

**(b) 内部ステーションの非表示**

Layer1のVisualizerは内部ステーション（dot-ID）をシーンに追加しない。`loadScenario()` でフィルタリングする。

```
Layer1に渡すscenario:
  stations: トップレベルのみ（IDにドットを含まないもの）
  connections: from/to両方がトップレベルのもの + modulerへの外部接続（リライト済み）
```

**(c) ダブルクリックイベント**

- シングルクリック: ワーク情報モーダル（既存）
- ダブルクリック: モジュラーステーションの場合、`onModulerDoubleClick(stationId)` コールバックを呼ぶ

クリックとダブルクリックの判別は、300msタイマーで行う。

**(d) 複数ワークのオフセット表示**

`updateWorks()` で同一ステーションに複数ワークがある場合、円形に配置する:
```
angle = (index / total) * 2π
offsetX = cos(angle) * 15
offsetZ = sin(angle) * 15
```

### 3. ModulerModal (新規: moduler-modal.js)

**責務**:
- モーダルDOM要素の作成・表示・閉じる操作
- 内部用のVisualizer3Dインスタンスの管理
- 内部シナリオの構築（内部ステーション + 接続のみ）
- アニメーションフレームごとのワーク状態更新の受け入れ

**実装の要点**:

**(a) モーダルUI**

```
┌──────────────────────────────────────────┐
│  ヘッダー: [moduler名]          [×閉じる] │
├──────────────────────────────────────────┤
│                                          │
│          3Dシーン (Visualizer3D)          │
│          (内部ステーション表示)            │
│                                          │
└──────────────────────────────────────────┘
```

- 画面中央にオーバーレイ表示（背景は半透明、第1レイヤーが見える）
- サイズ: 画面の80% × 70%
- 閉じる: ×ボタン or オーバーレイ外クリック
- ネスト時: 新しいモーダルが上に重なる（z-indexインクリメント）

**(b) 内部シナリオの構築**

フラット展開済みシナリオから、指定modulerの内部ステーションを抽出:
- stations: `stationId.startsWith(modulerId + ".")` かつ直接の子のみ（ネストされた孫は含まない）
- connections: from/to両方が上記stationsに含まれるもの
- 内部ステーションIDからプレフィックスを除去して表示名をクリーンにする

**(c) Visualizer3Dとの連携**

- モーダルのコンテナ要素内に新しいVisualizer3Dインスタンスを生成
- `loadScenario()` に内部シナリオを渡す
- Appから毎フレーム `update(filteredWorks, currentTime)` が呼ばれる
- 内部にネストされたモジュラーがある場合、そのダブルクリックで再帰的にModulerModalを開く

**(d) ライフサイクル**

- `open()`: モーダルDOM作成、Visualizer3D初期化、シナリオロード
- `update(works, signalStates, currentTime)`: 毎フレーム呼び出し
- `close()`: Visualizer3D.clear()、DOM削除、子モーダルも全て閉じる

## データフロー

### アニメーションフレームごとの処理

```
1. App._animate()
   ├─ currentTime 更新
   ├─ App._updateSimulation()
   │   ├─ rawActiveWorks 計算（全フラットステーション対象）
   │   ├─ rawSignalStates 計算
   │   ├─ layer1Works = transformForLayer1(rawActiveWorks)
   │   └─ mainVisualizer.updateWorks(layer1Works, currentTime)
   │       mainVisualizer.updateInterlockStates(layer1Signals)
   └─ openModals.forEach(modal =>
       ├─ modalWorks = filterForModuler(rawActiveWorks, modal.modulerId)
       ├─ modalSignals = filterSignals(rawSignalStates, modal.modulerId)
       └─ modal.update(modalWorks, modalSignals, currentTime)
           └─ modal.visualizer.updateWorks(modalWorks, currentTime)
   )
```

### モーダルオープン時

```
1. ダブルクリック検出 (Visualizer3D)
2. onModulerDoubleClick(stationId) コールバック発火
3. App._openModulerModal(stationId)
   ├─ 内部シナリオ構築（_buildInternalScenario）
   ├─ ModulerModal.open(container, scenario, stationName)
   └─ openModals に追加
```

## テスト戦略

### 手動テスト（ブラウザ）

- Source → Moduler(Entry→Processing→Exit) → Drain のシナリオで動作確認
- 第1レイヤーでワークがモジュラー上で静止することを確認
- ダブルクリックでモーダルが開き、内部アニメーションが表示されることを確認
- モーダル表示中に第1レイヤーも動作していることを確認
- 再生/一時停止/シークが全レイヤーで同期することを確認
- ネストされたモジュラーで第3レイヤーが開くことを確認

### 既存テスト

- simulation-core の Go テストは変更なし（フロントエンドのみの変更）
- 既存のワーク情報モーダルが引き続き動作することを確認

## 依存ライブラリ

新規追加なし。既存のThree.js + OrbitControlsのみ使用。

## ディレクトリ構造

```
sim-visualizer/html/js/
├── app.js              # 変更: レイヤー分離ロジック追加
├── visualizer.js       # 変更: 折りたたみ廃止、ダブルクリック対応
├── moduler-modal.js    # 新規: モーダル管理クラス
└── api.js              # 変更なし
```

## 実装の順序

1. `moduler-modal.js` の骨格作成（DOM生成、open/close/update）
2. `app.js` に階層マッピング構築と `transformForLayer1()` を追加
3. `visualizer.js` から折りたたみ機能を削除し、ダブルクリック対応を追加
4. `app.js` のメインVisualizerに渡すシナリオをLayer1用にフィルタリング
5. `app.js` に `_openModulerModal()` と `_buildInternalScenario()` を実装
6. アニメーションループで全モーダルを更新するロジックを追加
7. ネスト対応（ModulerModal内のダブルクリック→再帰的モーダル生成）
8. 複数ワークのオフセット表示
9. ブラウザでの手動テスト・調整

## パフォーマンス考慮事項

- 各ModulerModalは独立したVisualizer3Dインスタンス（Three.jsシーン + レンダラー）を持つ。通常1〜2個のモーダルが同時に開く想定のため、パフォーマンス上の問題はない
- モーダルを閉じる際にVisualizer3D.clear()でリソースを解放する
- rawActiveWorksの計算は1回のみ行い、各レイヤーへの変換は軽量なマップ操作

## 将来の拡張性

- モーダル内にミニタイムライン表示を追加可能
- 第1レイヤーのモジュラーステーション上にプログレスインジケーター表示を追加可能
- モーダル間のワーク入出の遷移エフェクトを追加可能
