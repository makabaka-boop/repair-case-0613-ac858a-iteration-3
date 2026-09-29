"""docker compose verify 服务的端到端验收脚本。

对真实运行的 api / web 容器发起请求（无 mock、无固定结果），任一检查失败
即以非零码退出。覆盖：健康检查、真实差分、最短性（独立 LCS 参照）、
轨迹重放等于目标、422 INVALID_INPUT（含经 nginx）、422 DIFF_LIMIT、20000 项。
"""

from __future__ import annotations

import json
import os
import random
import sys
import urllib.error
import urllib.request

API_URL = os.environ.get("API_URL", "http://api:8000")
WEB_URL = os.environ.get("WEB_URL", "http://web:80")

failures: list[str] = []


def request(method: str, url: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def check(name: str, cond: bool, detail=""):
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}{(' — ' + detail) if detail and not cond else ''}")
    if not cond:
        failures.append(name)


def lcs_distance(a, b) -> int:
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b, 1):
            cur.append(prev[j - 1] + 1 if x == y else max(prev[j], cur[j - 1]))
        prev = cur
    return len(a) + len(b) - 2 * prev[-1]


def replay(a, b, rows):
    out = []
    for r in rows:
        if r["type"] == "keep":
            assert a[r["source"]] == b[r["target"]]
            out.append(a[r["source"]])
        elif r["type"] == "insert":
            out.append(b[r["target"]])
    return out


def split_blocks(rows, n, m):
    """与 app/blocks.py 同规则的独立参照实现：连续非 keep 行归一块。"""
    blocks = []
    i = 0
    while i < len(rows):
        if rows[i]["type"] == "keep":
            i += 1
            continue
        start = i
        while i < len(rows) and rows[i]["type"] != "keep":
            i += 1
        end = i
        sub = rows[start:end]
        prev_keep = next((rows[j] for j in range(start - 1, -1, -1) if rows[j]["type"] == "keep"), None)
        next_keep = next((rows[j] for j in range(end, len(rows)) if rows[j]["type"] == "keep"), None)
        dels = [r["source"] for r in sub if r["type"] == "delete"]
        inss = [r["target"] for r in sub if r["type"] == "insert"]
        if dels:
            ss = prev_keep["source"] + 1 if prev_keep else 0
            se = next_keep["source"] if next_keep else n
        else:
            ss = se = (prev_keep["source"] + 1 if prev_keep else (next_keep["source"] if next_keep else 0))
        if inss:
            ts = prev_keep["target"] + 1 if prev_keep else 0
            te = next_keep["target"] if next_keep else m
        else:
            ts = te = (prev_keep["target"] + 1 if prev_keep else (next_keep["target"] if next_keep else 0))
        blocks.append({"id": len(blocks), "rows": (start, end), "s": (ss, se), "t": (ts, te)})
    return blocks


def mixed_replay(a, b, rows, blocks, accepted_ids):
    """一次性按原始 source 坐标重放；不选=source，全选=target。"""
    row_block = {}
    for blk in blocks:
        for r in range(*blk["rows"]):
            row_block[r] = blk["id"]
    out = []
    for i, r in enumerate(rows):
        chosen = row_block.get(i) in accepted_ids
        if r["type"] == "keep":
            out.append(a[r["source"]])
        elif r["type"] == "delete":
            if not chosen:
                out.append(a[r["source"]])
        elif chosen:
            out.append(b[r["target"]])
    return out


