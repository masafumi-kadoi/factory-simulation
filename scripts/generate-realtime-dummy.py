#!/usr/bin/env python3
"""
Test Factory 用リアルタイムダミーデータ生成スクリプト

過去24時間分の工場稼働データを生成して factory_simulation DB へ投入する。
実際の工場DBからポーリングしたデータと同じ形式（source_type='realtime'）。

ライン構成 (Test Factory):
  source → proc1(entry→processing→exit) → proc2(entry→proc1→proc2→exit)
         → proc3(entry→proc1→proc2→exit) → proc4(entry→processing→exit) → drain

各ステーションの加工時間（実ファクトリースケール）:
  proc1.processing : 5分
  proc2.processing1: 6分  (直列2ステーション)
  proc2.processing2: 6分
  proc3.processing1: 8分  (直列2ステーション)
  proc3.processing2: 8分
  proc4.processing : 7分
  entry/exit transit: 12秒
  source→entry: 5秒

総サイクルタイム: ~42分/ワーク
24時間で約34ワーク完走 + pipeline上の進行中ワーク
"""

import psycopg2
import uuid
from datetime import datetime, timedelta, timezone
import random

# ---- 設定 ----
DB_DSN = "host=localhost port=5432 dbname=factory_simulation user=postgres password=postgres"
FACTORY_ID = "0ae4952c-92f5-413e-8aed-d74ab43cc436"  # Test Factory

# 現在時刻 (UTC)
NOW = datetime.now(timezone.utc).replace(microsecond=0)
START = NOW - timedelta(hours=24)

# 各ステーションの加工時間 (秒)
PROC_TIMES = {
    "proc1.001": 300,   # 5分
    "proc2.003": 360,   # 6分
    "proc2.004": 360,   # 6分
    "proc3.001": 480,   # 8分
    "proc3.002": 480,   # 8分
    "proc4.001": 420,   # 7分
}
TRANSIT_TIME = 12     # entry/exit 経由の秒数
SOURCE_INTERVAL = 385  # ワーク投入間隔 (秒) ≈ 6.4分

# ライン経路 (station名のリスト, entry/exit/processingを含む)
LINE = [
    "source.000",
    "proc1.002",   # entry
    "proc1.001",   # processing
    "proc1.003",   # exit
    "proc2.001",   # entry
    "proc2.003",   # processing
    "proc2.004",   # processing (直列)
    "proc2.002",   # exit
    "proc3.003",   # entry
    "proc3.001",   # processing (直列1)
    "proc3.002",   # processing (直列2)
    "proc3.004",   # exit
    "proc4.003",   # entry
    "proc4.001",   # processing
    "proc4.002",   # exit
    "drain.000",
]

# entry/exit の経由時間 (秒)
def station_time(name: str) -> float:
    if name in PROC_TIMES:
        return PROC_TIMES[name]
    if name in ("source.000", "drain.000"):
        return 0
    return TRANSIT_TIME  # entry/exit


