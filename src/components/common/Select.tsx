import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import type { ComponentChildren } from "preact";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number = string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
  suffix?: ComponentChildren;
  direction?: "up" | "down";
  ariaLabel?: string;
  variant?: "popup" | "options";
}

export function Select<T extends string | number = string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  className = "",
  title,
  suffix,
  direction = "up",
  ariaLabel,
  variant = "popup",
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

  const isOptions = variant === "options";
  const wrapClass = isOptions
    ? `custom-select-wrap ${open ? "open" : ""} ${className}`.trim()
    : `popup-select ${direction === "down" ? "popup-select-down" : "popup-select-up"} ${className} ${open ? "popup-select-open" : ""} ${
        disabled ? "popup-select-disabled" : ""
      }`.trim();

  return (
    <div
      ref={containerRef}
      id={id ? `${id}-container` : undefined}
      className={wrapClass}
      title={title}
    >
      {/* 隐藏原生 select：保证表单兼容性、CDP 自动化测试与无障碍访问 */}
      <select
        id={id}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={String(value)}
        onChange={(e) => {
          const matched = options.find(
            (opt) => String(opt.value) === e.currentTarget.value
          );
          onChange((matched ? matched.value : e.currentTarget.value) as T);
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
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        ref={triggerRef}
        id={id ? `${id}-trigger` : undefined}
        type="button"
        className={isOptions ? "custom-select-trigger" : "popup-select-trigger"}
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        aria-label={ariaLabel}
      >
        <span className={isOptions ? undefined : "popup-select-value"}>
          {displayLabel}
        </span>
        {suffix && <span className="popup-select-suffix">{suffix}</span>}
        <svg
          className={isOptions ? "custom-select-chevron" : "popup-select-arrow"}
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
        <div
          className={isOptions ? "custom-select-dropdown" : "popup-select-menu"}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            const itemClass = isOptions
              ? `custom-select-option ${isSelected ? "selected" : ""}`
              : `popup-select-item ${
                  isSelected ? "popup-select-item-selected" : ""
                } ${opt.disabled ? "popup-select-item-disabled" : ""}`.trim();
            return (
              <div
                key={String(opt.value)}
                className={itemClass}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value, opt.disabled)}
              >
                <span
                  className={isOptions ? undefined : "popup-select-item-label"}
                >
                  {opt.label}
                </span>
                {isSelected && (
                  <svg
                    className={
                      isOptions ? "custom-select-check" : "popup-select-check"
                    }
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
