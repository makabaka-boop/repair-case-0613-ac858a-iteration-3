import type { DiffResult } from "../types";

const LABELS: Record<string, string> = {
  keep: "保留",
  delete: "删除（源）",
  insert: "插入（目标）",
};

export function ResultView({ result }: { result: DiffResult }) {
  const { distance, alignment, length_source, length_target } = result;
  const keeps = alignment.filter((r) => r.type === "keep").length;
  const deletes = alignment.filter((r) => r.type === "delete").length;
  const inserts = alignment.filter((r) => r.type === "insert").length;

  return (
    <section className="result" data-testid="result-view">
      <h2>变更轨迹</h2>
      <p className="distance" data-testid="distance">
        编辑距离（最短插入/删除步数）：<strong>{distance}</strong>
      </p>
      <p className="muted" data-testid="summary">
        源 {length_source} 项 → 目标 {length_target} 项；保留 {keeps}，删除 {deletes}
        ，插入 {inserts}
      </p>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>操作</th>
            <th>镜头编号</th>
            <th>源下标（零基）</th>
            <th>目标下标（零基）</th>
          </tr>
        </thead>
        <tbody>
          {alignment.map((row, i) => (
            <tr key={i} data-testid="alignment-row" className={`op op-${row.type}`}>
              <td>{i}</td>
              <td data-testid="row-type">{LABELS[row.type]}</td>
              <td data-testid="row-value">{row.value}</td>
              <td data-testid="row-source">{row.source ?? "—"}</td>
              <td data-testid="row-target">{row.target ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
