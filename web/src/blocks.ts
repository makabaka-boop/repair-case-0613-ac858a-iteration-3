import type { AlignmentRow, DiffResult } from "./types";

/**
 * 不可拆分差异块：最短对齐中连续的非 keep 行（见后端 app/blocks.py）。
 * 跨度均为零基半开区间；纯插入块源跨度为空区间 [s,s)，
 * 纯删除块目标跨度为空区间 [t,t)。块编号在同一份对齐上稳定递增。
 */
export interface DiffBlock {
  id: number;
  startRow: number;
  endRow: number;
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
  deletes: number[];
  inserts: number[];
}

/** 校验对齐是合法的最短对齐视图：源/目标下标零基、递增、无缺漏。 */
export function assertAlignment(result: DiffResult): void {
  let sourceIdx = 0;
  let targetIdx = 0;
  for (const row of result.alignment) {
    if (row.type === "keep") {
      if (row.source !== sourceIdx || row.target !== targetIdx) {
        throw new Error("非法的 keep 行下标");
      }
      sourceIdx += 1;
      targetIdx += 1;
    } else if (row.type === "delete") {
      if (row.source !== sourceIdx || row.target !== null) {
        throw new Error("非法的 delete 行下标");
      }
      sourceIdx += 1;
    } else if (row.type === "insert") {
      if (row.target !== targetIdx || row.source !== null) {
        throw new Error("非法的 insert 行下标");
      }
      targetIdx += 1;
    } else {
      throw new Error(`未知操作: ${(row as AlignmentRow).type}`);
    }
  }
  if (sourceIdx !== result.length_source || targetIdx !== result.length_target) {
    throw new Error("对齐未完整覆盖源或目标序列");
  }
}

interface Boundary {
  source: number;
  target: number;
}

/** 某行之前最近的 keep 边界（没有则为序列起点 0,0）。 */
function prevKeepBoundary(rows: AlignmentRow[], start: number): Boundary {
  for (let i = start - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.type === "keep" && row.source !== null && row.target !== null) {
      return { source: row.source + 1, target: row.target + 1 };
    }
  }
  return { source: 0, target: 0 };
}

/** 某行之后最近的 keep 边界（没有则为序列端点 N,M）。 */
function nextKeepBoundary(
  rows: AlignmentRow[],
  end: number,
  n: number,
  m: number
): Boundary {
  for (let i = end; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type === "keep" && row.source !== null && row.target !== null) {
      return { source: row.source, target: row.target };
    }
  }
  return { source: n, target: m };
}

/** 把对齐中连续的非 keep 行切分为编号稳定的差异块。 */
export function splitBlocks(result: DiffResult): DiffBlock[] {
  const { alignment: rows } = result;
  const n = result.length_source;
  const m = result.length_target;
  const blocks: DiffBlock[] = [];

  let i = 0;
  while (i < rows.length) {
    if (rows[i].type === "keep") {
      i += 1;
      continue;
    }
    const startRow = i;
    const deletes: number[] = [];
    const inserts: number[] = [];
    while (i < rows.length && rows[i].type !== "keep") {
      const row = rows[i];
      if (row.type === "delete" && row.source !== null) deletes.push(row.source);
      if (row.type === "insert" && row.target !== null) inserts.push(row.target);
      i += 1;
    }
    const endRow = i;
    const prev = prevKeepBoundary(rows, startRow);
    const next = nextKeepBoundary(rows, endRow, n, m);

    let sourceStart: number;
    let sourceEnd: number;
    if (deletes.length > 0) {
      sourceStart = prev.source;
      sourceEnd = next.source;
    } else {
      sourceStart = sourceEnd = prev.source;
    }

    let targetStart: number;
    let targetEnd: number;
    if (inserts.length > 0) {
      targetStart = prev.target;
      targetEnd = next.target;
    } else {
      targetStart = targetEnd = prev.target;
    }

    blocks.push({
      id: blocks.length,
      startRow,
      endRow,
      sourceStart,
      sourceEnd,
      targetStart,
      targetEnd,
      deletes,
      inserts,
    });
  }
  return blocks;
}

/**
 * 以原始 source 坐标一次性重放混合镜头序列。
 *
 * 选择集合只是行级谓词：单次扫描原始对齐，与勾选先后无关，
 * 不会因先应用一块而漂移后续下标。
 * - 一块不选：精确等于 source；
 * - 全部选中：精确等于 target。
 */
export function replayMixed(
  result: DiffResult,
  blocks: DiffBlock[],
  accepted: ReadonlySet<number>
): number[] {
  const { alignment: rows } = result;
  const rowToBlock = new Map<number, number>();
  for (const block of blocks) {
    for (let r = block.startRow; r < block.endRow; r += 1) {
      rowToBlock.set(r, block.id);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const blockId = rowToBlock.get(i);
    const isAccepted = blockId !== undefined && accepted.has(blockId);
    if (row.type === "keep") {
      out.push(row.value);
    } else if (row.type === "delete") {
      if (!isAccepted) out.push(row.value); // 未批准删除：保留源镜头
    } else if (isAccepted) {
      out.push(row.value); // 已批准插入：采纳目标镜头
    }
  }
  return out;
}

/** 未采纳差异：为便于在界面逐块复核，把各未批准块整理成可读描述。 */
export interface PendingChange {
  blockId: number;
  kind: "delete" | "insert" | "rewrite";
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
}

export function pendingChanges(
  blocks: DiffBlock[],
  accepted: ReadonlySet<number>
): PendingChange[] {
  return blocks
    .filter((block) => !accepted.has(block.id))
    .map((block) => ({
      blockId: block.id,
      kind:
        block.deletes.length > 0 && block.inserts.length > 0
          ? "rewrite"
          : block.deletes.length > 0
            ? "delete"
            : "insert",
      sourceStart: block.sourceStart,
      sourceEnd: block.sourceEnd,
      targetStart: block.targetStart,
      targetEnd: block.targetEnd,
    }));
}

/** 可交付混合序列的下载文本：每行一个整数镜头编号。 */
export function mixedSequenceText(sequence: readonly number[]): string {
  return sequence.map(String).join("\n") + (sequence.length > 0 ? "\n" : "");
}
