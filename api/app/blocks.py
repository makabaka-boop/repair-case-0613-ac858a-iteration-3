"""把最短对齐切分为不可拆分差异块，并按原始 source 坐标一次性重放。

分块规则（与界面逐块批准一致）：
- 连续的非 keep 行（delete/insert）归为同一个块；keep 行天然分隔两块。
- 因此“删除与同一边界的插入”天然落在同一块内
  （Myers 平局选删除前驱，典型相邻改写为 insert 紧接 delete）。
- 块编号按对齐顺序从 0 递增；源、目标跨度以**两侧零基边界**确定，
  对同一份对齐稳定不变。

跨度采用零基半开区间 [start, end)：
- 纯删除块：source 跨度覆盖被删源项，target 跨度为空区间 [t, t)；
- 纯插入块：target 跨度覆盖新插目标项，source 跨度为空区间 [s, s)；
- 相邻改写块：两侧跨度分别覆盖被删源项与新插目标项。

重放规则（单次扫描原始对齐，绝不逐块套用导致下标漂移）：
- keep 行始终产出；
- 已批准块：insert 产出目标值，delete 不产出（采纳目标侧）；
- 未批准块：delete 产出源值，insert 不产出（保留源侧）。
于是一块不选精确等于 source，全部选中精确等于 target。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, FrozenSet, List, Optional, Sequence, Tuple

Row = Tuple[str, Optional[int], Optional[int]]


@dataclass(frozen=True)
class Block:
    """不可拆分差异块。rows 为该块在完整对齐中的下标区间（半开）。"""

    id: int
    start_row: int
    end_row: int
    source_start: int
    source_end: int
    target_start: int
    target_end: int

    @property
    def row_range(self) -> range:
        return range(self.start_row, self.end_row)


def _row_span(
    rows: Sequence[Row], start: int, end: int, n: int, m: int
) -> Tuple[int, int, int, int]:
    """按两侧零基边界计算一块的源/目标半开跨度。

    边界来自最近的 keep 行（块前/块后），没有则取序列端点 0/N、0/M。
    """
    source_idx = [s for op, s, _ in rows[start:end] if op == "delete"]
    target_idx = [t for op, _, t in rows[start:end] if op == "insert"]

    prev_keep = next(
        (rows[i] for i in range(start - 1, -1, -1) if rows[i][0] == "keep"), None
    )
    next_keep = next(
        (rows[i] for i in range(end, len(rows)) if rows[i][0] == "keep"), None
    )

    if source_idx:
        source_start = (
            prev_keep[1] + 1 if prev_keep is not None and prev_keep[1] is not None else 0
        )
        source_end = (
            next_keep[1] if next_keep is not None and next_keep[1] is not None else n
        )
    else:
        # 纯插入：两侧边界落在同一条源边界上（空区间）。
        boundary = (
            prev_keep[1] + 1
            if prev_keep is not None and prev_keep[1] is not None
            else (next_keep[1] if next_keep is not None and next_keep[1] is not None else 0)
        )
        source_start = source_end = boundary

    if target_idx:
        target_start = (
            prev_keep[2] + 1 if prev_keep is not None and prev_keep[2] is not None else 0
        )
        target_end = (
            next_keep[2] if next_keep is not None and next_keep[2] is not None else m
        )
    else:
        # 纯删除：两侧边界落在同一条目标边界上（空区间）。
        boundary = (
            prev_keep[2] + 1
            if prev_keep is not None and prev_keep[2] is not None
            else (next_keep[2] if next_keep is not None and next_keep[2] is not None else 0)
        )
        target_start = target_end = boundary

    return source_start, source_end, target_start, target_end


def split_blocks(rows: Sequence[Row], n: int, m: int) -> List[Block]:
    """把对齐中连续的非 keep 行切分为编号稳定的差异块。"""
    blocks: List[Block] = []
    i = 0
    while i < len(rows):
        if rows[i][0] == "keep":
            i += 1
            continue
        start = i
        while i < len(rows) and rows[i][0] != "keep":
            i += 1
        end = i
        ss, se, ts, te = _row_span(rows, start, end, n, m)
        blocks.append(
            Block(
                id=len(blocks),
                start_row=start,
                end_row=end,
                source_start=ss,
                source_end=se,
                target_start=ts,
                target_end=te,
            )
        )
    return blocks


def mixed_replay(
    a: Sequence[Any],
    b: Sequence[Any],
    rows: Sequence[Row],
    accepted: FrozenSet[int] = frozenset(),
    blocks: Optional[Sequence[Block]] = None,
) -> List[Any]:
    """按块批准集合一次性重放出混合镜头序列。

    始终以原始 source 坐标 a[s]（及原始 target 坐标 b[t]）取值，
    单次扫描原始对齐：选择集合只是行级谓词，与批准先后无关，
    不会因先应用一块而漂移后续下标。

    - accepted 为空：精确得到 list(a)；
    - accepted 为全部块：精确得到 list(b)。
    """
    if blocks is None:
        blocks = split_blocks(rows, len(a), len(b))

    row_to_block: dict[int, int] = {}
    for blk in blocks:
        for r in blk.row_range:
            row_to_block[r] = blk.id

    out: List[Any] = []
    for i, (op, s, t) in enumerate(rows):
        chosen = row_to_block.get(i)
        is_accepted = chosen is not None and chosen in accepted
        if op == "keep":
            assert s is not None and t is not None and a[s] == b[t]
            out.append(a[s])
        elif op == "delete":
            assert s is not None and t is None
            if not is_accepted:
                # 未批准的删除：源镜头保留在混合序列中。
                out.append(a[s])
        elif op == "insert":
            assert t is not None and s is None
            if is_accepted:
                # 已批准的插入：目标镜头进入混合序列。
                out.append(b[t])
        else:
            raise ValueError(f"未知操作: {op}")
    return out
