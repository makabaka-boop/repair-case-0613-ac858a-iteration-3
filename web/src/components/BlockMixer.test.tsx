import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BlockMixer } from "./BlockMixer";
import type { DiffResult } from "../types";

type R = DiffResult["alignment"][number];
const keep = (s: number, t: number, v: number): R => ({ type: "keep", source: s, target: t, value: v });
const ins = (t: number, v: number): R => ({ type: "insert", source: null, target: t, value: v });
const del = (s: number, v: number): R => ({ type: "delete", source: s, target: null, value: v });

// [1,2,3] -> [1,4,3]：单块相邻改写。
const rewrite: DiffResult = {
  distance: 2,
  length_source: 3,
  length_target: 3,
  alignment: [keep(0, 0, 1), ins(1, 4), del(1, 2), keep(2, 2, 3)],
};

// [1,2,3,4,5] -> [1,8,3,9,5]：两块相邻改写。
const twoBlocks: DiffResult = {
  distance: 4,
  length_source: 5,
  length_target: 5,
  alignment: [
    keep(0, 0, 1),
    ins(1, 8),
    del(1, 2),
    keep(2, 2, 3),
    ins(3, 9),
    del(3, 4),
    keep(4, 4, 5),
  ],
};

// [1..7] -> [1,9,3,4,5,6,8,7]：块0为相邻改写（成本2），块1为纯插入（成本1），
// 各批准一块后到 target 的剩余距离分别为 1 与 2，可区分迟到响应。
const mixedKinds: DiffResult = {
  distance: 3,
  length_source: 7,
  length_target: 8,
  alignment: [
    keep(0, 0, 1),
    ins(1, 9),
    del(1, 2),
    keep(2, 2, 3),
    keep(3, 3, 4),
    keep(4, 4, 5),
    keep(5, 5, 6),
    ins(6, 8),
    keep(6, 7, 7),
  ],
};

function ok(distance: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      distance,
      length_source: 0,
      length_target: 0,
      alignment: [],
    }),
  } as Response;
}

function requestSource(fetchMock: ReturnType<typeof vi.fn>, index: number): number[] {
  return JSON.parse((fetchMock.mock.calls[index][1] as RequestInit).body as string).source;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
};

describe("BlockMixer 逐块批准", () => {
  it("初始零选择：混合序列=source，剩余轨迹请求 source→target", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(2));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockMixer result={rewrite} stale={false} />);
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 2, 3");
    expect(screen.getByTestId("mixed-is-source")).toBeInTheDocument();

    await flush();
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("2");
    expect(requestSource(fetchMock, 0)).toEqual([1, 2, 3]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).target).toEqual([1, 4, 3]);
  });

  it("勾选单块后混合序列=target，剩余距离为 0", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(2)).mockResolvedValueOnce(ok(0));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockMixer result={rewrite} stale={false} />);
    await flush();
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("2");

    fireEvent.click(screen.getByTestId("block-checkbox"));
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 4, 3");
    expect(screen.getByTestId("mixed-is-target")).toBeInTheDocument();

    await flush();
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("0");
    expect(requestSource(fetchMock, 1)).toEqual([1, 4, 3]);
  });

  it("两块场景逐块选择不下标漂移，剩余请求使用最新混合序列", async () => {
    const responses = [4, 2, 2];
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => ok(responses[fetchMock.mock.calls.length - 1]));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockMixer result={twoBlocks} stale={false} />);
    await flush();
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("4");

    const checkboxes = screen.getAllByTestId("block-checkbox");
    fireEvent.click(checkboxes[0]);
    await flush();
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 8, 3, 4, 5");
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("2");

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    await flush();
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 2, 3, 9, 5");
    expect(requestSource(fetchMock, 2)).toEqual([1, 2, 3, 9, 5]);
  });

  it("全部采纳/全部撤销按钮", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(0)));
    render(<BlockMixer result={twoBlocks} stale={false} />);
    fireEvent.click(screen.getByTestId("accept-all"));
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 8, 3, 9, 5");
    expect(
      screen.getAllByTestId("block-checkbox").every((c) => (c as HTMLInputElement).checked)
    ).toBe(true);

    fireEvent.click(screen.getByTestId("accept-none"));
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 2, 3, 4, 5");
  });

  it("没有差异块时给出空态，不显示勾选列表", () => {
    const same: DiffResult = {
      distance: 0,
      length_source: 1,
      length_target: 1,
      alignment: [keep(0, 0, 7)],
    };
    render(<BlockMixer result={same} stale={false} />);
    expect(screen.getByTestId("mixer-no-blocks")).toBeInTheDocument();
    expect(screen.queryAllByTestId("diff-block")).toHaveLength(0);
  });
});

