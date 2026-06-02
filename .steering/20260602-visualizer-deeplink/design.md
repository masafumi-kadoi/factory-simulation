# 設計書

## アーキテクチャ概要

manager がURLに行き先情報（ds/factoryId/kind）を載せ、visualizer が起動時に読んで自動選択する。後方互換のため visualizer は逆引きフォールバックも持つ。

## 変更内容

### sim-factory-manager/html/js/factory.js
- View(行, 83行付近): `?ds=${d.id}&factoryId=${FACTORY_ID}&kind=${d.sourceType}`（encodeURIComponent）。
- Open Viewer(live, 99行付近): `?ds=${currentDataSourceId}&live=1&factoryId=${FACTORY_ID}`。

### factory-visualizer/html/js/app.js

**起動ブロック（DOMContentLoaded, loadFactories() 後）**
- `URLSearchParams(location.search)` で ds/live/factoryId/kind 取得。ds 無→何もしない。try/catchでフォールバック。

**resolveDataSource(dsId)（新規helper）**
- factoryId+kind が揃えばAPIスキップ。不足時 `API.fetchDataSources()` 全件→ `find(d=>d.id===dsId)`。無→null。

**selectFactory(factoryId, opts={})**
- `preferredDsId` を loadRealtimeData/loadSimulationResults に伝播。
- 末尾で preferredKind に応じ rtP/simP を返す（既存呼び出しは無視）。

**loadRealtimeData(factoryId, gen, preferredDsId=null)**
- 自動選択を preferredDsId 優先に: `find(id===preferred) || find(!endedAt) || [0]`。

**loadSimulationResults(factoryId, gen, preferredDsId=null)**
- `chosen = preferredDsId ? (find(id===preferred)||[0]) : [0]` 、以降 chosen.id 使用。

**オーケストレーション**
- プルダウン value 設定。kind 判定（live優先、なければ sourceType）。
- `await selectFactory(...)`。kind==='sim' なら await 後、世代チェック（state.simDataSourceId===ds）→ timeline.selectSimulation/btn-stop-sim有効/switchDataSourceMode('sim')/seekToSimStart。
- kind==='realtime' は loadRealtimeData が全処理済みのため追加不要。

## 再利用関数

- API.fetchDataSources()（api.js:98, 引数なし全件）
- loadSimulationIntoRightZone(app.js:607) / switchDataSourceMode(952) / seekToSimStart(708) / factoryName(776)
- 実行履歴クリックの sim オープン手順（app.js:346-366）が手本

## テスト戦略

- docker compose build factory-visualizer sim-factory-manager → up。
- curl で /api/data-sources の id/sourceType/factoryId 確認、R(realtime)/S(sim) 採取。
- ブラウザ: realtime/sim/逆引き/不正/無指定/レース の各ケース。
