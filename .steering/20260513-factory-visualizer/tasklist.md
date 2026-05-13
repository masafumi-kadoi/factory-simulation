# factory-visualizer タスクリスト

## ステータス凡例
- [ ] 未着手
- [~] 検討中・壁打ち中
- [x] 完了

---

## Phase 0: 壁打ち・仕様確定

- [x] UIレイアウト大枠の確定（イメージ画像ベース）
- [x] URL決定: `/factory-visualizer/`
- [x] テーマ決定: ダークネイビー
- [x] グローバル表示部 / ローカル表示部 の概念定義
- [x] DB統合方針決定: パターンC（factory_stations = scenario_stations）
- [~] 3D表示の詳細仕様（ユーザーが後で説明予定）
- [ ] データフロー詳細（3D表示説明と連動）
- [ ] ローカル表示部の保存/API仕様
- [ ] シミュレーション実行フロー（factory → simulation）

---

## Phase 1: DB統合マイグレーション

- [ ] 新スキーマ設計書作成
- [ ] マイグレーションSQL作成（015_unified_factory_schema.sql）
  - factory_stations に parent_id, position_z, DOUBLE PRECISION座標 追加
  - factory_connections の from/to_port_index デフォルト -1 に変更
  - scenarios / scenario_stations / scenario_connections を廃止 or 互換レイヤー
  - data_sources.scenario_id → factory_id への移行
- [ ] 既存データ移行スクリプト

---

## Phase 2: realtime-gateway リファクタリング

- [ ] `/api/scenarios` → `/api/factories` に統合
- [ ] `FactoryStation` に parent_id, position_z 追加
- [ ] シナリオ生成ロジック削除（factory_stationsを直接使用）
- [ ] シミュレーション実行 API の factory_id 対応

---

## Phase 3: simulation-core 対応

- [ ] シナリオ読み込みを factory_stations + factory_connections から行うよう変更
- [ ] Entry/Exit ステーションのエイリアス化（実質的な飾りとして扱う）

---

## Phase 4: factory-visualizer フロントエンド

### インフラ
- [ ] factory-visualizer/Dockerfile
- [ ] factory-visualizer/nginx.conf
- [ ] docker-compose.yml にサービス追加
- [ ] nginx-proxy に `/factory-visualizer/` ルート追加

### グローバル表示部
- [ ] メニューバー（Windowsスタイル: ファイル/編集/選択/表示/移動）
- [ ] ツールリボン（Office風）
- [ ] 左パネル（設備・ステーション・ワーク一覧、フィルタ、ソート）
- [ ] Three.js 3Dシーン（グローバル: モジュラー設備の配置表示）
- [ ] カメラパネル（3D空間内の吹き出しオブジェクト）
- [ ] AIエージェントパネル（右下フローティング、表示ON/OFF）
- [ ] タイムライン（過去●→現在●→未来○、再生コントロール）
- [ ] フローティング設備情報パネル（クリックで追加表示）

### ローカル表示部（別ウィンドウ、複数同時表示可）
- [ ] モデル情報編集タブ（設備名・メタ情報）
- [ ] 3Dモデル編集タブ（格子ボクセル or glTF/GLB インポート）
- [ ] ロジック編集タブ（上面視でステーション配置・接続線）
- [ ] 保存して閉じる

---

## 未決定事項（壁打ち継続）

- 3D表示の詳細（ユーザーが後で説明）
- ワーク一覧パネルの表示内容詳細
- フローティング設備情報パネルの表示項目詳細
- カメラ吹き出しオブジェクトの3D表現詳細
- ツールリボンのボタン詳細
