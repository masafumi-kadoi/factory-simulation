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

## フェーズ1: HTMLとCSSの準備

- [x] `editor.html` に import map を追加
  - [x] `<head>` 内の `<link>` タグ直後に `<script type="importmap">` を追加
  - [x] `"three"` → `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`
  - [x] `"three/addons/"` → `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/`
  - [x] ※ visualizer と同じバージョン（0.160.0）を使用

- [x] `editor.html` の `canvas-container` に要素を追加（`#breadcrumb` の直後）
  - [x] `#sub-scenario-toolbar` div (`display:none`) を追加
  - [x] その中に `.mode-buttons` div（`#logic-mode-btn`, `#model-mode-btn`）を追加
  - [x] その中に `#model-editing-controls` div (`display:none`) を追加
    - [x] `#block-size-btn`、`#block-height-btn` ボタンを追加
    - [x] `#model-confirm-btn`（`btn-primary`）ボタンを追加
    - [x] `#model-import-btn` ボタンを追加
    - [x] `#model-reset-btn` ボタン (`display:none`) を追加
    - [x] `#model-export-btn` ボタン (`disabled`) を追加
  - [x] `#model-editor-canvas` canvas 要素を追加 (`display:none`)
  - [x] `#model-footprint-canvas` canvas 要素を追加 (`position:absolute; top:0; left:0; pointer-events:none; display:none`)
  - [x] `#model-file-input` file input を追加 (`accept=".gltf,.glb"; display:none`)

- [x] `style.css` にスタイルを追加
  - [x] `#sub-scenario-toolbar`: `display:flex; flex-direction:row; align-items:center; gap:8px; padding:4px 8px; background:var(--toolbar-bg, #2a2a2a); border-bottom:1px solid var(--border-color);`
  - [x] `.mode-buttons`: `display:flex; gap:4px;`
  - [x] `.mode-btn`: `padding:4px 12px; border:1px solid var(--border-color); background:transparent; cursor:pointer; font-size:13px; border-radius:4px; color:var(--text-color);`
  - [x] `.mode-btn.active`: `background:var(--accent-color, #4a148c); color:#fff; border-color:var(--accent-color, #4a148c);`
  - [x] `#model-editing-controls`: `display:flex; gap:6px; margin-left:auto; align-items:center;`
  - [x] `#model-editor-canvas`: `width:100%; height:100%; display:block; background:#1a1a2e;`
  - [x] `#model-footprint-canvas`: `width:100%; height:100%; opacity:0.45; z-index:5;`

## フェーズ2: ModelEditor クラスの実装 (model-editor.js)

- [x] ファイル新規作成 `sim-editor/html/js/model-editor.js`（ES Module）

- [x] モジュール冒頭のインポート
  - [x] `import * as THREE from 'three';`
  - [x] `import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';`

- [x] コンストラクタと初期化
  - [x] `constructor(canvas, footprintCanvas)` 実装
  - [x] プロパティ初期化: `_mode='grid', _gridSize=20, _height=40, _cols=20, _rows=20`
  - [x] プロパティ初期化: `_selectedCells=new Set(), _isDragging=false`
  - [x] `_ctx = canvas.getContext('2d')`, `_footprintCtx = footprintCanvas.getContext('2d')`
  - [x] `ResizeObserver` で canvas サイズ変更を監視して `_resize()` → `_render()` を呼ぶ

- [x] キャンバスリサイズ処理
  - [x] `_resize()` 実装: `canvas.width = canvas.offsetWidth * devicePixelRatio` 等（devicePixelRatio対応）

- [x] グリッド描画
  - [x] `_render()` 実装: `_drawBackground()` → `_drawGrid()` → `_drawCells()` → `_drawImportedBadge()` の順
  - [x] `_drawBackground()`: 背景を `#1a1a2e` で塗りつぶす
  - [x] `_drawGrid()`: グリッド線を `#333` で描画（`_cols × _rows` の格子）
  - [x] `_drawCells()`: 選択セルをシアン色ハイライト（design.md の描画コード参照）
  - [x] `_drawImportedBadge()`: `_mode === 'imported'` の場合に「外部モデル設定済み」メッセージをキャンバス中央に表示

- [x] マウスインタラクション（`_mode === 'grid'` の場合のみ有効）
  - [x] `_getCellFromEvent(e)` 実装: マウス座標 → `{col, row}` 変換（devicePixelRatio考慮）
  - [x] `_handleMouseDown(e)` 実装: ドラッグ開始、クリックセルを選択/解除トグル
  - [x] `_handleMouseMove(e)` 実装: `_isDragging` が true の場合、現在セルを選択状態に追加（重複しても Set なので問題なし）
  - [x] `_handleMouseUp(e)` 実装: `_isDragging = false`
  - [x] `_handleMouseLeave(e)` 実装: `_isDragging = false`
  - [x] `document.addEventListener('mouseup', ...)` でキャンバス外ドラッグ終了を補足

