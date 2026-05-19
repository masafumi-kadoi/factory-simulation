# タスクリスト: グローバルロジックビュー ポート表示修正

## フェーズ1: 実装

- [x] app.js: `_gleExtractPorts(machineStation)` ヘルパー関数を `_gleEquips` の直前に追加
- [x] app.js: `_gleEquips()` のentry/exit取得を state.stations 検索から config.equipmentLayout.members 参照に変更
- [x] app.js: `_gleStationToEquip()` のentry/exit登録をconfig参照に変更
- [x] app.js: `gleHandleConnectInteraction()` 内 `resolveRepSid()` をconfig参照に変更

## 実装後の振り返り

- 実装完了日: 2026-05-20
- 計画との差分: なし
- 学んだこと: entry/exitはfactory_stationsの独立レコードではなく機器configのJSONに埋め込まれている。state.stationsを直接検索するコードは常に空を返す。
- 次回への改善提案: 保存方式をDB独立レコード化することで検索が単純化できる（ただし移行コストあり）。
