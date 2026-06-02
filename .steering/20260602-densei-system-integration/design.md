# 設計書

## アーキテクチャ概要

ビルド時プレースホルダ置換方式で「ローカル単体」と「densei-system 配下（/digital-twin）」を両立する。

```
[densei-system 配下]
ブラウザ → system-proxy (/digital-twin/* を rewrite で除去) 
        → digital-twin-proxy:80 (素の /portal /api /ws を受ける)
        → sim-portal / factory-visualizer / sim-factory-manager / realtime-gateway / simulation-core

[ローカル単体（従来）]
ブラウザ → nginx-proxy:443(HTTPS) → 同上（BASE_PREFIX空でビルド）
```

フロントは `__BASE_PREFIX__` を埋め込んだ状態でリポジトリに保持し、Docker ビルド時の `ARG BASE_PREFIX` で sed 置換する。
- BASE_PREFIX="" → `/api`, `/ws/live`（ローカル）
- BASE_PREFIX="/digital-twin" → `/digital-twin/api`, `/digital-twin/ws/live`（統合）

## コンポーネント設計

### 1. フロント JS/HTML（プレースホルダ化）

**責務**: ブラウザが叩く絶対パスにプレフィックスを反映する。

**実装の要点**:
- JS のベース定数（`BASE`, `API`, `SIMULATION_CORE_URL`, `SERVICE_URLS`）、WS URL、window.open URL、HTML の `<a href="/...">` を `__BASE_PREFIX__` 付きに。
- 相対パス（`./api.js`, `index.html`, CSS/画像/GLB）は変更しない。

### 2. 各サブツール Dockerfile（ビルド時注入）

**責務**: プレースホルダを実値に置換。

**実装の要点**:
```dockerfile
ARG BASE_PREFIX=""
RUN find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.html' \) \
      -exec sed -i "s|__BASE_PREFIX__|${BASE_PREFIX}|g" {} +
```
- 区切り文字は `|`（パスに `/` を含むため）。
- ローカル docker-compose は BASE_PREFIX 未指定（=空）。

### 3. digital-twin-proxy（HTTP 入口）

**責務**: プレフィックス除去後のリクエストを各サービスへ振り分け。

**実装の要点**:
- 現行 `nginx-proxy/nginx.conf` から HTTPS 終端・証明書・HTTPリダイレクトを除いた HTTP:80 版。
- location は流用: `/portal/`→sim-portal、`/factory-visualizer/`→factory-visualizer、`/factory/`→sim-factory-manager、`/api/simulations`→simulation-core:8080、`/api/`→realtime-gateway:8090、`/ws`→realtime-gateway:8090（WS upgrade込み）。

### 4. compose.digital-twin.yml（統合用）

**責務**: densei-system ルートから include される統合 compose。

**実装の要点**:
- postgres / simulation-core / factory-poller / realtime-gateway / 3フロント / digital-twin-proxy を定義。
- フロント3つは `build.args.BASE_PREFIX: /digital-twin`。
- 入口は digital-twin-proxy:80（nginx-proxy/443は含めない）。
- ビルドコンテキストは submodule 配置を想定（README で記載）。ローカル既存 docker-compose.yml とは別ファイルで共存。

## データフロー

### 統合配下でのAPIアクセス
```
1. ブラウザが /digital-twin/portal/ を開く
2. ページ内JSが fetch('/digital-twin/api/factories')
3. system-proxy が /digital-twin を除去 → /api/factories で digital-twin-proxy へ
4. digital-twin-proxy が /api/ → realtime-gateway:8090/api/factories へ
5. realtime-gateway は素の /api/factories を受けて処理（無改修）
```

## テスト戦略

### 非回帰（ローカル単体）
- `docker compose up -d --build` で従来通り全機能動作。Network で `/api` `/ws/live` がプレフィックスなし。

### 統合相当
- `docker compose -f compose.digital-twin.yml build`（BASE_PREFIX=/digital-twin）。
- 手前に rewrite する簡易 nginx を立て `/digital-twin/portal/` へアクセス、Network で `/digital-twin/...` 確認、WS接続確認。

### 成果物チェック
- `docker run --rm <image> grep -r __BASE_PREFIX__ /usr/share/nginx/html` が空。

## ディレクトリ構造

```
factory-simulation/
├── factory-visualizer/{Dockerfile, html/js/{api.js,app.js}, html/...}   # 変更
├── sim-portal/{Dockerfile, html/js/api.js}                              # 変更
├── sim-factory-manager/{Dockerfile, html/js/api.js,factory.js, *.html}  # 変更
├── digital-twin-proxy/nginx.conf                                        # 新規
├── compose.digital-twin.yml                                             # 新規
├── docker-compose.yml                                                   # 不変（ローカル単体）
└── README.md                                                            # 追記
```

## 実装の順序

1. フロント JS/HTML のプレースホルダ化（A）
2. Dockerfile に BASE_PREFIX 注入（B）
3. digital-twin-proxy/nginx.conf 作成（C）
4. compose.digital-twin.yml 作成（D）
5. README 追記（E）
6. 検証（非回帰 + プレフィックス配下）

## セキュリティ考慮事項

- TLS は densei-system 上位の AWS 層で終端する前提。digital-twin-proxy は内部 HTTP のみ。

## 将来の拡張性

- 他システム同様、BASE_PREFIX を変えれば別プレフィックスでも再利用可能。
