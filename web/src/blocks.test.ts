import { describe, expect, it } from "vitest";
import {
  assertAlignment,
  mixedSequenceText,
  pendingChanges,
  replayMixed,
  splitBlocks,
  type DiffBlock,
} from "./blocks";
import type { AlignmentRow, DiffResult } from "./types";

type R = AlignmentRow;
const keep = (s: number, t: number, v: number): R => ({ type: "keep", source: s, target: t, value: v });
const ins = (t: number, v: number): R => ({ type: "insert", source: null, target: t, value: v });
const del = (s: number, v: number): R => ({ type: "delete", source: s, target: null, value: v });

function result(source: number[], target: number[], alignment: AlignmentRow[]): DiffResult {
  return {
    distance: alignment.filter((r) => r.type !== "keep").length,
    length_source: source.length,
    length_target: target.length,
    alignment,
  };
}

function endpoints(result: DiffResult, blocks: DiffBlock[]) {
  // 不选任何块精确等于 source；全选精确等于 target。
  const source = result.alignment
    .filter((r) => r.source !== null && r.type !== "insert")
    .map((r) => r.value);
  const target = result.alignment.filter((r) => r.type !== "delete").map((r) => r.value);
  assertAlignment(result);
  expect(replayMixed(result, blocks, new Set())).toEqual(source);
  expect(replayMixed(result, blocks, new Set(blocks.map((b) => b.id)))).toEqual(target);
}

describe("纯插入", () => {
  // [1,2] -> [1,9,8,2]：keep, insert, insert, keep
  const source = [1, 2];
  const target = [1, 9, 8, 2];
  const res = result(source, target, [keep(0, 0, 1), ins(1, 9), ins(2, 8), keep(1, 3, 2)]);
  const blocks = splitBlocks(res);

  it("归为单块，源跨度为空区间，目标跨度覆盖插入项", () => {
    expect(blocks.map((b) => b.id)).toEqual([0]);
    expect(blocks[0]).toMatchObject({
      startRow: 1,
      endRow: 3,
      sourceStart: 1,
      sourceEnd: 1,
      targetStart: 1,
      targetEnd: 3,
    });
  });

  it("不选=source，勾选=target", () => {
    endpoints(res, blocks);
    expect(replayMixed(res, blocks, new Set([0]))).toEqual([1, 9, 8, 2]);
    expect(pendingChanges(blocks, new Set())[0]).toMatchObject({
      blockId: 0,
      kind: "insert",
    });
  });
});

describe("纯删除", () => {
  // [1,7,8,2] -> [1,2]：keep, delete, delete, keep
  const source = [1, 7, 8, 2];
  const target = [1, 2];
  const res = result(source, target, [keep(0, 0, 1), del(1, 7), del(2, 8), keep(3, 1, 2)]);
  const blocks = splitBlocks(res);

  it("归为单块，目标跨度为空区间，源跨度覆盖删除项", () => {
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      sourceStart: 1,
      sourceEnd: 3,
      targetStart: 1,
      targetEnd: 1,
    });
  });

  it("不选=source，勾选=target，且无下标漂移", () => {
    endpoints(res, blocks);
    expect(replayMixed(res, blocks, new Set())).toEqual([1, 7, 8, 2]);
    expect(replayMixed(res, blocks, new Set([0]))).toEqual([1, 2]);
  });
});

describe("相邻改写（删除优先裁决：insert 紧接 delete）", () => {
  // [1,2,3] -> [1,4,3]：keep, insert, delete, keep —— 同一边界必须同块。
  const source = [1, 2, 3];
  const target = [1, 4, 3];
  const res = result(source, target, [keep(0, 0, 1), ins(1, 4), del(1, 2), keep(2, 2, 3)]);
  const blocks = splitBlocks(res);

  it("插入与删除归为同一个不可拆分块", () => {
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      sourceStart: 1,
      sourceEnd: 2,
      targetStart: 1,
      targetEnd: 2,
    });
    expect(pendingChanges(blocks, new Set())[0].kind).toBe("rewrite");
  });

  it("块不可拆：只能整块采纳或整块保留", () => {
    endpoints(res, blocks);
    expect(replayMixed(res, blocks, new Set())).toEqual([1, 2, 3]);
    expect(replayMixed(res, blocks, new Set([0]))).toEqual([1, 4, 3]);
  });

  it("两处相邻改写被 keep 分隔为编号稳定的两块", () => {
    // [1,2,3,4,5] -> [1,8,3,9,5]
    const a = [1, 2, 3, 4, 5];
    const b = [1, 8, 3, 9, 5];
    const res2 = result(a, b, [
      keep(0, 0, 1),
      ins(1, 8),
      del(1, 2),
      keep(2, 2, 3),
      ins(3, 9),
      del(3, 4),
      keep(4, 4, 5),
    ]);
    const blocks2 = splitBlocks(res2);
    expect(blocks2.map((x) => x.id)).toEqual([0, 1]);
    expect(replayMixed(res2, blocks2, new Set([0]))).toEqual([1, 8, 3, 4, 5]);
    expect(replayMixed(res2, blocks2, new Set([1]))).toEqual([1, 2, 3, 9, 5]);
    endpoints(res2, blocks2);
  });
});

