"""最大连续删除限制：受约束最短性、同优裁决与无脚本预言机对拍。"""

from __future__ import annotations

import random
from typing import Any, List, Optional, Tuple

from app.myers import bounded_myers, constrained_shortest, replay

Row = Tuple[str, Optional[int], Optional[int]]

_OP_RANK = {"delete": 0, "insert": 1, "keep": 2}


def max_delete_run(rows: List[Row]) -> int:
    best = current = 0
    for op, _, _ in rows:
        if op == "delete":
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def enumerate_legal_scripts(a: list[Any], b: list[Any], limit: int):
    """短序列 DFS 预言机：枚举所有满足最终连续删除上限的合法脚本。"""
    scripts: list[list[str]] = []
    current: list[str] = []

    def dfs(x: int, y: int, run: int):
        if x == len(a) and y == len(b):
            scripts.append(list(current))
            return

        if x < len(a) and y < len(b) and a[x] == b[y]:
            current.append("keep")
            dfs(x + 1, y + 1, 0)
            current.pop()

        if y < len(b):
            current.append("insert")
            dfs(x, y + 1, 0)
            current.pop()

        if x < len(a) and run < limit:
            current.append("delete")
            dfs(x + 1, y, run + 1)
            current.pop()

    dfs(0, 0, 0)
    return scripts


def oracle(a: list[Any], b: list[Any], limit: int):
    scripts = enumerate_legal_scripts(a, b, limit)
    if not scripts:
        return None
    shortest = min(sum(op != "keep" for op in script) for script in scripts)
    # 从终点向前比较最后一步：delete > insert > keep。这正是现有 Myers
    # “插入/删除同点时选删除，不强制立即 snake”的确定性裁决。
    canonical = min(
        (
            script
            for script in scripts
            if sum(op != "keep" for op in script) == shortest
        ),
        key=lambda script: tuple(_OP_RANK[op] for op in reversed(script)),
    )
    return shortest, canonical


def assert_constrained(a: list[int], b: list[int], limit: int):
    expected = oracle(a, b, limit)
    result = constrained_shortest(a, b, limit)
    if expected is None:
        assert result is None
        return None

    expected_distance, expected_ops = expected
    assert result is not None, (a, b, limit)
    distance, rows = result
    assert distance == expected_distance
    assert [op for op, _, _ in rows] == expected_ops
    assert replay(a, b, rows) == b
    assert max_delete_run(rows) <= limit
    assert sum(op != "keep" for op, _, _ in rows) == distance
    return rows


def test_insert_must_break_delete_run():
    # 无约束最短：keep 后连删 3 个（距离 3）。limit=2 时必须额外插入目标 1
    # 来打断删除，最终合法最短距离为 5。
    a, b = [1, 2, 3, 4], [1]
    assert [op for op, _, _ in bounded_myers(a, b)[1]] == [
        "keep",
        "delete",
        "delete",
        "delete",
    ]
    rows = assert_constrained(a, b, 2)
    assert rows is not None
    assert [op for op, _, _ in rows] == [
        "delete",
        "delete",
        "insert",
        "delete",
        "delete",
    ]
    assert max_delete_run(rows) == 2


def test_complete_delete_infeasible_when_target_cannot_break_run():
    # 目标为空时没有任何插入/keep 可打断删除；删除数超过限制即确实无解。
    for limit in (1, 2):
        assert constrained_shortest([1, 2, 3], [], limit) is None
    assert constrained_shortest([1, 2, 3], [], 3) is not None


def test_multiple_optimal_paths_keep_existing_delete_preference():
    # [1,2] -> [2,1] 有两条距离 2 的 LCS 脚本：
    # insert,keep,delete 与 delete,keep,insert；两者均满足 limit=1。
    # 同优裁决必须继续选择终点为 delete 的前者。
    rows = assert_constrained([1, 2], [2, 1], 1)
    assert rows is not None
    assert [op for op, _, _ in rows] == ["insert", "keep", "delete"]
    assert rows[0][1:] == (None, 0)
    assert rows[1][1:] == (0, 1)
    assert rows[2][1:] == (1, None)


def test_duplicate_shots_choose_same_canonical_as_myers_when_limit_nonbinding():
    rows = assert_constrained([1], [1, 1], 1)
    assert rows is not None
    assert [op for op, _, _ in rows] == ["keep", "insert"]

    rows = assert_constrained([1, 1], [1], 1)
    assert rows is not None
    assert [op for op, _, _ in rows] == ["keep", "delete"]

    rows = assert_constrained([1, 2, 1], [1, 1, 2], 1)
    assert rows is not None
    assert [op for op, _, _ in rows] == ["keep", "insert", "keep", "delete"]


def test_nonbinding_limit_preserves_old_myers_on_small_grid():
    # 长度不超过 3 时 limit=3 不可能绑定；受约束 DP 必须产出与旧 Myers
    # 完全相同的行级脚本，而不只是相同距离。
    for a, b in (
        ([1, 2, 3], [1, 4, 3]),
        ([1, 2], [2, 1]),
        ([1, 1], [1]),
        ([1], [1, 1]),
    ):
        _, old_rows = bounded_myers(a, b)
        result = constrained_shortest(a, b, 3)
        assert result is not None
        assert result[1] == old_rows


def test_oracle_randomized_short_sequences():
    rng = random.Random(20260929)
    checked = 0
    for limit in (1, 2, 3):
        for _ in range(180):
            n = rng.randint(0, 7)
            m = rng.randint(0, 7)
            a = [rng.randint(0, 3) for _ in range(n)]
            b = [rng.randint(0, 3) for _ in range(m)]
            assert_constrained(a, b, limit)
            checked += 1
    assert checked == 540


def test_constraint_is_enforced_during_search_not_as_postcheck():
    # 连续删除不能靠“插入最终仍会删除的原镜头”打断；插入只能来自目标。
    # 因此 [1..5] -> [1] 即使开头可保留，仍无法把剩余 4 个删除分成两段。
    # [1..6] -> [9,9] 需要两次目标插入，把 6 个删除分成三段。
    a, b = [1, 2, 3, 4, 5, 6], [9, 9]
    result = constrained_shortest(a, b, 2)
    assert result is not None
    distance, rows = result
    assert distance == 8
    assert max_delete_run(rows) == 2
    assert [op for op, _, _ in rows].count("insert") == 2
    assert replay(a, b, rows) == b
    assert constrained_shortest([1, 2, 3, 4, 5], [1], 2) is None
