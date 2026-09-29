import { useState } from "react";
import { NumberListEditor } from "./components/NumberListEditor";
import { ResultView } from "./components/ResultView";
import { ErrorBanner } from "./components/ErrorBanner";
import { BlockMixer } from "./components/BlockMixer";
import { postDiff } from "./api";
import type { ApiError, DiffResult } from "./types";

export function App() {
  const [source, setSource] = useState<string[]>([""]);
  const [target, setTarget] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<DiffResult | null>(null);
  // 原始输入在最近一次成功差分后被改动：撤销旧块选择与可下载混合序列。
  const [inputsDirty, setInputsDirty] = useState(false);

  const editSource = (rows: string[]) => {
    setSource(rows);
    setInputsDirty(true);
  };

  const editTarget = (rows: string[]) => {
    setTarget(rows);
    setInputsDirty(true);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await postDiff(source, target);
      setResult(next);
      setInputsDirty(false);
    } catch (e) {
      setError(e as ApiError);
      // 原始差分失败：旧块选择与可下载混合序列一并撤销。
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <h1>纪录片重剪 · 镜头序列变更轨迹</h1>
      <p className="muted">
        输入源序列与重剪后目标序列（0–2147483647 的整数，每组至多 20000 项）。
        后端以有界 Myers（只搜索至 d=800）求最短插入/删除对齐，相同编号沿对角线保留。
      </p>

      <div className="editors">
        <NumberListEditor title="源序列" testId="source-editor" rows={source} onChange={editSource} />
        <NumberListEditor title="目标序列" testId="target-editor" rows={target} onChange={editTarget} />
      </div>

      <div className="actions">
        <button type="button" data-testid="compare" onClick={submit} disabled={loading}>
          {loading ? "计算中…" : "计算变更轨迹"}
        </button>
      </div>

      {error && <ErrorBanner error={error} />}
      {result && <ResultView result={result} />}
      {result && <BlockMixer key={resultKey(result)} result={result} stale={inputsDirty} />}
    </main>
  );
}

/**
 * 每次新的成功计算用对齐内容作 key：旧 BlockMixer 连同其块选择整体卸载，
 * 保证新对齐下块编号、跨度与选择互不串扰。
 */
function resultKey(result: DiffResult): string {
  return result.alignment
    .map((row) => `${row.type}:${row.source ?? "x"}:${row.target ?? "x"}:${row.value}`)
    .join("|");
}
