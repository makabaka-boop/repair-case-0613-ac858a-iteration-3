import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

const okPayload = {
  distance: 0,
  length_source: 0,
  length_target: 0,
  alignment: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const constrainedPayload = {
  distance: 5,
  length_source: 4,
  length_target: 1,
  max_consecutive_deletes: 2,
  alignment: [
    { type: "delete", source: 0, target: null, value: 1 },
    { type: "delete", source: 1, target: null, value: 2 },
    { type: "insert", source: null, target: 0, value: 1 },
    { type: "delete", source: 2, target: null, value: 3 },
    { type: "delete", source: 3, target: null, value: 4 },
  ],
};

describe("App 连续提交", () => {
  it("先成功、再提交非法输入：旧轨迹必须消失，只显示当前错误", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(okPayload))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: {
              code: "INVALID_INPUT",
              message: "source/target 必须是 0 至 2147483647 的整数数组",
            },
          },
          422
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // 初始空数组即合法：第一次提交成功并展示轨迹。
    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() =>
      expect(screen.getByTestId("result-view")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();

    // 在源序列填入小数后再次提交：后端裁决 422。
    fireEvent.change(screen.getByLabelText("源序列第 0 项"), {
      target: { value: "3.5" },
    });
    fireEvent.click(screen.getByTestId("compare"));

    await waitFor(() =>
      expect(screen.getByTestId("error-banner")).toBeInTheDocument()
    );
    // 上一次轨迹不得与当前错误同时残留。
    expect(screen.queryByTestId("result-view")).not.toBeInTheDocument();
  });

  it("先失败、再提交合法输入：错误消失并显示新轨迹", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: { code: "DIFF_LIMIT", message: "编辑距离超过 800 的搜索上限" } },
          422
        )
      )
      .mockResolvedValueOnce(jsonResponse(okPayload));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() =>
      expect(screen.getByTestId("error-banner")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("result-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() =>
      expect(screen.getByTestId("result-view")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});

describe("最大连续删除模式", () => {
  it("默认不发送约束字段；启用 2 后请求和结果版本一致", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(okPayload))
      .mockResolvedValueOnce(jsonResponse(constrainedPayload));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() => expect(screen.getByTestId("result-view")).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
      "max_consecutive_deletes"
    );

    fireEvent.click(screen.getByTestId("limit-2"));
    fireEvent.click(screen.getByTestId("compare"));

    await waitFor(() => expect(screen.getByTestId("distance")).toHaveTextContent("5"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_consecutive_deletes).toBe(2);
    expect(screen.getByTestId("mixer-limit")).toHaveTextContent("最大连续删除 2 个镜头");
  });

  it("约束模式无解时显示明确错误，不保留旧块或可审批差异", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(okPayload))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: {
              code: "CONSTRAINED_DIFF_INFEASIBLE",
              message: "不存在连续删除不超过 2 个镜头的插入/删除脚本",
            },
          },
          422
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() => expect(screen.getByTestId("block-mixer")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("limit-2"));
    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner")).toHaveTextContent(
      "CONSTRAINED_DIFF_INFEASIBLE"
    );
    expect(screen.queryByTestId("result-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("block-mixer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("download-mixed")).not.toBeInTheDocument();
  });
});
