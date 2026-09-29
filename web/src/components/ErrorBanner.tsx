import type { ApiError } from "../types";

const TITLES: Record<string, string> = {
  INVALID_INPUT: "输入不合法（INVALID_INPUT）",
  DIFF_LIMIT: "超出差分上限（DIFF_LIMIT）",
};

export function ErrorBanner({ error }: { error: ApiError }) {
  return (
    <div className="error" role="alert" data-testid="error-banner">
      <strong>{TITLES[error.code] ?? error.code}</strong>
      <p>{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul data-testid="error-issues">
          {error.issues.slice(0, 8).map((issue, i) => {
            const field =
              issue.loc
                .filter((part) => part !== "body")
                .map((part) =>
                  typeof part === "number" ? `[${part}]` : String(part)
                )
                .join("") || "请求体";
            return (
              <li key={i}>
                {field}：{issue.type}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
