"""不可拆分差异块：分块边界、稳定编号/跨度、一次性重放不变量。"""

import random

import pytest

from app.blocks import Block, mixed_replay, split_blocks
from app.myers import bounded_myers


def align(a, b):
    res = bounded_myers(a, b)
    assert res is not None
    return res[1]


def assert_replay_endpoints(a, b, rows, blocks):
    # 不选任何块：精确等于 source。
    assert mixed_replay(a, b, rows, frozenset(), blocks) == list(a)
    # 全选：精确等于 target。
    all_ids = frozenset(blk.id for blk in blocks)
    assert mixed_replay(a, b, rows, all_ids, blocks) == list(b)


def assert_stable_spans(a, b, rows, blocks):
    """跨度必须与块内删除/插入下标集合一致（两侧零基边界）。"""
    for blk in blocks:
        sub = rows[blk.start_row : blk.end_row]
        dels = [s for op, s, _ in sub if op == "delete"]
        inss = [t for op, _, t in sub if op == "insert"]
        if dels:
            assert (blk.source_start, blk.source_end) == (dels[0], dels[-1] + 1)
        else:
            assert blk.source_start == blk.source_end  # 纯插入：空源跨度
        if inss:
            assert (blk.target_start, blk.target_end) == (inss[0], inss[-1] + 1)
        else:
            assert blk.target_start == blk.target_end  # 纯删除：空目标跨度
        # 块内不得混入 keep。
        assert all(op != "keep" for op, _, _ in sub)


def test_no_blocks_for_identical_sequences():
    rows = align([1, 2, 3], [1, 2, 3])
    assert split_blocks(rows, 3, 3) == []


def test_pure_insert_is_single_block_with_empty_source_span():
    a, b = [1, 2], [1, 9, 8, 2]
    rows = align(a, b)
    blocks = split_blocks(rows, len(a), len(b))
    assert len(blocks) == 1
    blk = blocks[0]
    assert (blk.id, blk.start_row, blk.end_row) == (0, 1, 3)
    # 纯插入：源跨度为空区间 [1,1)，目标跨度覆盖 1、2。
    assert (blk.source_start, blk.source_end) == (1, 1)
    assert (blk.target_start, blk.target_end) == (1, 3)
    assert_replay_endpoints(a, b, rows, blocks)
    # 不批准 -> source；批准 -> target；无中间态歧义。
    assert mixed_replay(a, b, rows, frozenset({0}), blocks) == [1, 9, 8, 2]


def test_pure_delete_is_single_block_with_empty_target_span():
    a, b = [1, 7, 8, 2], [1, 2]
    rows = align(a, b)
    blocks = split_blocks(rows, len(a), len(b))
    assert len(blocks) == 1
    blk = blocks[0]
    assert (blk.source_start, blk.source_end) == (1, 3)
    # 纯删除：目标跨度为空区间 [1,1)。
    assert (blk.target_start, blk.target_end) == (1, 1)
    assert_replay_endpoints(a, b, rows, blocks)
    assert mixed_replay(a, b, rows, frozenset({0}), blocks) == [1, 2]


def test_adjacent_rewrite_groups_insert_and_delete_at_same_boundary():
    # [1,2,3] -> [1,4,3]：Myers 删除优先裁决产出 insert, delete 相邻，
    # 两者同一边界，必须归为同一块（不可拆分）。
    a, b = [1, 2, 3], [1, 4, 3]
    rows = align(a, b)
    assert [op for op, _, _ in rows] == ["keep", "insert", "delete", "keep"]
    blocks = split_blocks(rows, len(a), len(b))
    assert [blk.id for blk in blocks] == [0]
    blk = blocks[0]
    assert (blk.source_start, blk.source_end) == (1, 2)
    assert (blk.target_start, blk.target_end) == (1, 2)
    assert_replay_endpoints(a, b, rows, blocks)
    assert mixed_replay(a, b, rows, frozenset(), blocks) == [1, 2, 3]
    assert mixed_replay(a, b, rows, frozenset({0}), blocks) == [1, 4, 3]


