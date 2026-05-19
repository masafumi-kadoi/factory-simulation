# 要求: グローバルロジックビューでentry/exitポートを表示

## 問題
ローカルビューのロジック編集でentry/exitステーションを設備内に配置・保存しても、
グローバルロジックビュー（設備間の接続を管理するキャンバス）でポート円が表示されない。

## 根本原因
entry/exitステーションはDBの`factory_stations`に独立レコードとして保存されず、
マシン設備の `config.equipmentLayout.members` JSON内に埋め込まれて保存される。

グローバルビューの実装 (`_gleEquips`, `_gleStationToEquip`) は
`state.stations`（=`factory_stations`テーブルの全レコード）を検索するが、
entry/exitはそこに存在しないためポート配列が常に空になる。

## 期待する動作
- グローバルビューで設備ノードを描画する際、設備の円形の縁に
  entry/exitポートの小さな円（衛星のような配置）が表示される
- exitポート: 緑の小円（設備円の右側）
- entryポート: オレンジの小円（設備円の左側）
- ポートクリックで接続ツールが動作する
