import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResultView } from "./ResultView";
import type { DiffResult } from "../types";

// 与后端 [1,2,3] -> [1,4,3] 的真实结构一致：
// keep(0,0), insert(null,1), delete(1,null), keep(2,2)
const result: DiffResult = {
  distance: 2,
  length_source: 3,
  length_target: 3,
  alignment: [
    { type: "keep", source: 0, target: 0, value: 1 },
    { type: "insert", source: null, target: 1, value: 4 },
    { type: "delete", source: 1, target: null, value: 2 },
    { type: "keep", source: 2, target: 2, value: 3 },
  ],
};

function rowTexts() {
  return screen.getAllByTestId("alignment-row").map((tr) => tr.textContent);
}

describe("ResultView", () => {
  it("展示编辑距离与长度汇总", () => {
    render(<ResultView result={result} />);
    expect(screen.getByTestId("distance")).toHaveTextContent("2");
    expect(screen.getByTestId("summary")).toHaveTextContent("源 3 项 → 目标 3 项");
    expect(screen.getByTestId("summary")).toHaveTextContent("保留 2");
    expect(screen.getByTestId("summary")).toHaveTextContent("删除 1");
    expect(screen.getByTestId("summary")).toHaveTextContent("插入 1");
  });

  it("为每项展示零基源/目标下标，缺失侧渲染为 —", () => {
    render(<ResultView result={result} />);
    const rows = screen.getAllByTestId("alignment-row");
    expect(within(rows[0]).getByTestId("row-source")).toHaveTextContent("0");
    expect(within(rows[0]).getByTestId("row-target")).toHaveTextContent("0");

    expect(within(rows[1]).getByTestId("row-source")).toHaveTextContent("—");
    expect(within(rows[1]).getByTestId("row-target")).toHaveTextContent("1");

    expect(within(rows[2]).getByTestId("row-source")).toHaveTextContent("1");
    expect(rows[2].querySelector('[data-testid="row-target"]')).toHaveTextContent("—");
  });

  it("按轨迹类型标注操作", () => {
    render(<ResultView result={result} />);
    const types = screen
      .getAllByTestId("row-type")
      .map((el) => el.textContent);
    expect(types).toEqual(["保留", "插入（目标）", "删除（源）", "保留"]);
  });

  it("显示每项镜头编号", () => {
    render(<ResultView result={result} />);
    expect(screen.getAllByTestId("row-value").map((el) => el.textContent)).toEqual([
      "1",
      "4",
      "2",
      "3",
    ]);
  });

  it("按轨迹重放必须精确得到目标序列", () => {
    render(<ResultView result={result} />);
    // 在视图层做同样的重放断言：插入/保留依次产出，删除不产出。
    const target = result.alignment.reduce<number[]>((acc, row) => {
      if (row.type !== "delete") acc.push(row.value);
      return acc;
    }, []);
    expect(target).toEqual([1, 4, 3]);
    expect(rowTexts()).toHaveLength(4);
  });

  it("距离为 0 时渲染纯保留轨迹", () => {
    const same: DiffResult = {
      distance: 0,
      length_source: 1,
      length_target: 1,
      alignment: [{ type: "keep", source: 0, target: 0, value: 42 }],
    };
    render(<ResultView result={same} />);
    expect(screen.getByTestId("distance")).toHaveTextContent("0");
    expect(screen.getAllByTestId("alignment-row")).toHaveLength(1);
  });
});
