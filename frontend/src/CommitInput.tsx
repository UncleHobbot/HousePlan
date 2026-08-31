import { useEffect, useRef, useState, type CSSProperties, type HTMLInputTypeAttribute } from 'react';

/** Поле, которое превращает весь ввод до blur/Enter в одно действие проекта. */
export function CommitInput({
  value,
  onCommit,
  title,
  type = 'text',
  style,
}: {
  value: string | number;
  onCommit: (value: string | number) => void;
  title?: string;
  type?: HTMLInputTypeAttribute;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelRef = useRef(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    const next = type === 'number' ? Number(draft) : draft;
    if (Number.isNaN(next) || next === value) return;
    onCommit(next);
  }

  return (
    <input
      value={draft}
      title={title}
      type={type}
      style={style}
      onChange={(event) => {
        cancelRef.current = false;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelRef.current = true;
          setDraft(String(value));
        }
      }}
    />
  );
}
