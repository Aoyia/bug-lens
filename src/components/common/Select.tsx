import { useState, useRef, useEffect, useCallback } from "preact/hooks";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
}

export function Select<T extends string = string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  className = "",
  title,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption
    ? selectedOption.label
    : (placeholder ?? value);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
  }, [disabled]);

  const handleSelect = useCallback(
    (optValue: T, optDisabled?: boolean) => {
      if (disabled || optDisabled) return;
      onChange(optValue);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [disabled, onChange]
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      id={id ? `${id}-container` : undefined}
      className={`popup-select ${className} ${open ? "popup-select-open" : ""} ${
        disabled ? "popup-select-disabled" : ""
      }`.trim()}
      title={title}
    >
      {/* 隐藏原生 select：保证表单兼容性、CDP 自动化测试与无障碍访问 */}
      <select
        id={id}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value as T);
        }}
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          border: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        ref={triggerRef}
        id={id ? `${id}-trigger` : undefined}
        type="button"
        className="popup-select-trigger"
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
      >
        <span className="popup-select-value">{displayLabel}</span>
        <svg
          className="popup-select-arrow"
          viewBox="0 0 12 12"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.5 4.5L6 8L9.5 4.5" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="popup-select-menu" role="listbox" tabIndex={-1}>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                className={`popup-select-item ${
                  isSelected ? "popup-select-item-selected" : ""
                } ${opt.disabled ? "popup-select-item-disabled" : ""}`.trim()}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value, opt.disabled)}
              >
                <span className="popup-select-item-label">{opt.label}</span>
                {isSelected && (
                  <svg
                    className="popup-select-check"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2.5 6.5L4.8 8.8L9.5 3.5" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
