import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiError, DiffResult } from "../types";
import { postDiffValues } from "../api";
import {
  mixedSequenceText,
  pendingChanges,
  replayMixed,
  splitBlocks,
  type DiffBlock,
} from "../blocks";

interface Props {
  /** 原始对齐，绝不被剩余轨迹覆盖。 */
  result: DiffResult;
  /** 原始输入在最近一次成功计算后被改动：撤销选择与可下载混合序列。 */
  stale: boolean;
}

const KIND_LABEL: Record<string, string> = {
  delete: "删除",
  insert: "插入",
  rewrite: "相邻改写",
};

function describe(block: DiffBlock): string {
  const sourceSpan = `源 [${block.sourceStart}, ${block.sourceEnd})`;
  const targetSpan = `目标 [${block.targetStart}, ${block.targetEnd})`;
  const parts: string[] = [];
  if (block.deletes.length > 0) {
    parts.push(`删 ${block.deletes.length}（源下标 ${block.sourceStart}–${block.sourceEnd - 1}）`);
  }
  if (block.inserts.length > 0) {
    parts.push(`插 ${block.inserts.length}（目标下标 ${block.targetStart}–${block.targetEnd - 1}）`);
  }
  return `${KIND_LABEL[
    block.deletes.length > 0 && block.inserts.length > 0
      ? "rewrite"
      : block.deletes.length > 0
        ? "delete"
        : "insert"
  ]} · ${parts.join("，")} · ${sourceSpan} / ${targetSpan}`;
}

