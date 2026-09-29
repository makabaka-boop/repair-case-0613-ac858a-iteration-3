"""有界 Myers 差分（仅允许插入 / 删除，代价均为 1）。

坐标约定：编辑网格中 x 为源序列下标、y 为目标序列下标，对角线 k = x - y。
- 向右 (x+1, y)：删除一个源项，k 增加 1，前驱对角线为 k-1。
- 向下 (x, y+1)：插入一个目标项，k 减少 1，前驱对角线为 k+1。
- 相等编号沿对角线“白走”（snake），自动保留。

扩展顺序：编辑距离 d 从 0 递增；同一层内对角线 k 从 -d 到 d 递增，
维护每条对角线上能到达的最远 x。插入与删除能到达相同 x 时选择删除前驱
（向右，k-1）。到达 (N, M) 立即停止，并按同一规则回溯完整对齐。

只保留 V 的逐层快照而不是 N*M 矩阵：长片（各 20000 项、d<=800）时
内存约为 O(d^2) 而非 O(N*M)。
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence, Tuple

# 一行对齐：(操作, 源下标或 None, 目标下标或 None)
Row = Tuple[str, Optional[int], Optional[int]]


def bounded_myers(
    a: Sequence[Any], b: Sequence[Any], max_d: int = 800
) -> Optional[Tuple[int, List[Row]]]:
    """计算最短插入/删除脚本。

    返回 (距离, 对齐行)；距离超过 ``max_d`` 时返回 None。
    """
    n, m = len(a), len(b)

    # v[k] = 当前 d 层、对角线 k 上可达的最远 x（跨层复用，读取的 k±1 必为上一层写入）。
    v: dict[int, int] = {0: 0}

    # d = 0：沿 0 号对角线白走相等前缀。
    x = y = 0
    while x < n and y < m and a[x] == b[y]:
        x += 1
        y += 1
    v[0] = x
    trace: List[dict[int, int]] = [dict(v)]
    if x >= n and y >= m:
        return 0, _backtrack(a, b, trace, 0)

    for d in range(1, max_d + 1):
        for k in range(-d, d + 1, 2):
            if k == -d:
                # 边界：只能从 k+1 向下（插入）到达。
                x = v[k + 1]
            elif k == d:
                # 边界：只能从 k-1 向右（删除）到达。
                x = v[k - 1] + 1
            else:
                x_insert = v[k + 1]          # 向下（插入前驱 k+1）
                x_delete = v[k - 1] + 1      # 向右（删除前驱 k-1）
                # 相同 x 时选删除前驱。
                x = x_delete if x_delete >= x_insert else x_insert

            y = x - k
            while x < n and y < m and a[x] == b[y]:
                x += 1
                y += 1
            v[k] = x

            if x >= n and y >= m:
                trace.append(dict(v))
                rows = _backtrack(a, b, trace, d)
                return d, rows

        trace.append(dict(v))

    return None


def _backtrack(
    a: Sequence[Any],
    b: Sequence[Any],
    trace: Sequence[dict[int, int]],
    total_d: int,
) -> List[Row]:
    """依据各层 V 快照，从终点按与前向相同的裁决规则回溯。"""
    n, m = len(a), len(b)
    x, y = n, m
    rows: List[Row] = []

    for d in range(total_d, 0, -1):
        prev = trace[d - 1]
        k = x - y
        if k == -d:
            pred_k = k + 1  # 插入
        elif k == d:
            pred_k = k - 1  # 删除
        elif prev[k - 1] + 1 >= prev[k + 1]:
            pred_k = k - 1  # 相同 x 时同样选删除前驱
        else:
            pred_k = k + 1

        prev_x = prev[pred_k]
        prev_y = prev_x - pred_k

        # 前驱点之后那一步编辑的落点，即 snake 的起点。
        if pred_k == k - 1:
            start_x, start_y = prev_x + 1, prev_y
        else:
            start_x, start_y = prev_x, prev_y + 1

        # 沿对角线倒走白送的相等步。
        while x > start_x and y > start_y:
            rows.append(("keep", x - 1, y - 1))
            x -= 1
            y -= 1

        if pred_k == k - 1:
            rows.append(("delete", prev_x, None))
        else:
            rows.append(("insert", None, prev_y))
        x, y = prev_x, prev_y

    # d = 0 的初始 snake。
    while x > 0 and y > 0:
        rows.append(("keep", x - 1, y - 1))
        x -= 1
        y -= 1

    rows.reverse()
    return rows


def replay(a: Sequence[Any], b: Sequence[Any], rows: Sequence[Row]) -> List[Any]:
    """按轨迹重放，必须精确得到目标序列；下标与取值不一致即轨迹非法。"""
    out: List[Any] = []
    for op, s, t in rows:
        if op == "keep":
            if s is None or t is None or a[s] != b[t]:
                raise ValueError("非法的 keep 行")
            out.append(a[s])
        elif op == "delete":
            if s is None or t is not None:
                raise ValueError("非法的 delete 行")
            # 删除不产生输出，但仍校验下标处的值。
            _ = a[s]
        elif op == "insert":
            if t is None or s is not None:
                raise ValueError("非法的 insert 行")
            out.append(b[t])
        else:
            raise ValueError(f"未知操作: {op}")
    return out