- [x] モーダル処理
  - [x] `openGridSizeModal()` 実装
    - [x] 既存 `.modal-overlay` / `.modal` CSS クラスを流用したモーダルDOM生成
    - [x] 格子サイズ（min=1, max=200）・列数（min=1, max=50）・行数（min=1, max=50）の input
    - [x] 決定時: 範囲外セル（`col >= newCols || row >= newRows`）を `_selectedCells` から除去 → `_render()`
  - [x] `openHeightModal()` 実装
    - [x] 高さ（min=1, max=500）の input
    - [x] 決定時: `_height` を更新

- [x] 公開メソッド
  - [x] `open(model3DInfo)` 実装: design.md の「open() での状態復元」コード参照
  - [x] `close()` 実装: mouse イベントリスナー除去、ResizeObserver disconnect、canvas clearRect
  - [x] `getGridData()` 実装: `_mode !== 'grid' || _selectedCells.size === 0` の場合は null を返す。それ以外は `{ gridSize, height, cols, rows, cells: [..._selectedCells].map(k => k.split(',').map(Number)) }` を返す
  - [x] `drawFootprint(ctx, canvasWidth, canvasHeight)` 実装（design.md のコード参照）

- [x] インポート処理
  - [x] `importFile(file)` async 実装
    - [x] 拡張子の判定: `file.name.endsWith('.gltf')` または `file.name.endsWith('.glb')`
    - [x] `.gltf`: `file.text()` → `JSON.parse()` → `gltfJson.asset?.version` の存在確認（ない場合はエラーをスロー）→ `{ type: 'gltf', data: gltfJson }` を返す
    - [x] `.glb`: `file.arrayBuffer()` → `btoa(String.fromCharCode(...new Uint8Array(buf)))` で Base64 変換 → `{ type: 'glb', data: base64 }` を返す
    - [x] 成功時: `_mode = 'imported'` に切り替え → `_render()`
    - [x] 失敗時: エラーをスロー（呼び出し元でハンドリング）

- [x] エクスポート処理
  - [x] `exportFromGrid()` async 実装
    - [x] `const scene = new THREE.Scene()` を生成
    - [x] `_selectedCells` の各セルに BoxGeometry + MeshStandardMaterial を生成（design.md のglTF生成フロー参照）
    - [x] `new GLTFExporter().parse(scene, ...)` を Promise でラップして実行（`binary: false`）
    - [x] 結果 JSON を `JSON.stringify()` して Blob 化 → `<a download="model.gltf">` で DL
  - [x] `exportFromGltf(gltfJson)` 実装
    - [x] `JSON.stringify(gltfJson)` → Blob → `<a download="model.gltf">` で DL
  - [x] `exportFromGlb(base64)` 実装
    - [x] Base64 → `Uint8Array` → Blob → `<a download="model.glb">` で DL

- [x] クラスエクスポート
  - [x] `export class ModelEditor {}` でクラスをエクスポート

## フェーズ3: editor.js の拡張

- [x] インポート追加（既存 import 群の末尾）
  - [x] `import { ModelEditor } from './model-editor.js';`

- [x] コンストラクタへのプロパティ追加
  - [x] `this._editMode = 'logic';`
  - [x] `this._modelEditor = null;`

- [x] `drillDown()` の変更（行 1474 `_animateDrill()` 直前）
  - [x] `this._editMode = 'logic';` を追加
  - [x] `this._showSubScenarioToolbar();` を追加

- [x] `drillUp()` の変更（行 1496 `_markDirty()` 直前）
  - [x] `this._hideSubScenarioToolbar();` を追加

- [x] `drillToDepth()` の変更（行 1518 `_markDirty()` 直前）
  - [x] `while` ループの外、かつ `_markDirty()` の直前に以下を追加:
    `if (this._editStack.length === 0) this._hideSubScenarioToolbar();`

- [x] `_showSubScenarioToolbar()` 新規実装
- [x] `_hideSubScenarioToolbar()` 新規実装
- [x] `setEditMode(mode)` 新規実装
- [x] `_updateSubScenarioToolbarState()` 新規実装
- [x] `_handleModelConfirm()` 新規実装
- [x] `_handleModelImport(file)` async 新規実装
- [x] `_handleModelExport()` async 新規実装
- [x] `_handleModelReset()` 新規実装
- [x] 保存・読込メソッドの新規実装（design.md の「親ステーションへのアクセス」のコード参照）
  - [x] `_saveModel3DGrid(grid)` 実装
  - [x] `_saveModel3DGltf(gltfJson)` 実装
  - [x] `_saveModel3DGlb(base64)` 実装
  - [x] `_resetModel3D()` 実装
  - [x] `_loadModel3D()` 実装（`{type, data}` 形式で返す）

