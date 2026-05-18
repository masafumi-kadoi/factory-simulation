# タスクリスト: グローバルビュー タブ切り替え実装

## フェーズ1: HTML構造・CSS

- [x] index.html: ツールバー右端にタブボタン4つを追加
- [x] index.html: 既存 #content + #timeline-bar を #gv-view-display.global-tab-body でラップ
- [x] index.html: #gv-factory-info.global-tab-body を追加（構造のみ）
- [x] index.html: #gv-3d-edit.global-tab-body を追加（構造のみ）
- [x] index.html: #gv-logic-edit.global-tab-body を追加（構造のみ）
- [x] style.css: .toolbar-tabs / .toolbar-tab / .toolbar-tab.active スタイル追加
- [x] style.css: .global-tab-body スタイル追加

## フェーズ2: タブ切り替えJS

- [x] app.js: initGlobalTabs() 実装（クリックで active 切り替え）
- [x] app.js: DOMContentLoaded で initGlobalTabs() を呼ぶ

## フェーズ3: 工場情報タブ

- [x] index.html: #gv-factory-info 内の詳細HTML（サイドバー + 詳細エリア）
- [x] style.css: 工場情報タブのスタイル
- [x] app.js: initFactoryInfoTab() 実装
- [x] app.js: renderFactoryInfoGroup(groupId) 実装（basic/stations/connections/metadata）
- [x] app.js: JSON エクスポート機能
- [x] app.js: JSON インポート機能
- [x] app.js: 工場選択時に工場情報タブを自動更新

## フェーズ4: 3Dモデル編集タブ

- [x] index.html: #gv-3d-edit 内の詳細HTML（サイドバー + シーン + フローティングウィンドウ）
- [x] style.css: 3Dモデル編集タブのスタイル
- [x] scene3d.js: attachTo(el) メソッド追加（renderer の DOM を別要素に移動）
- [x] app.js: initGlobal3DEditTab() 実装（サイドバークリック → フローティング表示）
- [x] app.js: openG3DFloating(groupId) 実装（グループ別設定フォーム描画）
- [x] app.js: フローティングウィンドウの確定ボタン処理（localStorage 保存）
- [x] app.js: タブ切り替え時の renderer 移動処理

## フェーズ5: ロジック編集タブ

- [x] index.html: #gv-logic-edit 内の詳細HTML（サイドバー + SVGキャンバス）
- [x] style.css: ロジック編集タブのスタイル
- [x] app.js: initGlobalLogicEditTab() 実装
- [x] app.js: renderGlobalLogicGraph() 実装（stations → SVGノード, connections → 矢印線）
- [x] app.js: ノードドラッグ移動（位置を localStorage キャッシュ）
- [x] app.js: ノードダブルクリック → openLocalWindow() 呼び出し
- [x] app.js: 新規設備ボタン → ダイアログで設備名入力 → API作成
- [x] app.js: 工場選択時にグラフを自動更新

## 実装後の振り返り

**実装完了日**: 2026-05-15

**計画との差分**:
- JSONインポートは完全な上書き同期ではなく、工場基本情報のみ更新してサーバーから再フェッチする形に簡略化（API側でバルクインポートエンドポイントが存在しないため）
- ロジック編集の「新規設備」は配置モードではなく、ダイアログで名前入力後にAPI作成する方式に変更（位置は自動レイアウトで決定）

**学んだこと**:
- Three.js の ResizeObserver と renderer を分離してコンテナを差し替える `attachTo` パターンが有効
- SVGのドラッグ実装では document 上のイベントリスナーで管理することでドラッグ中のズレを防ぐ

**次回への改善提案**:
- `updateFactory` API エンドポイントがバックエンドに未実装の場合、工場情報の保存ボタンが失敗するため、バックエンド側の追加が必要
- `createStation` API エンドポイントも同様に追加が必要
- ロジック編集のキャンバスはスクロール対応（現状は SVG の viewBox 固定）にすると大規模工場に対応できる