def test_two_adjacent_rewrites_get_stable_increasing_block_numbers():
    # 两处相邻改写、中间隔着 keep：必须是编号稳定的两块，不得合并。
    a, b = [1, 2, 3, 4, 5], [1, 8, 3, 9, 5]
    rows = align(a, b)
    blocks = split_blocks(rows, len(a), len(b))
    assert len(blocks) == 2
    assert [blk.id for blk in blocks] == [0, 1]
    assert (blocks[0].source_start, blocks[0].source_end) == (1, 2)
    assert (blocks[0].target_start, blocks[0].target_end) == (1, 2)
    assert (blocks[1].source_start, blocks[1].source_end) == (3, 4)
    assert (blocks[1].target_start, blocks[1].target_end) == (3, 4)
    assert_replay_endpoints(a, b, rows, blocks)
    # 只批准第一块：第二块保持源侧，不存在下标漂移。
    assert mixed_replay(a, b, rows, frozenset({0}), blocks) == [1, 8, 3, 4, 5]
    assert mixed_replay(a, b, rows, frozenset({1}), blocks) == [1, 2, 3, 9, 5]
    # 批准顺序不影响结果（一次性按原始坐标重放）。
    assert mixed_replay(
        a, b, rows, frozenset({1}), blocks
    ) == mixed_replay(a, b, rows, frozenset({1}), list(reversed(blocks)))


def test_duplicate_shots_blocks_remain_stable_and_replayable():
    # 大量重复镜头：分组与跨度仍由零基下标稳定确定。
    a, b = [5, 5, 1, 5, 5, 2, 5], [5, 1, 1, 5, 2, 2, 9]
    rows = align(a, b)
    blocks = split_blocks(rows, len(a), len(b))
    assert_stable_spans(a, b, rows, blocks)
    assert_replay_endpoints(a, b, rows, blocks)
    for blk in blocks:
        assert isinstance(blk, Block)
    # 任意子集都应可重放且长度介于两端点之间。
    base = mixed_replay(a, b, rows, frozenset(), blocks)
    full = mixed_replay(a, b, rows, frozenset(blk.id for blk in blocks), blocks)
    assert base == a and full == b


def test_delete_preference_tie_keep_between_splits_into_two_blocks():
    # [1,2] -> [2,1] 经删除优先裁决为 insert, keep, delete；keep 在中间，
    # 两次编辑不连续，属于两块（同一网格边界的“插入紧接删除”才合块）。
    a, b = [1, 2], [2, 1]
    rows = align(a, b)
    assert [op for op, _, _ in rows] == ["insert", "keep", "delete"]
    blocks = split_blocks(rows, len(a), len(b))
    assert [blk.id for blk in blocks] == [0, 1]
    assert_replay_endpoints(a, b, rows, blocks)
    # 各批准一块得到两种“只改一侧”的合法混合序列。
    assert mixed_replay(a, b, rows, frozenset({0}), blocks) == [2, 1, 2]
    assert mixed_replay(a, b, rows, frozenset({1}), blocks) == [1]


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_randomized_block_spans_and_endpoint_invariants(seed):
    rng = random.Random(seed)
    for _ in range(120):
        size = rng.randint(0, 16)
        a = [rng.randint(0, 4) for _ in range(size)]
        b = [rng.randint(0, 4) for _ in range(size)]
        rows = align(a, b)
        blocks = split_blocks(rows, len(a), len(b))
        assert [blk.id for blk in blocks] == list(range(len(blocks)))
        assert_stable_spans(a, b, rows, blocks)
        assert_replay_endpoints(a, b, rows, blocks)
        # 每个子集：结果由原始 source/target 坐标一次性产出，逐块枚举一遍。
        for mask in range(1 << len(blocks)):
            chosen = frozenset(i for i in range(len(blocks)) if mask & (1 << i))
            seq = mixed_replay(a, b, rows, chosen, blocks)
            assert len(a) - sum(
                blk.source_end - blk.source_start for blk in blocks if blk.id in chosen
            ) + sum(
                blk.target_end - blk.target_start for blk in blocks if blk.id in chosen
            ) == len(seq)