describe("迟到的剩余计算响应不能覆盖新选择", () => {
  it("先慢后快：旧选择的迟到响应被丢弃，剩余距离只反映新选择", async () => {
    // 块0 批准后混合 [1,9,3,4,5,6,7]→target 距离 1；
    // 块1 批准后混合 [1,2,3,4,5,6,8,7]→target 距离 2。
    let resolveSlow: ((v: Response) => void) | null = null;
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(3)) // 初始：不选
      .mockImplementationOnce(() => slow) // 选块 0：挂起，将成为迟到响应（距离 1）
      .mockResolvedValueOnce(ok(2)); // 改选块 1：立即（距离 2）
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockMixer result={mixedKinds} stale={false} />);
    await flush();
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("3");

    const checkboxes = screen.getAllByTestId("block-checkbox");
    fireEvent.click(checkboxes[0]); // 请求 1 挂起
    await flush();
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]); // 请求 2 立即返回
    await flush();

    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent(
      "1, 2, 3, 4, 5, 6, 8, 7"
    );
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("2");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 迟到的旧响应（距离 1，属于块 0 的混合序列）抵达：必须被请求序号丢弃，
    // 界面仍显示新选择对应的距离 2。
    await act(async () => {
      resolveSlow!(ok(1));
      await slow;
    });
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent(
      "1, 2, 3, 4, 5, 6, 8, 7"
    );
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("2");
  });

  it("剩余计算失败显示错误且不影响已选块；后续成功恢复", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ detail: { code: "DIFF_LIMIT", message: "超限" } }),
      } as Response)
      .mockResolvedValueOnce(ok(0));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockMixer result={rewrite} stale={false} />);
    await flush();
    expect(screen.getByTestId("remaining-error")).toHaveTextContent("DIFF_LIMIT");
    expect(screen.queryByTestId("remaining-distance")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("block-checkbox"));
    await flush();
    expect(screen.queryByTestId("remaining-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("0");
  });

  it("stale 输入：撤销选择、禁用下载并清空剩余轨迹", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(2));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<BlockMixer result={rewrite} stale={false} />);
    await flush();
    fireEvent.click(screen.getByTestId("block-checkbox"));
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 4, 3");

    rerender(<BlockMixer result={rewrite} stale={true} />);
    expect(screen.getByTestId("mixer-stale")).toBeInTheDocument();
    expect(screen.getByTestId("mixed-sequence")).toBeEmptyDOMElement();
    expect(screen.getByTestId("download-mixed")).toBeDisabled();
    expect(screen.getByTestId("block-checkbox")).toBeDisabled();
    expect(screen.getByTestId("remaining-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("remaining-distance")).not.toBeInTheDocument();
  });
});

describe("纯插入/纯删除块的界面", () => {
  it("纯插入块：勾选后插入项进入混合序列", async () => {
    const res: DiffResult = {
      distance: 2,
      length_source: 2,
      length_target: 4,
      alignment: [keep(0, 0, 1), ins(1, 9), ins(2, 8), keep(1, 3, 2)],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(0)));
    render(<BlockMixer result={res} stale={false} />);
    expect(screen.getAllByTestId("diff-block")).toHaveLength(1);
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 2");
    fireEvent.click(screen.getByTestId("block-checkbox"));
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 9, 8, 2");
    expect(within(screen.getByTestId("diff-block")).getByText(/插入/)).toBeInTheDocument();
  });

  it("纯删除块：勾选后删除项离开混合序列", async () => {
    const res: DiffResult = {
      distance: 2,
      length_source: 4,
      length_target: 2,
      alignment: [keep(0, 0, 1), del(1, 7), del(2, 8), keep(3, 1, 2)],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(0)));
    render(<BlockMixer result={res} stale={false} />);
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 7, 8, 2");
    fireEvent.click(screen.getByTestId("block-checkbox"));
    expect(screen.getByTestId("mixed-sequence")).toHaveTextContent("1, 2");
  });
});
