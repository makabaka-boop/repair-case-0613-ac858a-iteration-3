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
}

export type ErrorCode = "INVALID_INPUT" | "DIFF_LIMIT";

export interface Issue {
  loc: (string | number)[];
  type: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  issues?: Issue[];
}
