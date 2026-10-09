import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type SegmentOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean };

/**
 * Escolha única entre poucas opções (role=radiogroup, padrão de grupo de rádio): setas e
 * Home/End movem E selecionam; o Tab cai só na opção marcada. Cada opção tem 44px de altura.
 */
export function SegmentedControl<T extends string>({ label, value, options, onChange, className }: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const n = options.length;

  // Próximo habilitado a partir de `from` na direção `dir`, dando a volta na lista.
  const stepFrom = (from: number, dir: 1 | -1): number => {
    for (let k = 1; k <= n; k += 1) {
      const i = (((from + dir * k) % n) + n) % n;
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const select = (index: number) => {
    onChange(options[index].value);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = stepFrom(index, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = stepFrom(index, -1);
    else if (event.key === "Home") target = stepFrom(-1, 1);
    else if (event.key === "End") target = stepFrom(n, -1);
    if (target === null) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx("nf-seg", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className={cx("nf-seg-option", selected && "is-selected")}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
