# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ1: フロント絶対パスのプレースホルダ化

- [x] factory-visualizer
  - [x] `html/js/api.js:4` `BASE = '/api'` → `'__BASE_PREFIX__/api'`
  - [x] `html/js/app.js:729,913` WS URL に `__BASE_PREFIX__` 付与
  - [x] `html/js/app.js:1120` `/factory-visualizer/local-window.html` に `__BASE_PREFIX__` 付与
- [x] sim-portal
  - [x] `html/js/api.js:4` `SIMULATION_CORE_URL = '/api'` → `'__BASE_PREFIX__/api'`
  - [x] `html/js/api.js:6-9` `SERVICE_URLS`（/factory-visualizer, /factory）に `__BASE_PREFIX__` 付与
  - [x] `html/js/api.js:62-64` サービスチェックURL（/api/data-sources, /factory/, /factory-visualizer/）に `__BASE_PREFIX__` 付与
- [x] sim-factory-manager
  - [x] `html/js/api.js:2` `API = '/api'` → `'__BASE_PREFIX__/api'`
  - [x] `html/js/factory.js:21,80` `/editor/editor.html` に `__BASE_PREFIX__` 付与
  - [x] `html/index.html:14` `<a href="/portal/">` に `__BASE_PREFIX__` 付与
  - [x] `html/factory.html:14` `<a href="/portal/">` に `__BASE_PREFIX__` 付与

## フェーズ2: Dockerfile に BASE_PREFIX 注入

- [x] `factory-visualizer/Dockerfile` に `ARG BASE_PREFIX` + sed 置換 RUN を追加
- [x] `sim-portal/Dockerfile` に同上
- [x] `sim-factory-manager/Dockerfile` に同上

## フェーズ3: 統合用プロキシと compose

- [x] `digital-twin-proxy/nginx.conf`（HTTP:80, プレフィックス除去後ルーティング）を新規作成
- [x] `digital-twin-proxy/Dockerfile` を新規作成
- [x] `compose.digital-twin.yml`（フロント BASE_PREFIX=/digital-twin, 入口 digital-twin-proxy:80）を新規作成

## フェーズ4: ドキュメント更新

- [x] README.md に densei-system 統合手順 + proxy/services/digital-twin.conf.template 例を追記

## フェーズ5: 品質チェックと検証

- [x] ローカル単体非回帰: `docker compose build` 成功、成果物が `/api` `/portal/` 等（従来通り）
- [x] ローカル成果物に `__BASE_PREFIX__` が残らない（grep 0件）
- [x] プレフィックスビルド: `docker compose -f compose.digital-twin.yml build` 成功
- [x] プレフィックス成果物に `/digital-twin/api` `/digital-twin/ws/live` 等が反映、`__BASE_PREFIX__` 残らない（grep 0件）
- [x] `compose.digital-twin.yml config` 構文検証 OK

---

## 実装後の振り返り

### 実装完了日
2026-06-02

### 計画と実績の差分

**計画通り進んだ点**:
- ビルド時 sed 置換方式（プレースホルダ `__BASE_PREFIX__`）で、ローカル単体（空）と
  densei-system 配下（/digital-twin）の両立を実現。両ビルドで成果物を grep 検証し意図通り。
- Go バックエンドは無改修（system-proxy のプレフィックス除去機構に乗る）方針が成立。

**計画から微調整した点**:
- `compose.digital-twin.yml` では postgres のマイグレーションを 1ファイルずつではなく
  `./database/migrations:/docker-entrypoint-initdb.d:ro` のディレクトリマウントに簡略化
  （中身が連番 .sql のみであることを確認済み。lexical 順で適用される）。
- 検証は `docker compose up`（起動・E2E画面確認）まではローカル環境では行わず、
  ビルド成果物の静的検証（プレフィックス反映 + プレースホルダ残存ゼロ）+ compose config 検証で代替。
  起動E2Eは densei-system 統合作業時に実施する想定。

### 学んだこと

**技術的な学び**:
- signage-system の統合パターン（rewrite でプレフィックス除去 → サブモジュール内部プロキシ）を
  踏襲することで、バックエンド改修ゼロで統合可能。フロントの絶対パスのみが論点だった。
- 同名イメージのため 2つの compose で交互にビルドすると上書きされる。検証後はローカル用を再ビルドして復帰。

### 次回への改善提案
- densei-system 本体への submodule 追加・proxy テンプレ追加・起動E2E は別ステアリングで実施。
- 将来、プロジェクト名（`-p`）を分けるか別イメージ名にすると 2モードのイメージ共存が可能。

### スコープ外（記録）
- `/editor/editor.html` の実体不在（既存リンク切れ）。今回はプレフィックス付与のみ。
