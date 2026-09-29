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
