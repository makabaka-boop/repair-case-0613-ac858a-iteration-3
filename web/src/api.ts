import type { ApiError, DiffResult } from "./types";

/**
 * 把输入框文本转成要发送的 JSON 值：
 * - 空白行忽略；
 * - 十进制整数（含负数、超界值）转成 number，交由后端裁决；
 * - 其它（小数、字母等）保留为字符串，FastAPI 严格整数校验会返回 422。
 * 失败提示因此来自真实后端校验，而不是前端写死的结论。
 */
export function toJsonValues(rows: string[]): unknown[] {
  const values: unknown[] = [];
  for (const raw of rows) {
    const text = raw.trim();
    if (text === "") continue;
    if (/^-?\d+$/.test(text)) {
      values.push(Number(text));
    } else {
      values.push(text);
    }
  }
  return values;
}

async function readError(res: Response): Promise<ApiError> {
  let detail: unknown;
  try {
    detail = (await res.json())?.detail;
  } catch {
    detail = null;
  }
  if (
    detail &&
    typeof detail === "object" &&
    typeof (detail as { code?: unknown }).code === "string"
  ) {
    return detail as ApiError;
  }
  return { code: "INVALID_INPUT", message: `请求失败（HTTP ${res.status}）` };
}

export async function postDiff(
  sourceRows: string[],
  targetRows: string[]
): Promise<DiffResult> {
  return postDiffValues(toJsonValues(sourceRows), toJsonValues(targetRows));
}

/**
 * 以已经确定的整数序列调用现有 /diff（例如混合镜头序列 → target 的剩余轨迹）。
 * 不引入新接口、不改变裁决；值必须为整数（混合序列只由对齐中的编号产出）。
 */
export async function postDiffValues(
  sourceValues: readonly unknown[],
  targetValues: readonly unknown[]
): Promise<DiffResult> {
  const res = await fetch("/api/diff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: sourceValues,
      target: targetValues,
    }),
  });

  if (!res.ok) {
    throw await readError(res);
  }
  return (await res.json()) as DiffResult;
}
