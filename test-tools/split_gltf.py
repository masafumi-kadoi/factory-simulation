"""
zenkotai.gltf を機械プレフィックスごとに分割して machines/ に GLB バイナリで書き出す。

修正点:
  1. 出力形式を .gltf (base64 埋め込み) → .glb (バイナリ) に変更
     local-window の GLBインポートは ArrayBuffer + model/gltf-binary を期待するため
  2. ノードの translation を XZ 方向に中心化
     元データはシーン全体のワールド座標なので、そのままでは原点から大きくずれ
     プレビューカメラ(原点向き)に映らない
"""
import json
import base64
import re
import os
import struct
from collections import defaultdict

INPUT = "zenkotai.gltf"
OUT_DIR = "machines"

with open(INPUT, encoding="utf-8-sig") as f:
    g = json.load(f)

nodes = g["nodes"]
meshes = g["meshes"]
accessors = g["accessors"]
bufferViews = g["bufferViews"]
buffers = g["buffers"]

# デコード（base64 埋め込みまたは外部 .bin 両対応）
buf_uri = buffers[0]["uri"]
if buf_uri.startswith("data:"):
    _, b64 = buf_uri.split(",", 1)
    buf_data = base64.b64decode(b64)
else:
    with open(buf_uri, "rb") as f:
        buf_data = f.read()


def machine_key(name: str) -> str:
    clean = name.lstrip("_")
    if clean.startswith("db-sbppmc"):
        return "db-sbppmc"
    m = re.match(r"^(\d+)", clean)
    return m.group(1) if m else "unknown"


def make_glb(gltf_dict: dict, buffer_bytes: bytes) -> bytes:
    """GLTF JSON dict + バイナリバッファ → GLB バイナリ。"""
    copy = dict(gltf_dict)
    copy["buffers"] = [{"byteLength": len(buffer_bytes)}]

    # JSON chunk: UTF-8、4 バイト境界までスペースでパディング
    json_bytes = json.dumps(copy, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_pad = (4 - len(json_bytes) % 4) % 4
    json_chunk_data = json_bytes + b" " * json_pad

    # BIN chunk: 4 バイト境界まで \0 でパディング
    buf_pad = (4 - len(buffer_bytes) % 4) % 4
    bin_chunk_data = buffer_bytes + b"\x00" * buf_pad

    # chunkLength は padding 込みの長さ
    json_chunk = struct.pack("<II", len(json_chunk_data), 0x4E4F534A) + json_chunk_data
    bin_chunk = struct.pack("<II", len(bin_chunk_data), 0x004E4942) + bin_chunk_data

    total_length = 12 + len(json_chunk) + len(bin_chunk)
    header = struct.pack("<III", 0x46546C67, 2, total_length)
    return header + json_chunk + bin_chunk


# ノードを機械ごとにグループ化
machine_nodes: dict[str, list[int]] = defaultdict(list)
for ni, node in enumerate(nodes):
    machine_nodes[machine_key(node.get("name", ""))].append(ni)

os.makedirs(OUT_DIR, exist_ok=True)

for machine, node_indices in sorted(machine_nodes.items()):
    # メッシュインデックス収集
    mesh_indices = sorted({nodes[ni]["mesh"] for ni in node_indices if "mesh" in nodes[ni]})

    # アクセサインデックス収集
    acc_set: set[int] = set()
    for mi in mesh_indices:
        for prim in meshes[mi]["primitives"]:
            if "indices" in prim:
                acc_set.add(prim["indices"])
            for v in prim.get("attributes", {}).values():
                acc_set.add(v)
    acc_indices = sorted(acc_set)

    # bufferView インデックス収集
    bv_indices = sorted({accessors[ai]["bufferView"] for ai in acc_indices if "bufferView" in accessors[ai]})

    # 新バッファ構築（4 バイトアライン）
    new_buf = bytearray()
    bv_new_offset: dict[int, int] = {}
    for bvi in bv_indices:
        bv = bufferViews[bvi]
        while len(new_buf) % 4:
            new_buf += b"\x00"
        bv_new_offset[bvi] = len(new_buf)
        start = bv.get("byteOffset", 0)
        new_buf += buf_data[start:start + bv["byteLength"]]

    bv_map = {old: new for new, old in enumerate(bv_indices)}
    acc_map = {old: new for new, old in enumerate(acc_indices)}
    mesh_map = {old: new for new, old in enumerate(mesh_indices)}

    # 新 bufferViews
    new_bvs = []
    for bvi in bv_indices:
        bv = dict(bufferViews[bvi])
        bv["buffer"] = 0
        bv["byteOffset"] = bv_new_offset[bvi]
        new_bvs.append(bv)

    # 新 accessors
    new_accs = []
    for ai in acc_indices:
        acc = dict(accessors[ai])
        if "bufferView" in acc:
            acc["bufferView"] = bv_map[acc["bufferView"]]
        new_accs.append(acc)

    # 新 meshes
    new_meshes = []
    for mi in mesh_indices:
        mesh = meshes[mi]
        new_prims = []
        for prim in mesh["primitives"]:
            p = dict(prim)
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            p["attributes"] = {k: acc_map[v] for k, v in prim.get("attributes", {}).items()}
            new_prims.append(p)
        new_mesh = dict(mesh)
        new_mesh["primitives"] = new_prims
        new_meshes.append(new_mesh)

    # 新 nodes: translation の XZ 方向を中心化
    # 元データはシーン全体のワールド座標なので、グループの重心を原点に移動する
    raw_nodes = [dict(nodes[ni]) for ni in node_indices]
    translations = [n.get("translation", [0.0, 0.0, 0.0]) for n in raw_nodes]
    n_count = len(translations)
    cx = sum(t[0] for t in translations) / n_count
    cz = sum(t[2] for t in translations) / n_count

    new_nodes = []
    for node in raw_nodes:
        if "mesh" in node:
            node["mesh"] = mesh_map[node["mesh"]]
        t = node.get("translation", [0.0, 0.0, 0.0])
        node["translation"] = [t[0] - cx, t[1], t[2] - cz]
        new_nodes.append(node)

    new_gltf = {
        "asset": g["asset"],
        "scene": 0,
        "scenes": [{"name": f"machine_{machine}", "nodes": list(range(len(new_nodes)))}],
        "nodes": new_nodes,
        "meshes": new_meshes,
        "accessors": new_accs,
        "bufferViews": new_bvs,
        # buffers は make_glb が BIN chunk 用に設定する
    }

    glb_data = make_glb(new_gltf, bytes(new_buf))
    out_path = os.path.join(OUT_DIR, f"{machine}.glb")
    with open(out_path, "wb") as f:
        f.write(glb_data)

    print(f"  {out_path}: nodes={len(new_nodes)}, meshes={len(new_meshes)}, size={len(glb_data):,} bytes")

print("Done.")