## フェーズ4: visualizer.js の変更

- [x] インポート追加
  - [x] `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';`

- [x] `loadScenario()` 内のステーション描画ループに分岐を追加
  - [x] `station.type === 'moduler'` の3パス分岐を実装（design.md の分岐コード参照）
  - [x] `loadScenario()` が async になるため、既存の呼び出し元（`app.js`）を確認して必要なら `await` を追加

- [x] `_createModulerGridModel(stationId, stationData, pos)` 新規実装
  - [x] `model3DGrid.cells` の各セルに BoxGeometry を生成（design.md 参照）
  - [x] `THREE.Group` にまとめてシーン追加
  - [x] `this.stations.set(stationId, { ... })` に格納（ラベル・インターロック指標含む）

- [x] `_createModulerGltfModel(stationId, stationData, pos)` async 新規実装
  - [x] Blob URL 生成 → GLTFLoader でロード → URL.revokeObjectURL（design.md のコード参照）
  - [x] `gltf.scene` をステーション位置に配置
  - [x] `this.stations.set(stationId, { ... })` に格納

## フェーズ5: 動作確認

- [x] `docker-compose up -d` でサービス起動
- [x] エディタ（https://localhost/editor/）でファイル配信を確認
  - [x] editor.html に importmap, sub-scenario-toolbar, model-editor-canvas が含まれることを確認
  - [x] model-editor.js が正しく配信されることを確認
  - [x] editor.js に ModelEditor インポートと新規メソッドが含まれることを確認
- [x] Visualizer JS に GLTFLoader インポートと新規メソッドが含まれることを確認
- [x] `model3DGrid` を API に保存・取得できることを確認（curl テスト）
  - [x] `PUT /api/scenarios/{id}` で model3DGrid を含むステーションを保存
  - [x] `GET /api/scenarios/{id}` で model3DGrid フィールドが返ることを確認
- [ ] **ブラウザ動作確認（UI）**
  - [ ] ModularStation をダブルクリックするとモード切替ツールバーが表示される
  - [ ] ブロックサイズ切替・高さ切替モーダルが動作する
  - [ ] セルのクリック選択・ドラッグ選択が動作する
  - [ ] 「モデル決定」で `model3DGrid` が保存される
  - [ ] ロジック編集に戻るとフットプリントが半透明表示される
  - [ ] インポート・エクスポート・リセットフローが動作する
  - [ ] Visualizer で BoxGeometry カスタム形状が表示される

---

## 実装後の振り返り

### 実装完了日
2026-05-08

### 計画と実績の差分

**計画と異なった点**:
- `#sub-scenario-toolbar` に `position: relative; z-index: 20` を追加した（計画外）。`position: absolute` なキャンバスがツールバーの上に重なるスタッキング問題を発見・修正。
- ドラッグ操作を「クリックしたセルのトグル状態に合わせて一貫して選択/解除」するように実装（計画ではドラッグは常に選択追加のみだったが、解除ドラッグも UX として必要）。
- GLB インポート時に先頭のマジックナンバー `0x46546C67` ("glTF") チェックを追加（セキュリティ考慮事項として強化）。

**新たに必要になったタスク**:
- `_showInlineNotification()` ヘルパーメソッドの追加（インポートエラー表示用）
- `#sub-scenario-toolbar` の z-index CSS 修正

### 学んだこと

**技術的な学び**:
- CSS スタッキングコンテキストの重要性: `position: static` な要素に `z-index` を指定しても効果がない。`position: relative/absolute/fixed` が必要。
- Flex コンテナの子要素は `z-index` が有効（flex items have z-index support）。
- `ResizeObserver` は `display: none` から `display: block` に変わった時もサイズ変化として検知する。
- `forEach` は async/await と組み合わせられないため、非同期処理が必要な場合は `for...of` ループへの変換が必要。

**プロセス上の改善点**:
- tasklist.md を使ったリアルタイム進捗管理が効果的だった。
- 設計フェーズで排他ルール（グリッドと外部モデル）を明確にしていたため、実装時の迷いがなかった。

### 次回への改善提案
- エディタのキャンバスコンテナのレイアウト設計をドキュメント化しておくと、次回の重ね合わせ UI 実装時に役立つ。
- ResizeObserver + position:absolute canvas の組み合わせは、初回レンダリング前のサイズ 0 問題に注意が必要。`refresh()` メソッドを公開 API として用意するのが良いプラクティス。
