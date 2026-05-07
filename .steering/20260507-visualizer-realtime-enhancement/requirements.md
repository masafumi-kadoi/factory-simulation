# 要求定義: Visualizerリアルタイム機能拡張

## 背景

SimulationVisualizerは現在シミュレーション結果の再生表示のみに対応している。
工場の実稼働データもWDHスキーマ（SimDB）に同フォーマットで格納する仕組みを導入し、
同一Visualizerでシミュレーション結果とリアルタイム工場データの両方を可視化可能にする。

## 要求一覧

### R-1: 実工場データのリアルタイム表示

- 工場設備稼働情報がData Transformer経由でWDHテーブル（item_movement等）に格納される
- Visualizerは最新のイベントをリアルタイムに受信・表示する
- 通信方式はPush（WebSocket、PostgreSQL NOTIFY経由）を採用する
- リアルタイム監視セッションは工場ごとに1つ

### R-2: シミュレーション結果との同時表示

- 実工場データとシミュレーションデータを同一画面で重ねて表示可能
- 各レイヤーは独立して表示/非表示を切り替え可能
- 各レイヤーの色・透明度はユーザー設定可能
- シミュレーション結果はプルダウンリストで選択可能
- 絶対時刻（TIMESTAMPTZ）基準で時間軸を揃えて表示する

### R-3: Live表示モード

- Liveボタンを押すと実工場データは最新状態に追従表示
- Liveモード中はシミュレーションデータも実工場と同じ時刻を表示
- Liveモード中のシークバーは中央固定（時間軸が流れる）
- シークバー操作でLive解除→履歴表示モードに移行
- WebSocket切断時は「LIVE LOST」表示、自動リトライ（exponential backoff）、再接続時にgap埋め
- シミュレーションデータはバッファ内で継続再生可能（WS切断の影響を受けない）

### R-4: Factory概念の導入

- シナリオの上位概念としてFactoryを新設
- Factory単位でステーション定義（マスタ）を管理
- station_id命名規則: `{equipment_id}.{3桁ゼロ埋め連番}`
- Factory配下に複数シナリオを紐付け（継承+オーバーライド方式）
- オーバーライド種別: add / modify / remove
- 工場DB接続設定をFactory単位で保持

### R-5: Realtime Gateway新設 + sim-executor-backend統合

- Viewer唯一のアクセス先としてRealtime Gatewayを新設
- REST API（データ取得 + 実行管理）+ WebSocket（リアルタイム配信）を統合
- sim-executor-backendの実行管理機能をGatewayに統合し、sim-executor-backendは廃止
- simulation-coreは疎結合のまま実行専用サービスとして維持（ステートレス、将来Queue化対応）
- PostgreSQL LISTEN/NOTIFYによるイベント通知（フルペイロード方式）

### R-6: バッファコンベアの可視化

- バッファコンベアはModulerステーションで実現（bufferCapacity属性は廃止）
- 搬送方式: PUSH（押せ押せ）/ PULL（フリーフロー）を選択可能
  - 搬送方式の違いはインターロック条件設定の違いのみ
- 外観表示: ゲージバー + 数値 + ドット流れアニメーション + 色グラデーション
- 展開表示: 内部スロットのワーク移動アニメーション
- LOD（Level of Detail）: ズームレベルに応じた表示切替
- シナリオエディタにバッファコンベアテンプレート機能（パラメータ入力→内部自動生成）

### R-7: データベース再構築

- 既存スキーマ（work_events, station_status_logs, simulation_runs）を完全廃止
- WDHスキーマ（item_movement, machine_signal等）に統一
- 単一DB統合方式（factory_simulationに全テーブル集約）
- data_source_idカラムによる論理分離（シミュレーション/リアルタイム）
- タイムスタンプはTIMESTAMPTZ（絶対時刻）に統一
- 月次パーティショニングによるパフォーマンス確保
- リアルタイムデータ保持期間: 3ヶ月

### R-8: Factory管理画面

- 新規画面（sim-factory-manager）を追加
- ステーション定義: GUI手入力 + CSVインポート
- CSVインポート: 全件ロールバック方式（1行でもエラーで全件キャンセル）
- SimDB(WDH)とのバリデーション機能（未登録ステーション検出、設備ID突合等）
- リアルタイム監視セッションの開始/停止操作
- Viewerへの遷移（Liveモード自動起動）

### R-9: アーキテクチャ刷新

- nginx-proxy新設（プロキシ専用、TLS終端）
- sim-portalからプロキシ機能を分離（静的HTML配信専用化）
- HTTPS対応（自己署名証明書、wss://対応）
- 外部公開ポートは443/80のみ、パスベースルーティング
- 全フロントエンドサービスはAPIプロキシ削除（静的ファイル配信専用）

## 制約事項

- Data Transformerは既存Docker運用、現在1秒ポーリング（変更可能だが今回は維持）
- simulation-coreは将来コンテナ単位スケーリング予定のため密結合禁止
- DB接続情報のセキュリティは初期段階では平文許容
- simulation-coreに新ロジック追加は最小限（PUSH/PULLはインターロック設定のみ）
