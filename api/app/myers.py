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

from array import array
from typing import Any, List, Optional, Sequence, Tuple

# 一行对齐：(操作, 源下标或 None, 目标下标或 None)
Row = Tuple[str, Optional[int], Optional[int]]

# 约束模式的独立规模上限。该模式使用带“当前连续删除长度”的网格 DP，
# 与未启用模式的 O(d^2) 有界 Myers 使用不同边界。
CONSTRAINED_MAX_ITEMS = 300

_INF = 1_000_000
_OP_KEEP = 1
_OP_INSERT = 2
_OP_DELETE = 3
# 与现有 Myers 同优裁决一致：在同一网格点若编辑步与白送 keep 等价，
# 不强制立即 snake；插入/删除平局时选择删除。回溯顺序因此为 delete、insert、keep。
_OP_PRIORITY = {_OP_DELETE: 0, _OP_INSERT: 1, _OP_KEEP: 2}


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


def constrained_shortest(
    a: Sequence[Any], b: Sequence[Any], max_delete_run: int
) -> Optional[Tuple[int, List[Row]]]:
    """在“最终脚本不得连续删除超过 max_delete_run 项”下求最短脚本。

    状态为 (x, y, r)：r 是到达该网格点后的当前连续删除长度，插入或保留
    都会重置为 0。这里直接在受约束状态空间中做最短路径 DP，而不是先求
    无约束最短脚本、事后再过滤。

    同价裁决沿用现有 Myers 的删除优先规则：比较从终点反向看到的操作序列时，
    delete 优先于 insert；keep 是零代价 snake，本身不会与编辑步同价。
    无合法脚本时返回 None。
    """
    if not 1 <= max_delete_run <= 3:
        raise ValueError("max_delete_run 必须为 1、2 或 3")

    n, m = len(a), len(b)
    width = m + 1
    size = (n + 1) * width
    states = max_delete_run + 1

    # 每个 r 一张扁平网格；parent 编码父状态与最后一条边，rank 是同一网格点内
    # 按上述同优规则给出的路径次序。新模式有独立 300 项边界，用紧凑整数数组
    # 避免 O(NM) Python 整数对象开销。
    dp = [array("i", [_INF] * size) for _ in range(states)]
    parent = [array("q", [-1] * size) for _ in range(states)]
    rank = [array("b", [-1] * size) for _ in range(states)]

    def index(x: int, y: int) -> int:
        return x * width + y

    def encode_parent(px: int, py: int, pr: int, op: int) -> int:
        return (((pr * (n + 1) + px) * width + py) * 4 + op) + 1

    def decode_parent(code: int) -> Tuple[int, int, int, int]:
        value = code - 1
        op = value % 4
        value //= 4
        py = value % width
        value //= width
        px = value % (n + 1)
        pr = value // (n + 1)
        return px, py, pr, op

    def best_prefix(base: int) -> Optional[Tuple[int, int, int]]:
        """同一父网格点上，先选最小代价，再按同优规则选路径。"""
        best_cost = _INF
        best_r = -1
        best_rank = 0
        for r in range(states):
            cost = dp[r][base]
            if cost == _INF:
                continue
            candidate_rank = rank[r][base]
            if cost < best_cost or (
                cost == best_cost and candidate_rank < best_rank
            ):
                best_cost = cost
                best_r = r
                best_rank = candidate_rank
        if best_r < 0:
            return None
        return best_cost, best_r, best_rank

    start = index(0, 0)
    dp[0][start] = 0
    parent[0][start] = 0
    rank[0][start] = 0

    for x in range(n + 1):
        for y in range(m + 1):
            if x == 0 and y == 0:
                continue

            cur = index(x, y)
            candidates: List[Tuple[int, int, int, int, int]] = []
            # 候选：(代价, 当前 r, 最后操作, 父 r, 父 rank)

            # 向下：插入目标项，连续删除计数清零。
            if y > 0:
                prefix = best_prefix(index(x, y - 1))
                if prefix is not None:
                    cost, pr, prank = prefix
                    candidates.append(
                        (cost + 1, 0, _OP_INSERT, pr, prank)
                    )

            # 对角线：相等才允许保留，连续删除计数清零。
            if x > 0 and y > 0 and a[x - 1] == b[y - 1]:
                prefix = best_prefix(index(x - 1, y - 1))
                if prefix is not None:
                    cost, pr, prank = prefix
                    candidates.append((cost, 0, _OP_KEEP, pr, prank))

            # r=0 只可能由 keep/insert 到达；插入是编辑步，优先级高于白送 keep。
            reset_candidates = [c for c in candidates if c[1] == 0]
            if reset_candidates:
                chosen = min(
                    reset_candidates,
                    key=lambda c: (c[0], _OP_PRIORITY[c[2]], c[4]),
                )
                cost, _, op, pr, _prank = chosen
                dp[0][cur] = cost
                parent[0][cur] = encode_parent(
                    x - 1 if op == _OP_KEEP else x,
                    y - 1,
                    pr,
                    op,
                )

            # 向右：删除源项。父状态 r-1 必须存在；r=max_delete_run 后
            # 不能再删除，因此不会生成 r=max_delete_run+1。
            if x > 0:
                base = index(x - 1, y)
                for r in range(1, states):
                    pr = r - 1
                    if dp[pr][base] == _INF:
                        continue
                    dp[r][cur] = dp[pr][base] + 1
                    parent[r][cur] = encode_parent(x - 1, y, pr, _OP_DELETE)

            # 给当前网格点的可达 r 状态指定本地同优次序：delete、insert、keep；
            # 同一操作再比较父网格点中的路径次序。
            reachable = []
            for r in range(states):
                code = parent[r][cur]
                if code < 0:
                    continue
                _, _, _, op = decode_parent(code)
                prank = -1
                if op in (_OP_KEEP, _OP_INSERT, _OP_DELETE):
                    px, py, prefix_r, _ = decode_parent(code)
                    prank = rank[prefix_r][index(px, py)]
                reachable.append((_OP_PRIORITY[op], prank, r))

            reachable.sort()
            for local_rank, (_, _, r) in enumerate(reachable):
                rank[r][cur] = local_rank

    end = index(n, m)
    terminal: Optional[Tuple[int, int]] = None
    for r in range(states):
        if dp[r][end] == _INF:
            continue
        if terminal is None or (
            dp[r][end], rank[r][end]
        ) < (dp[terminal[0]][end], rank[terminal[0]][end]):
            terminal = (r, rank[r][end])

    if terminal is None:
        return None

    rows: List[Row] = []
    x, y = n, m
    r = terminal[0]
    while x > 0 or y > 0:
        code = parent[r][index(x, y)]
        px, py, pr, op = decode_parent(code)
        if op == _OP_KEEP:
            rows.append(("keep", px, py))
        elif op == _OP_INSERT:
            rows.append(("insert", None, py))
        else:
            rows.append(("delete", px, None))
        x, y, r = px, py, pr

    rows.reverse()
    return dp[terminal[0]][end], rows


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