def main() -> int:
    # 1. 健康检查
    status, body = request("GET", f"{API_URL}/health")
    check("api /health", status == 200 and body == {"status": "ok"})

    try:
        with urllib.request.urlopen(f"{WEB_URL}/", timeout=10) as resp:
            index = resp.read().decode()
            web_index_ok = resp.status == 200 and '<div id="root"></div>' in index
    except (urllib.error.URLError, urllib.error.HTTPError):
        index, web_index_ok = "", False
    check("web 提供前端页面", web_index_ok)

    # 2. 真实差分 + 零基下标 + 重放
    status, data = request(
        "POST", f"{API_URL}/diff", {"source": [1, 2, 3], "target": [1, 4, 3]}
    )
    ok = (
        status == 200
        and data["distance"] == 2
        and [(r["type"], r["source"], r["target"]) for r in data["alignment"]]
        == [("keep", 0, 0), ("insert", None, 1), ("delete", 1, None), ("keep", 2, 2)]
    )
    check("真实差分与零基下标", ok, str(data)[:300])
    check(
        "轨迹重放精确等于目标",
        replay([1, 2, 3], [1, 4, 3], data["alignment"]) == [1, 4, 3],
    )

    # 3. 经 nginx 反代联调：既取页面，也走 /api/diff
    status, data = request(
        "POST", f"{WEB_URL}/api/diff", {"source": [9, 8], "target": [8, 9]}
    )
    check(
        "经 web nginx 反代调用 /api/diff",
        status == 200 and data["distance"] == 2,
        str(data)[:200],
    )

    # 4. 随机用例：距离必须等于独立 LCS 参照，重放必须等于目标
    rng = random.Random(424242)
    shortest_ok = replay_ok = True
    for _ in range(60):
        size = rng.randint(0, 16)
        a = [rng.randint(0, 5) for _ in range(size)]
        b = [rng.randint(0, 5) for _ in range(size)]
        status, data = request("POST", f"{API_URL}/diff", {"source": a, "target": b})
        if status != 200 or data["distance"] != lcs_distance(a, b):
            shortest_ok = False
            break
        if replay(a, b, data["alignment"]) != b:
            replay_ok = False
            break
    check("最短性（60 组随机输入对拍 LCS）", shortest_ok)
    check("随机轨迹重放等于目标", replay_ok)

    # 4b. 分块混合重放：连续非 keep 行成块；不选=source、全选=target，
    # 任一块子集都能一次性按原始坐标重放（不逐块套用、无下标漂移）。
    mixed_ok = True
    for seed in (7, 77, 777):
        rng = random.Random(seed)
        for _ in range(20):
            size = rng.randint(0, 18)
            a = [rng.randint(0, 5) for _ in range(size)]
            b = [rng.randint(0, 5) for _ in range(size)]
            status, data = request("POST", f"{API_URL}/diff", {"source": a, "target": b})
            if status != 200:
                mixed_ok = False
                break
            rows = data["alignment"]
            blocks = split_blocks(rows, len(a), len(b))
            if mixed_replay(a, b, rows, blocks, frozenset()) != a:
                mixed_ok = False
                break
            all_ids = frozenset(blk["id"] for blk in blocks)
            if mixed_replay(a, b, rows, blocks, all_ids) != b:
                mixed_ok = False
                break
            # 抽查若干子集：长度 = N - 已采纳删除数 + 已采纳插入数。
            for mask in range(1 << min(len(blocks), 6)):
                chosen = frozenset(i for i in range(len(blocks)) if mask & (1 << i))
                seq = mixed_replay(a, b, rows, blocks, chosen)
                expect_len = len(a) - sum(
                    blk["s"][1] - blk["s"][0] for blk in blocks if blk["id"] in chosen
                ) + sum(
                    blk["t"][1] - blk["t"][0] for blk in blocks if blk["id"] in chosen
                )
                if len(seq) != expect_len:
                    mixed_ok = False
                    break
    check("分块混合重放：不选=source、全选=target、子集长度守恒", mixed_ok)

    # 4c. 典型相邻改写：插入与删除同一边界，必须同属一块。
    status, data = request(
        "POST", f"{API_URL}/diff", {"source": [1, 2, 3, 4, 5], "target": [1, 8, 3, 9, 5]}
    )
    if status == 200:
        blocks = split_blocks(data["alignment"], 5, 5)
        rows = data["alignment"]
        adjacent_ok = (
            len(blocks) == 2
            and blocks[0]["s"] == (1, 2)
            and blocks[0]["t"] == (1, 2)
            and blocks[1]["s"] == (3, 4)
            and blocks[1]["t"] == (3, 4)
            and mixed_replay([1, 2, 3, 4, 5], [1, 8, 3, 9, 5], rows, blocks, frozenset({0}))
            == [1, 8, 3, 4, 5]
        )
    else:
        adjacent_ok = False
    check("相邻改写块边界稳定且可逐块批准", adjacent_ok)

    # 5. INVALID_INPUT
    bad_payloads = [
        {"source": [1, 2.5], "target": []},
        {"source": ["1"], "target": []},
        {"source": [True], "target": []},
        {"source": [-1], "target": []},
        {"source": [2_147_483_648], "target": []},
        {"source": [0] * 20_001, "target": []},
        {"source": "nope", "target": []},
        {"target": []},
    ]
    invalid_ok = True
    for p in bad_payloads:
        status, data = request("POST", f"{API_URL}/diff", p)
        if status != 422 or data.get("detail", {}).get("code") != "INVALID_INPUT":
            invalid_ok = False
            print("   未命中的非法输入：", p, "->", status, data)
            break
    check("越界/非整数/超长/结构错误 -> 422 INVALID_INPUT", invalid_ok)

    # 非法输入经 nginx 同样裁决
    status, data = request("POST", f"{WEB_URL}/api/diff", {"source": [3.1], "target": []})
    check(
        "经 nginx 的非法输入 -> 422 INVALID_INPUT",
        status == 422 and data["detail"]["code"] == "INVALID_INPUT",
    )

    # 边界值合法
    status, _ = request(
        "POST",
        f"{API_URL}/diff",
        {"source": [0, 2_147_483_647], "target": [0, 2_147_483_647]},
    )
    check("0 与 2147483647 为合法值", status == 200)

    # 6. DIFF_LIMIT：802 > 800
    status, data = request(
        "POST", f"{API_URL}/diff", {"source": [1] * 401, "target": [2] * 401}
    )
    check(
        "d=802 -> 422 DIFF_LIMIT",
        status == 422 and data["detail"]["code"] == "DIFF_LIMIT",
        str(data)[:200],
    )
    # d=800 恰好可达
    status, data = request(
        "POST", f"{API_URL}/diff", {"source": [1] * 400, "target": [2] * 400}
    )
    check("d=800 恰好成功", status == 200 and data["distance"] == 800)

    # 7. 规模上限：两组各 20000 项、距离很小
    big = list(range(20_000))
    big_target = list(big)
    big_target[12345] = 2_147_483_647
    status, data = request("POST", f"{API_URL}/diff", {"source": big, "target": big_target})
    check(
        "各 20000 项真实联调成功且距离为 2",
        status == 200 and data["distance"] == 2,
        str(data)[:200] if status != 200 else "",
    )
    if status == 200:
        check(
            "20000 项轨迹重放等于目标",
            replay(big, big_target, data["alignment"]) == big_target,
        )

    print()
    if failures:
        print(f"验收失败：{len(failures)} 项 -> {failures}")
        return 1
    print("全部验收通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
