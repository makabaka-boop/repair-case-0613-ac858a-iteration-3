import { describe, expect, it, vi } from "vitest";
import { postDiff, postDiffValues, toJsonValues } from "./api";

function jsonResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as Response;
}

describe("diff API 请求版本", () => {
  it("toJsonValues 忽略空行并把十进制数转成 number", () => {
    expect(toJsonValues(["12", " -3 ", "", "abc", "1.5"])).toEqual([
      12,
      -3,
      "abc",
      "1.5",
    ]);
  });

  it("未启用连续删除限制时请求体不携带版本字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);
    await postDiff(["1"], ["2"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source: [1],
      target: [2],
    });
  });

  it("启用限制时请求体携带同一版本参数", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);
    await postDiffValues([1], [1, 2], 3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source: [1],
      target: [1, 2],
      max_consecutive_deletes: 3,
    });
  });
});
