import { useRef } from "react";

interface Props {
  title: string;
  testId: string;
  rows: string[];
  onChange: (rows: string[]) => void;
}

export function NumberListEditor({ title, testId, rows, onChange }: Props) {
  const lastInputRef = useRef<HTMLInputElement | null>(null);

  const update = (i: number, value: string) => {
    const copy = rows.slice();
    copy[i] = value;
    onChange(copy);
  };

  const append = (focus = false) => {
    onChange([...rows, ""]);
    if (focus) {
      // 新行在提交后渲染，借助 ref 回调在挂载时聚焦。
      requestAnimationFrame(() => lastInputRef.current?.focus());
    }
  };

  const removeAt = (i: number) => {
    const copy = rows.slice();
    copy.splice(i, 1);
    onChange(copy.length ? copy : [""]);
  };

  const clear = () => onChange([""]);

  // 多行粘贴：按换行/逗号拆成多行，从当前行开始铺入，避免逐条点击“增加”。
  const pasteMulti = (i: number, text: string) => {
    const parts = text.split(/[\n,]+/).map((s) => s.trim()).filter((s) => s !== "");
    if (parts.length <= 1) return false;
    const copy = rows.slice();
    copy.splice(i, 1, ...parts, "");
    onChange(copy);
    return true;
  };

  return (
    <section className="editor" data-testid={testId}>
      <header className="editor-head">
        <h2>{title}</h2>
        <span className="muted">{rows.filter((r) => r.trim() !== "").length} 项</span>
        <button type="button" className="link" onClick={clear}>
          清空
        </button>
      </header>

      <ul className="rows">
        {rows.map((value, i) => (
          <li className="row" key={i}>
            <span className="row-index" aria-label="零基下标">
              {i}
            </span>
            <input
              ref={i === rows.length - 1 ? lastInputRef : undefined}
              inputMode="numeric"
              aria-label={`${title}第 ${i} 项`}
              value={value}
              placeholder="整数镜头编号，如 1024"
              onChange={(e) => update(i, e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (pasteMulti(i, text)) e.preventDefault();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  append(true);
                }
              }}
            />
            <button
              type="button"
              aria-label={`删除第 ${i} 项`}
              onClick={() => removeAt(i)}
              disabled={rows.length === 1 && value === ""}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="add" onClick={() => append(false)}>
        ＋ 增加一项
      </button>
    </section>
  );
}