export function BlockMixer({ result, stale }: Props) {
  const blocks = useMemo(() => splitBlocks(result), [result]);
  const allIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);

  // 组件在每次新的成功计算后由 App 以对齐内容为 key 整体重挂：
  // 块编号/跨度与选择集合因此不会跨对齐串扰，初始一律零选择。
  const [accepted, setAccepted] = useState<ReadonlySet<number>>(() => new Set());
  const [remaining, setRemaining] = useState<DiffResult | null>(null);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const [remainingError, setRemainingError] = useState<ApiError | null>(null);
  const [downloadNonce, setDownloadNonce] = useState(0);

  const targetValues = useMemo(
    () =>
      result.alignment
        .filter((row) => row.type !== "delete")
        .map((row) => row.value),
    [result]
  );

  // 始终一次性按原始 source 坐标重放，与勾选先后无关。
  const mixed = useMemo(
    () => replayMixed(result, blocks, stale ? new Set() : accepted),
    [result, blocks, accepted, stale]
  );

  const toggle = (id: number) => {
    if (stale) return;
    const next = new Set(accepted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAccepted(next);
  };

  const setAll = (choose: boolean) => {
    if (stale) return;
    setAccepted(choose ? new Set(allIds) : new Set());
  };

  // 选择变化后用现有 /diff 计算混合序列到 target 的剩余轨迹。
  // 请求序号 + 超时丢弃：迟到响应绝不能覆盖新选择对应的剩余轨迹。
  const requestSeq = useRef(0);
  useEffect(() => {
    if (stale) {
      setRemaining(null);
      setRemainingError(null);
      setRemainingLoading(false);
      return;
    }
    if (blocks.length === 0) {
      // 两序列完全一致：没有剩余轨迹可算，无需调用 /diff。
      setRemaining(null);
      setRemainingError(null);
      setRemainingLoading(false);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setRemainingError(null);
    setRemainingLoading(true);
    const timer = window.setTimeout(() => {
      postDiffValues(mixed, targetValues)
        .then((res) => {
          if (requestSeq.current !== seq) return; // 迟到响应：丢弃，不覆盖新选择
          setRemaining(res);
          setRemainingError(null);
        })
        .catch((e: ApiError) => {
          if (requestSeq.current !== seq) return;
          setRemaining(null);
          setRemainingError(e);
        })
        .finally(() => {
          if (requestSeq.current === seq) setRemainingLoading(false);
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [mixed, targetValues, stale, blocks.length]);

  const download = () => {
    if (stale) return;
    const blob = new Blob([mixedSequenceText(mixed)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mixed-shots.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloadNonce((n) => n + 1);
  };

  const pending = pendingChanges(blocks, stale ? new Set() : accepted);
  const noneChosen = accepted.size === 0 && !stale;
  const allChosen = accepted.size === blocks.length && blocks.length > 0 && !stale;

  if (blocks.length === 0) {
    return (
      <section className="mixer" data-testid="block-mixer">
        <h2>差异块批准</h2>
        <p className="muted" data-testid="mixer-no-blocks">
          两序列完全一致：没有需要批准的差异块，混合序列即原序列。
        </p>
      </section>
    );
  }

  return (
    <section className="mixer" data-testid="block-mixer">
      <h2>差异块批准</h2>
      <p className="muted">
        连续的非 keep 步骤按两侧零基边界归为不可拆分块；删除与同一边界的插入同属一块。
        混合序列始终以原 source 坐标一次性重放，不选=source，全选=target。
      </p>

      {stale && (
        <p className="stale" data-testid="mixer-stale">
          原始输入已改动：旧块选择与可下载混合序列已撤销，请重新计算变更轨迹。
        </p>
      )}

      <div className="mixer-actions">
        <button type="button" data-testid="accept-all" onClick={() => setAll(true)} disabled={stale}>
          全部采纳
        </button>
        <button type="button" data-testid="accept-none" onClick={() => setAll(false)} disabled={stale}>
          全部撤销
        </button>
      </div>

      <ul className="blocks">
        {blocks.map((block) => {
          const checked = !stale && accepted.has(block.id);
          return (
            <li
              key={block.id}
              className="block"
              data-testid="diff-block"
              data-block-id={block.id}
            >
              <label>
                <input
                  type="checkbox"
                  data-testid="block-checkbox"
                  checked={checked}
                  disabled={stale}
                  onChange={() => toggle(block.id)}
                />
                <span className="block-id">块 #{block.id}</span>
                <span className="block-desc">{describe(block)}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mixed" data-testid="mixed-panel">
        <header className="mixed-head">
          <h3>可交付混合镜头序列</h3>
          <button
            type="button"
            data-testid="download-mixed"
            onClick={download}
            disabled={stale}
          >
            下载 mixed-shots.txt
          </button>
          <span className="muted" data-testid="download-nonce">
            {downloadNonce}
          </span>
        </header>
        <p className="muted" data-testid="mixed-meta">
          {stale
            ? "已撤销：无可用混合序列"
            : `${mixed.length} 项；尚未采纳 ${pending.length} 块`}
        </p>
        <div className="mixed-seq" data-testid="mixed-sequence">
          {stale ? "" : mixed.join(", ")}
        </div>
        {noneChosen && (
          <p className="muted" data-testid="mixed-is-source">
            当前未批准任何块：混合序列精确等于 source。
          </p>
        )}
        {allChosen && (
          <p className="muted" data-testid="mixed-is-target">
            所有差异块均已批准：混合序列精确等于 target。
          </p>
        )}
      </div>

      <div className="remaining" data-testid="remaining-panel">
        <h3>剩余轨迹（混合序列 → target）</h3>
        {stale ? (
          <p className="muted" data-testid="remaining-stale">
            输入已改动，剩余轨迹已清空。
          </p>
        ) : remainingLoading ? (
          <p className="muted" data-testid="remaining-loading">
            计算中…
          </p>
        ) : remainingError ? (
          <p className="remaining-error" data-testid="remaining-error">
            {remainingError.code}：{remainingError.message}
          </p>
        ) : remaining ? (
          <div data-testid="remaining-result">
            <span data-testid="remaining-distance">{remaining.distance}</span>
            <span className="muted"> 步剩余插入/删除</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
