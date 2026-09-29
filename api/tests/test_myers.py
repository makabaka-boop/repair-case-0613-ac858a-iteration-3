"""算法性质：最短性、删除优先裁决、轨迹重放等于目标。"""

import random

from app.myers import bounded_myers, replay


def lcs_distance(a, b):
    """朴素 LCS 参照解，用于交叉验证最短插入/删除距离。"""
    n, m = len(a), len(b)
    prev = [0] * (m + 1)
    for i in range(1, n + 1):
        cur = [0] * (m + 1)
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                cur[j] = prev[j - 1] + 1
            else:
                cur[j] = max(prev[j], cur[j - 1])
        prev = cur
    return n + m - 2 * prev[m]


def run_and_check(a, b, max_d=800):
    res = bounded_myers(a, b, max_d=max_d)
    assert res is not None, (a, b)
    d, rows = res
    assert d == lcs_distance(a, b), (a, b, d)
    # 轨迹自身代价必须等于报告距离。
    assert sum(1 for op, _, _ in rows if op != "keep") == d
    # 重放必须精确得到目标。
    assert replay(a, b, rows) == list(b)
    # 下标零基、单调、覆盖完整。
    si = [s for op, s, _ in rows if op in ("keep", "delete")]
    ti = [t for op, _, t in rows if op in ("keep", "insert")]
    assert si == list(range(len(a)))
    assert ti == list(range(len(b)))
    return d, rows


def test_empty():
    d, rows = run_and_check([], [])
    assert d == 0 and rows == []


def test_pure_insert_and_delete_shortest():
    # 完全不相交：距离必须为长度之和，不可能被错误压缩。
    run_and_check([1, 2], [3, 4])
    run_and_check([1, 2, 3], [])
    run_and_check([], [5, 6])


def test_keeps_along_diagonal():
    # 相同编号自动沿对角线保留。平局点选删除前驱（k-1），其在 d=1 边界只能
    # 先经插入到达，故完整对齐顺序为 keep, insert, delete, keep。
    d, rows = run_and_check([1, 2, 3], [1, 4, 3])
    ops = [r[0] for r in rows]
    assert ops == ["keep", "insert", "delete", "keep"]
    assert d == 2


def test_tie_prefers_delete():
    # [1,2] -> [2,1] 是典型平局：d=2、k=0 上插入与删除到达相同 x(=2)。
    # 规则要求选删除前驱 v[k-1]+1；而 k=-1 在 d=1 边界只能由插入到达，
    # 因此轨迹确定为 insert, keep, delete（与“插入优先”实现的
    # delete, keep, insert 恰好相反），以此裁决固定唯一结果。
    d, rows = run_and_check([1, 2], [2, 1])
    assert d == 2
    assert [r[0] for r in rows] == ["insert", "keep", "delete"]
    # 零基下标正确：插入目标下标 0，保留源 0↔目标 1，删除源下标 1。
    insert_row = next(r for r in rows if r[0] == "insert")
    keep_row = next(r for r in rows if r[0] == "keep")
    delete_row = next(r for r in rows if r[0] == "delete")
    assert insert_row[1:] == (None, 0)
    assert keep_row[1:] == (0, 1)
    assert delete_row[1:] == (1, None)


def test_tie_prefers_delete_prefix_mismatch():
    # 首项相同、随后分歧且插入/删除平局：删除前驱路径仍从插入起步，
    # 最后一步为删除（回溯时先遇到 delete）。
    _, rows = run_and_check([5, 1, 2], [5, 2, 1])
    assert rows[0] == ("keep", 0, 0)
    assert rows[-1][0] == "delete"
    assert [r[0] for r in rows] == ["keep", "insert", "keep", "delete"]


def test_randomized_shortest_and_replay():
    rng = random.Random(20260916)
    for _ in range(300):
        size = rng.randint(0, 14)
        a = [rng.randint(0, 4) for _ in range(size)]
        b = [rng.randint(0, 4) for _ in range(size)]
        run_and_check(a, b)


def test_edit_sequences_with_same_length_but_gaps():
    # 在成片上做几处删除/插入的模拟：序列长、距离小。
    a = list(range(0, 500))
    b = [x for x in a if x % 37 != 0]  # 删除若干项
    b = b[:5] + [9000000, 9000001] + b[5:]  # 再插入两个新镜头
    run_and_check(a, b)


def test_limit_boundary():
    # d=2 恰好等于 max_d=2 时必须成功，d=3 时必须判定超限。
    assert bounded_myers([1, 2, 3], [4, 5, 6], max_d=2) is None
    res = bounded_myers([1, 2], [2, 1], max_d=2)
    assert res is not None and res[0] == 2


def test_limit_800():
    # 完全不相交，距离 800 可达；802 不可达。
    a = [1] * 400
    b = [2] * 400
    assert bounded_myers(a, b)[0] == 800
    assert bounded_myers(a + [1], b + [2], max_d=800) is None


def test_large_arrays_small_distance():
    # 20000 项、仅少量改动：验证不会构建逐格矩阵、能在线性级时间内返回。
    n = 20_000
    a = list(range(n))
    b = [v for v in a if v not in (123, 4567, 19999)]
    b.insert(10, 2_147_483_647)
    run_and_check(a, b)
