# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

---

## フェーズ1: scene3d.js — 直交投影カメラ対応

- [x] コンストラクタに `this._orthoCamera = null; this._useOrtho = false;` を追加
- [x] `setTopView()` を直交投影カメラ切り替えに書き換え
- [x] `setPerspView()` メソッドを追加
- [x] `_animate()` でアクティブカメラを使用するよう修正
- [x] `_onResize()` で orthoCamera のアスペクト比を更新するよう修正
- [x] `_handleClick()` でアクティブカメラでレイキャストするよう修正

## フェーズ2: app.js — 上面視トグル

- [x] btn-top クリックで setTopView / setPerspView をトグルするよう修正
- [x] トグル状態（active クラス）をボタンに反映

## フェーズ3: local-window.html — props パネル更新

- [x] `#props-fields` に positionX フィールド（`#props-pos-x`）を追加
- [x] `#props-fields` に positionY フィールド（`#props-pos-y`）を追加
- [x] 左パレットに「位置」セクションと `#palette-pos` 表示を追加

## フェーズ4: local-window.js — ロジックタブ全面書き直し

- [x] モジュールレベル変数: `_activeTool`, `_selectedStation`, `_connectSource`, `_dragState` を追加
- [x] `populateLogicTab()` を SVG ベースに書き直し
  - [x] SVG viewBox の動的計算
  - [x] `renderLogicSVG()` 呼び出し
  - [x] ツールパレットのイベントバインド
- [x] `renderLogicSVG()` 実装
  - [x] グリッドレイヤー描画（20単位ごと）
  - [x] 接続レイヤー描画（矢印付き線）
  - [x] ステーションレイヤー描画（円 + ラベル）
- [x] SVG マウスイベント実装
  - [x] select ツール: mousedown でドラッグ開始、mousemove で位置更新、mouseup で確定
  - [x] connect ツール: ステーションクリックでソース選択、2回目クリックで接続作成
  - [x] delete ツール: ステーションクリックで削除、接続クリックで削除
- [x] 右プロパティパネル更新
  - [x] ステーション選択時に props-fields を表示（name, type, processingTime, locationId, positionX, positionY）
  - [x] positionX/Y 変更時に childStations を更新して SVG 再描画
- [x] 左パレット位置表示の更新（`#palette-pos` に X/Y）
- [x] ステーション追加（station-btn クリック → キャンバスクリックで配置）
- [x] `saveAndClose()` に logic タブの保存を統合（既存 `API.saveMachineLogic` を活用）
- [x] 壊れた既存コード（`#logic-canvas`, `#logic-canvas-wrapper` 等を参照）を削除

## フェーズ5: 動作確認

- [x] `docker compose build factory-visualizer && docker compose up -d factory-visualizer`
- [x] サーバーから新しい scene3d.js が配信されていることを確認（setPerspView, _orthoCamera が存在）
- [x] サーバーから新しい local-window.js が配信されていることを確認（svgPoint, renderLogicSVG が存在）
- [x] サーバーから新しい local-window.html が配信されていることを確認（props-pos-x, palette-pos が存在）
- [ ] ブラウザで https://localhost/factory-visualizer/ を開き上面視ボタンを確認（ユーザーによる確認）
- [ ] ローカルウィンドウを開いて「ロジック編集」タブを確認（ユーザーによる確認）

---

## 実装後の振り返り

### 実装完了日
2026-05-18

### 計画と実績の差分

**計画と異なった点**:
- `local-window.js` は想定以上に壊れており（`#logic-canvas` 等を参照）、ロジックタブのコード全体を書き直した
- `saveAndClose()` の 3D モデルタブの保存コード（`model-gridsize`, `model-height`, `model-cells`, `model-rotation`）は DOM 要素が存在しないためそのまま削除（3D モデル編集機能は別タスクで実装予定）

**新たに必要になったタスク**:
- なし（スコープ内で収束）

### 学んだこと

**技術的な学び**:
- `THREE.OrthographicCamera` への切り替えは `controls.object` を差し替えることで実現できる（OrbitControls は内部的に `this.object` を参照している）
- SVG での座標変換には `svg.createSVGPoint().matrixTransform(svg.getScreenCTM().inverse())` が正確（CSS transform があっても正しく動く）
- `viewBox` を動的に設定することで、ステーション数やレイアウトに関わらず適切な表示範囲を確保できる

### 次回への改善提案
- ロジック編集タブにズーム/パン操作を追加（マウスホイールでズーム、中ボタンドラッグでパン）
- 3D モデル編集タブの機能復旧（model-grid-canvas / model-3d-canvas を使う editor 実装）
- ローカルウィンドウの設備グローバル位置（machineStation.positionX/Y）の編集対応
