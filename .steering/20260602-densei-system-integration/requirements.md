# 要求内容

## 概要

このシステム（factory-simulation / リモート名 densei-digital-twin）を、複数システムを git submodule で束ねる統合リポジトリ **densei-system** に `/digital-twin/` パスプレフィックス配下のサブモジュールとして組み込めるよう、digital-twin リポジトリ側を改修する。

## 背景

densei-system は既に communication-system / signage-system / proxy の3サブモジュールを持ち、各システムを `/＜名前＞/*` のパスプレフィックスで `system-proxy` がルーティングする規約になっている。system-proxy は `rewrite ^/＜名前＞(/.*)$ $1 break;` でプレフィックスを除去してからサブモジュール内部プロキシへ転送する。

このパターンに合わせるには、ブラウザが絶対パスで叩く URL（API/WS/ツール間リンク）に `/digital-twin` プレフィックスを付与する必要がある。一方で従来のローカル単体起動（docker-compose）も維持したい。Go バックエンドはプレフィックス除去後の素のパスを受け続けるため改修不要。

## 実装対象の機能

### 1. フロント絶対パスのプレフィックス対応（ビルド時注入）
- 3サブツール（factory-visualizer / sim-portal / sim-factory-manager）の JS/HTML 内ハードコード絶対パスを `__BASE_PREFIX__` プレースホルダ化
- 各 Dockerfile に `ARG BASE_PREFIX` を追加し、ビルド時に sed で置換
- densei-system 配下では `/digital-twin`、ローカル単体では空文字に置換され従来動作

### 2. 統合用の入口プロキシと compose
- HTTP 専用の `digital-twin-proxy/nginx.conf`（プレフィックス除去後のリクエストを各サービスへ振り分け）
- 統合用 `compose.digital-twin.yml`（フロントを BASE_PREFIX=/digital-twin でビルド、入口は digital-twin-proxy:80）

### 3. ドキュメント
- README に densei-system 統合手順（submodule追加、proxy テンプレ例）を追記

## 受け入れ条件

### フロントプレフィックス対応
- [ ] ローカル単体（BASE_PREFIX空）で従来通り `/api` `/ws/live` `/portal/` 等が動作（非回帰）
- [ ] プレフィックスビルド（/digital-twin）で `/digital-twin/api` `/digital-twin/ws/live` が叩かれる
- [ ] ビルド成果物に `__BASE_PREFIX__` が残らない

### 統合用プロキシ/compose
- [ ] digital-twin-proxy が HTTP:80 で API/WS/フロントを正しくルーティング
- [ ] compose.digital-twin.yml でビルド・起動が成功

## 成功指標

- 既存ローカル単体起動が一切壊れない（非回帰）
- `/digital-twin/portal/` 相当でプレフィックス配下アクセスが成立する

## スコープ外

以下はこのフェーズでは実装しません:

- densei-system 本体への submodule 追加 / proxy/services テンプレ追加（別作業。手順のみ README に記載）
- `/editor/editor.html` 実体の不在（既存のリンク切れ。プレフィックス付与のみ行い実体修正は別途）
- Go バックエンドの改修（プレフィックス除去後の素のパスを受けるため不要）

## 参照ドキュメント

- `docs/architecture.md` - アーキテクチャ設計書
- `ARCHITECTURE.md` / `DATA-FLOW.md` - 現行構成
- densei-system の `compose.signage.yml` / `proxy/services/signage-system.conf.template`（統合パターンの参照元）
