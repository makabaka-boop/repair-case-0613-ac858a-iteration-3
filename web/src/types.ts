export type RowType = "keep" | "delete" | "insert";

export interface AlignmentRow {
  type: RowType;
  source: number | null;
  target: number | null;
  value: number;
}

export interface DiffResult {
  distance: number;
  length_source: number;
  length_target: number;
  alignment: AlignmentRow[];
  max_consecutive_deletes?: 1 | 2 | 3;
}

export type ErrorCode =
  | "INVALID_INPUT"
  | "DIFF_LIMIT"
  | "CONSTRAINED_DIFF_INFEASIBLE";

export interface Issue {
  loc: (string | number)[];
  type: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  issues?: Issue[];
}