describe("重复镜头", () => {
  it("重复编号下块编号与跨度仍由零基下标稳定确定", () => {
    // 与后端删除优先裁决一致：[5,5,1,5,5,2,5] -> [5,1,1,5,2,2,9]
    const a = [5, 5, 1, 5, 5, 2, 5];
    const b = [5, 1, 1, 5, 2, 2, 9];
    const rows: AlignmentRow[] = [
      keep(0, 0, 5),
      del(1, 5),
      keep(2, 1, 1),
      ins(2, 1),
      keep(3, 3, 5),
      del(4, 5),
      keep(5, 4, 2),
      ins(5, 2),
      ins(6, 9),
      del(6, 5),
    ];
    const res = result(a, b, rows);
    const blocks = splitBlocks(res);
    expect(blocks.map((x) => x.id)).toEqual([0, 1, 2, 3]);
    // 真实删除优先裁决下：删源 1；插目标 2；删源 4；末尾插 2、9 且删源 6 同块。
    expect(blocks[0]).toMatchObject({ sourceStart: 1, sourceEnd: 2, targetStart: 1, targetEnd: 1 });
    expect(blocks[1]).toMatchObject({ sourceStart: 3, sourceEnd: 3, targetStart: 2, targetEnd: 3 });
    expect(blocks[2]).toMatchObject({ sourceStart: 4, sourceEnd: 5, targetStart: 4, targetEnd: 4 });
    expect(blocks[3]).toMatchObject({ sourceStart: 6, sourceEnd: 7, targetStart: 5, targetEnd: 7 });
    endpoints(res, blocks);

    // 枚举全部子集：长度恒为 N - Σ删除 + Σ插入，取值只来自原始坐标。
    for (let mask = 0; mask < 1 << blocks.length; mask += 1) {
      const chosen = new Set(
        blocks.filter((_, i) => mask & (1 << i)).map((x) => x.id)
      );
      const seq = replayMixed(res, blocks, chosen);
      const expectedLength =
        a.length -
        blocks
          .filter((x) => chosen.has(x.id))
          .reduce((acc, x) => acc + (x.sourceEnd - x.sourceStart), 0) +
        blocks
          .filter((x) => chosen.has(x.id))
          .reduce((acc, x) => acc + (x.targetEnd - x.targetStart), 0);
      expect(seq).toHaveLength(expectedLength);
    }
  });
});

describe("稳定性与非法对齐", () => {
  it("多次拆分得到相同编号与跨度", () => {
    const res = result([1, 2, 3], [1, 4, 3], [
      keep(0, 0, 1),
      ins(1, 4),
      del(1, 2),
      keep(2, 2, 3),
    ]);
    expect(splitBlocks(res)).toEqual(splitBlocks(res));
  });

  it("勾选顺序不影响结果（一次性按原始坐标重放）", () => {
    const res = result([1, 2, 3, 4, 5], [1, 8, 3, 9, 5], [
      keep(0, 0, 1),
      ins(1, 8),
      del(1, 2),
      keep(2, 2, 3),
      ins(3, 9),
      del(3, 4),
      keep(4, 4, 5),
    ]);
    const blocks = splitBlocks(res);
    const first = replayMixed(res, blocks, new Set([0, 1]));
    const second = replayMixed(res, blocks, new Set([1, 0]));
    expect(first).toEqual(second);
    expect(first).toEqual([1, 8, 3, 9, 5]);
  });

  it("下标缺漏的对齐被拒绝", () => {
    const bad = result([1], [2], [keep(0, 1, 1)]);
    expect(() => assertAlignment(bad)).toThrow();
  });

  it("下载文本每行一个编号", () => {
    expect(mixedSequenceText([1, 4, 3])).toBe("1\n4\n3\n");
    expect(mixedSequenceText([])).toBe("");
  });
});
