# タスクリスト

## 🚨 タスク完全完了の原則
**このファイルの全タスクが完了するまで作業を継続すること**

---

## フェーズ1: HTML構造変更

- [x] `local-window.html` — `.logic-palette` のHTMLを改修
  - [x] ツールボタン（選択/接続/削除）は残す
  - [x] 「追加」セクション（station-btn群）を削除
  - [x] `#unplaced-station-list`（スクロール可能リストコンテナ）を追加
  - [x] `#btn-add-station`（+新規追加ボタン）を追加

- [x] `local-window.html` — `.logic-canvas-area` に投影用canvasを追加
  - [x] `<canvas id="logic-projection-canvas">` をSVGの前に挿入
  - [x] CSS: position:absolute, inset:0, width/height 100% でSVGの背面に配置

## フェーズ2: GLTF上面投影レンダラー実装 (`local-window.js`)

- [x] モジュールレベル変数追加
  - [x] `let _logicProjectionRenderer = null`
  - [x] `let _logicProjectionBBox = null`（バウンディングボックス、座標変換用）

- [x] `_initLogicProjection()` 関数実装
  - [ ] `_importedGlb` または `machineStation.config.model3DGlb` が存在しない場合は何もしない
  - [ ] 既存レンダラーがあればdisposeして再初期化
  - [ ] WebGLRenderer を `#logic-projection-canvas` にアタッチ
  - [ ] GLTFLoader でGLBを読み込み（`_importedGlb.arrayBuffer` または base64→ArrayBuffer）
  - [ ] `Box3.setFromObject(model)` でバウンディングボックス取得 → `_logicProjectionBBox` にセット
  - [ ] OrthographicCamera: `position.set(0, 1000, 0)`, `lookAt(0,0,0)`, left/right/top/bottom = bbox範囲
  - [ ] AmbientLight追加（白、intensity 1.0）
  - [ ] `renderer.render(scene, camera)` を1回呼び出し（静的）
  - [ ] SVGのviewBoxをbbox基準に設定: `${bbox.min.x} ${bbox.min.z} ${w} ${h}`

## フェーズ3: サイドバー — 未配置ステーション一覧 (`local-window.js`)

- [x] `renderUnplacedList()` 関数実装
  - [ ] `childStations.filter(s => s.positionX == null)` で未配置を抽出
  - [ ] `#unplaced-station-list` をクリアして再描画
  - [ ] 各アイテム: ステーション名 + タイプを表示、`draggable=true`
  - [ ] `dragstart` イベント: `dataTransfer.setData('text/station-id', s.stationId)`
  - [ ] 未配置がない場合は「全て配置済み」メッセージを表示

- [ ] 新規追加ボタン (`#btn-add-station`) のイベントハンドラ実装
  - [ ] 種別選択UIを表示（既存のpaddingセクション風のドロップダウンまたはモーダル）
  - [ ] `addStation(type)` を呼び出し（positionX/Y = null のまま）
  - [ ] `renderUnplacedList()` を再実行

- [ ] `initToolPalette()` の修正
  - [ ] 既存の `station-btn` イベント登録コードを削除
  - [ ] `#btn-add-station` のイベント登録に置き換え

## フェーズ4: ドラッグ＆ドロップ配置 (`local-window.js`)

- [x] `.logic-canvas-area` にドロップイベントを設定
  - [ ] `dragover` イベント: `e.preventDefault()` でドロップ許可
  - [ ] `drop` イベント: `_dropToLogicCanvas(e)` を呼び出し

- [ ] `_dropToLogicCanvas(e)` 関数実装
  - [ ] `dataTransfer.getData('text/station-id')` でstationIdを取得
  - [ ] ドロップ座標をキャンバス相対座標に変換
  - [ ] `_logicProjectionBBox` が存在する場合: GLTFローカル座標（lx, lz）を計算
    ```
    lx = bbox.min.x + (relX / canvasW) * (bbox.max.x - bbox.min.x)
    lz = bbox.min.z + (relY / canvasH) * (bbox.max.z - bbox.min.z)
    ```
  - [ ] `_logicProjectionBBox` が存在しない場合（GLTFなし）: SVG座標に変換（既存ロジック）
  - [ ] `station.positionX = lx`, `station.positionY = lz` をセット
  - [ ] `renderUnplacedList()` + `renderStations()` + `renderConnections()` を再描画

## フェーズ5: SVGオーバーレイの座標系調整 (`local-window.js`)

- [x] `refreshLogicSVGSize()` を修正
  - [ ] `_logicProjectionBBox` がある場合: viewBoxをbbox基準（bbox.min.x/z, bbox.max.x/z）に設定
  - [ ] ない場合: 既存のステーション座標ベースのviewBox計算を維持

- [ ] `renderStations()` の座標をそのまま利用（positionX=lx, positionY=lzがSVG座標と一致）

- [ ] 既存の「SVG上でドラッグ移動」はそのまま維持（座標は数値として扱うため変更不要）

## フェーズ6: `populateLogicTab()` の統合 (`local-window.js`)

- [x] `populateLogicTab()` を修正
  - [x] `_initLogicProjection()` を呼び出し（モデルがある場合のみ実際に処理）
  - [x] `renderUnplacedList()` を呼び出し
  - [x] 既存の `renderLogicSVG()` / `updateInfoBar()` は維持

- [ ] タブ切り替え時（`initTabs()` の model3d → logic）で投影が正しく表示されることを確認

## フェーズ7: Docker ビルド＆動作確認

- [ ] `docker compose build factory-visualizer && docker compose up -d factory-visualizer`
- [ ] ブラウザで Machine Editor を開き「ロジック編集」タブを確認（ユーザー確認待ち）
  - [ ] GLTFモデル上面投影が背景に表示される
  - [ ] 未配置ステーションが左サイドバーにリスト表示される
  - [ ] サイドバーからドラッグ→キャンバスにドロップで配置できる
  - [ ] 配置後サイドバーから消え、SVG上にノードが表示される
  - [ ] 「保存して閉じる」で相対座標がSimDBに保存される

---

## 実装後の振り返り

### 実装完了日
（未記入）

### 計画と実績の差分
（未記入）

### 学んだこと
（未記入）

### 次回への改善提案
（未記入）
