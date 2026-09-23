import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import './rounded-select.css';

export interface RoundedSelectOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

export function RoundedSelect<T extends string>({
  label,
  onChange,
  options,
  value,
  disabled = false,
  describedBy,
  id,
}: {
  label: string;
  onChange(value: T): void;
  options: ReadonlyArray<RoundedSelectOption<T>>;
  value: T;
  disabled?: boolean;
  describedBy?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = options.findIndex((option) => option.id === value);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const showOptions = () => {
    const next =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : options.findIndex((option) => !option.disabled);
    if (next < 0) return;
    setActiveIndex(next);
    setOpen(true);
  };
  const moveActive = (direction: -1 | 1) => {
    const start = open ? activeIndex : selectedIndex;
    for (let step = 1; step <= options.length; step += 1) {
      const index = (start + direction * step + options.length * 2) % options.length;
      if (options[index] && !options[index].disabled) {
        setActiveIndex(index);
        setOpen(true);
        return;
      }
    }
  };
  const choose = (option: RoundedSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className={`rounded-select ${open ? 'is-open' : ''}`}
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-describedby={describedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="rounded-select-trigger"
        disabled={disabled}
        id={id}
        onClick={() => (open ? setOpen(false) : showOptions())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const index =
              event.key === 'Home'
                ? options.findIndex((option) => !option.disabled)
                : options.findLastIndex((option) => !option.disabled);
            if (index >= 0) {
              setActiveIndex(index);
              setOpen(true);
            }
          } else if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            if (options[activeIndex]) choose(options[activeIndex]);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span>{selected?.label}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="rounded-select-list" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <button
              aria-selected={option.id === value}
              className={index === activeIndex ? 'is-active' : undefined}
              disabled={option.disabled}
              id={`${listboxId}-option-${index}`}
              key={option.id}
              onClick={() => choose(option)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{option.label}</span>
              {option.id === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