def generate():
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()

    # 1. data_source 作成 (source_type='realtime')
    ds_id = str(uuid.uuid4())
    label = f"RealFactory_{NOW.strftime('%Y-%m-%dT%H:%M:%S')}"
    cur.execute("""
        INSERT INTO data_sources (id, source_type, factory_id, label, started_at, config, created_at)
        VALUES (%s, 'realtime', %s, %s, %s, '{}', NOW())
    """, (ds_id, FACTORY_ID, label, START))
    print(f"[data_source] id={ds_id}  label={label}")

    # 2. location_master 作成
    loc_map: dict[str, int] = {}  # station名 → location id
    stations_def = [
        ("drain.000",  "drain",      None, -43.4,  -10.9, 1,    None),
        ("source.000", "source",     None, -124.4, -14.7, 1,    None),
        ("proc1.001",  "processing", None, None,   None,  1,    PROC_TIMES["proc1.001"]),
        ("proc1.002",  "entry",      None, None,   None,  1,    None),
        ("proc1.003",  "exit",       None, None,   None,  1,    None),
        ("proc2.001",  "entry",      None, None,   None,  1,    None),
        ("proc2.002",  "exit",       None, None,   None,  1,    None),
        ("proc2.003",  "processing", None, None,   None,  1,    PROC_TIMES["proc2.003"]),
        ("proc2.004",  "processing", None, None,   None,  1,    PROC_TIMES["proc2.004"]),
        ("proc3.001",  "processing", None, None,   None,  1,    PROC_TIMES["proc3.001"]),
        ("proc3.002",  "processing", None, None,   None,  1,    PROC_TIMES["proc3.002"]),
        ("proc3.003",  "entry",      None, None,   None,  1,    None),
        ("proc3.004",  "exit",       None, None,   None,  1,    None),
        ("proc4.001",  "processing", None, None,   None,  1,    PROC_TIMES["proc4.001"]),
        ("proc4.002",  "exit",       None, None,   None,  1,    None),
        ("proc4.003",  "entry",      None, None,   None,  1,    None),
    ]
    for (name, stype, parent, px, py, cap, pt) in stations_def:
        cur.execute("""
            INSERT INTO location_master (data_source_id, name, station_type, pos_x, pos_y, max_capacity, processing_time)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (ds_id, name, stype, px, py, cap, pt))
        loc_id = cur.fetchone()[0]
        loc_map[name] = loc_id
    print(f"[location_master] {len(loc_map)} entries created")

    # 3. connection_master 作成
    connections = [
        ("source.000", "proc1.002"),
        ("proc1.002",  "proc1.001"),
        ("proc1.001",  "proc1.003"),
        ("proc1.003",  "proc2.001"),
        ("proc2.001",  "proc2.003"),
        ("proc2.003",  "proc2.004"),
        ("proc2.004",  "proc2.002"),
        ("proc2.002",  "proc3.003"),
        ("proc3.003",  "proc3.001"),
        ("proc3.001",  "proc3.002"),
        ("proc3.002",  "proc3.004"),
        ("proc3.004",  "proc4.003"),
        ("proc4.003",  "proc4.001"),
        ("proc4.001",  "proc4.002"),
        ("proc4.002",  "drain.000"),
    ]
    for (frm, to) in connections:
        cur.execute("""
            INSERT INTO connection_master (data_source_id, from_location_id, to_location_id)
            VALUES (%s, %s, %s)
        """, (ds_id, loc_map[frm], loc_map[to]))
    print(f"[connection_master] {len(connections)} entries created")

    # 4. item_movement イベント生成
    events: list[tuple] = []  # (event_time, item_id, from_loc_id, to_loc_id, movement_type)

    # ワークIDを生成 (SOURCE_INTERVAL 秒おきに投入)
    work_ids = []
    t = START
    while t < NOW + timedelta(hours=24):  # 未来分も生成 (予測検証用ではなく、現在進行中ワーク用)
        work_ids.append((str(uuid.uuid4()), t))
        t += timedelta(seconds=SOURCE_INTERVAL + random.randint(-30, 30))

    item_types: dict[str, str] = {}

    for (work_id, inject_time) in work_ids:
        item_types[work_id] = random.choice(["TypeA", "TypeA", "TypeA", "TypeB", "TypeB", "TypeC"])
        cur_time = inject_time

        prev_loc = None
        for station in LINE:
            loc_id = loc_map[station]
            transit = station_time(station)

            if station == "source.000":
                # source からの出発イベントのみ
                arrived_at = cur_time
                events.append((arrived_at, work_id, None, loc_id, "arrived"))
                depart_at = arrived_at + timedelta(seconds=5)
                events.append((depart_at, work_id, loc_id, loc_map["proc1.002"], "departed"))
                prev_loc = loc_id
                cur_time = depart_at
                continue

            if station == "drain.000":
                arrived_at = cur_time + timedelta(seconds=5)
                events.append((arrived_at, work_id, prev_loc, loc_id, "arrived"))
                break

            # 通常ステーション: 到着 → 処理 → 出発
            arrived_at = cur_time + timedelta(seconds=5)
            events.append((arrived_at, work_id, prev_loc, loc_id, "arrived"))

            # 次のステーションへの出発
            next_idx = LINE.index(station) + 1
            if next_idx < len(LINE):
                next_station = LINE[next_idx]
                next_loc_id = loc_map[next_station]
                depart_at = arrived_at + timedelta(seconds=transit)
                events.append((depart_at, work_id, loc_id, next_loc_id, "departed"))
                prev_loc = loc_id
                cur_time = depart_at
            else:
                break

    # 現在時刻以降のイベントを除外 (リアルタイムデータは過去のみ)
    events_past = [(et, wi, fl, tl, mt) for (et, wi, fl, tl, mt) in events if et <= NOW]

    print(f"[item_movement] total generated={len(events)}, past only={len(events_past)}")

    # item_master 挿入
    used_works = set(wi for (_, wi, _, _, _) in events_past)
    for work_id in used_works:
        cur.execute("""
            INSERT INTO item_master (id, data_source_id, item_type)
            VALUES (%s, %s, %s)
            ON CONFLICT DO NOTHING
        """, (work_id, ds_id, item_types.get(work_id, "TypeA")))
    print(f"[item_master] {len(used_works)} items")

    # item_movement バルク挿入
    events_past.sort(key=lambda e: e[0])
    batch = []
    for (et, wi, fl, tl, mt) in events_past:
        batch.append((et, ds_id, wi, fl, tl, mt))

    cur.executemany("""
        INSERT INTO item_movement (event_time, data_source_id, item_id, from_location_id, to_location_id, movement_type)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, batch)
    print(f"[item_movement] {len(batch)} events inserted")

    # data_source の ended_at は NULL のまま (進行中)
    conn.commit()
    cur.close()
    conn.close()
    print(f"\n✓ Done. data_source_id = {ds_id}")
    print(f"  period: {START.isoformat()} → {NOW.isoformat()}")
    print(f"  works injected: {len(work_ids)}, past events: {len(events_past)}")


if __name__ == "__main__":
    generate()
