# タスクリスト

## 🚨 タスク完全完了の原則
**このファイルの全タスクが完了するまで作業を継続すること**

---

## フェーズ1: local-window.html — モーダル追加

- [x] 格子設定モーダル（`#grid-size-modal`）を追加
  - [x] 列数（cols）・行数（rows）・セルサイズ（gridSize）の入力フィールド
- [x] 高さ設定モーダル（`#height-modal`）を追加
  - [x] 高さ（height）の入力フィールド

## フェーズ2: local-window.js — Three.js インポートとグリッド状態

- [x] `import * as THREE from 'three'` と OrbitControls を追加
- [x] `_grid` 状態オブジェクト（gridSize, height, cols, rows, cells Set, origin, originMode）を追加
- [x] `_3d` プレビュー変数（scene, camera, renderer, controls, modelGroup, raf）を追加

## フェーズ3: local-window.js — グリッドキャンバス実装

- [x] `initModelTab()` — ツールバーボタンのイベントバインド
  - [x] 原点設定ボタン
  - [x] クリアボタン
  - [x] 格子設定ボタン（モーダル表示）
  - [x] 高さ設定ボタン（モーダル表示）
- [x] `renderGridCanvas()` — 2D グリッド描画
  - [x] 背景・グリッド線描画
  - [x] 選択セルをシアン色でハイライト
  - [x] 原点マーカー（赤十字）描画
  - [x] ステータス表示（選択セル数 / grid cols×rows）
- [x] グリッドキャンバスのマウスイベント
  - [x] mousedown: セルトグル（クリックで追加/削除、ドラッグで連続操作）
  - [x] mousemove: ドラッグ中セルトグル
  - [x] mouseup/mouseleave: ドラッグ終了

## フェーズ4: local-window.js — 3D プレビュー実装

- [x] `init3DPreview()` — Three.js シーン初期化（遅延初期化）
  - [x] PerspectiveCamera + OrbitControls
  - [x] AmbientLight + DirectionalLight
  - [x] GridHelper（床グリッド）
  - [x] ResizeObserver でキャンバスリサイズ対応
- [x] `update3DPreview()` — グリッド状態から 3D モデルを再描画
  - [x] scene3d.js の `_buildVoxelMesh` と同等のセルごと BoxGeometry 方式
  - [x] エッジ（輪郭線）追加

## フェーズ5: local-window.js — タブ・保存の統合

- [x] `initTabs()` に model3d タブクリック時の処理追加
  - [x] `init3DPreview()` 遅延初期化
  - [x] `renderGridCanvas()` 呼び出し
- [x] `populateModelTab()` を修正
  - [x] 既存 `model3DGrid` を `_grid` に読み込む（cells を Set に変換）
  - [x] `initModelTab()` を呼び出す
- [x] `saveAndClose()` に model3DGrid 保存を追加
  - [x] `_grid.cells.size > 0` のとき config.model3DGrid を API 保存

## フェーズ6: 動作確認

- [x] `docker compose build factory-visualizer && docker compose up -d factory-visualizer`
- [ ] ブラウザで Machine Editor を開き「3Dモデル編集」タブを確認（ユーザー確認待ち）
  - [ ] グリッドが表示されること
  - [ ] セルをクリック/ドラッグでハイライトできること
  - [ ] 右の 3D プレビューが更新されること
  - [ ] 格子設定・高さ設定が動作すること
  - [ ] 「保存して閉じる」で model3DGrid が保存されること
  - [ ] グローバルビューで保存した 3D モデルが反映されること

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
