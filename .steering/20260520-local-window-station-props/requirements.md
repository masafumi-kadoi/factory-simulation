# 要求: ローカルビュー ロジック編集 プロパティ拡充

## 概要
ローカルビューのロジック編集画面で設定できるステーションプロパティが、
ScenarioEditorと比べて大幅に不足している。ScenarioEditorと同等の項目を編集できるようにする。

## 現状（local-window.html/js）
- 名前
- タイプ（source/processing/drain/merge/split/entry/exit）
- 位置 X, Y
- 処理時間（processingTime）—全タイプ共通で1つだけ
- Location ID

## ScenarioEditorで設定できていた項目（タイプ別）

### source
- workCount（Work Count）
- departureTime（Departure Time）
- continuous（チェックボックス: ONでworkCountを自動計算）
- workType（Work Type文字列）

### processing
- processingTime（Processing Time）
- arrivalTime（Arrival Time）
- departureTime（Departure Time）

### drain
- arrivalTime（Arrival Time）

### merge
- processingTime（Processing Time）
- arrivalTime（Arrival Time）
- departureTime（Departure Time）
- mergeCount（入力ポート数）
- 各ポートのcapacity（inPorts[].capacity）
- outputWorkType（出力ワーク種別）

### split
- processingTime（Processing Time）
- arrivalTime（Arrival Time）
- departureTime（Departure Time）
- splitCount（出力ポート数）
- 各ポートのcapacity（outPorts[].capacity）

### entry / exit
- 追加項目なし（現状のまま）

## スコープ外
- インターロック条件編集（専用モーダル不要）
- SimDB連携のLocationドロップダウン（数値入力のまま）
- switch/modulerタイプ（ローカルビューのタイプ一覧にない）
