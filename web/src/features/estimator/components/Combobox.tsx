import { useState, useRef, useEffect, useMemo, useId } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import { normalizeText } from '../stats';

export interface ComboboxOption {
  value: string;
  group: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Flatten grouped options into a single render+navigation order. */
interface FlatItem {
  type: 'option';
  value: string;
  group: string;
  index: number; // index among selectable options only
}
interface GroupHeader {
  type: 'group';
  group: string;
}
type RenderRow = FlatItem | GroupHeader;

/**
 * Accessible single-select combobox (WAI-ARIA combobox + listbox pattern).
 * Filters options diacritic-insensitively, groups by faculty, and supports
 * Up/Down/Enter/Escape/Home/End plus click-outside. The visible input shows the
 * current selection until the user types to filter.
 */
const Combobox: FunctionComponent<ComboboxProps> = ({
  options,
  value,
  onChange,
  label,
  placeholder,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // Build filtered + grouped render rows; selectable options carry a flat index.
  const { rows, selectable } = useMemo(() => {
    const q = normalizeText(query.trim());
    const filtered = q
      ? options.filter((o) => normalizeText(o.value).includes(q))
      : options;

    const renderRows: RenderRow[] = [];
    const flat: FlatItem[] = [];
    let lastGroup = '';
    let idx = 0;
    for (const o of filtered) {
      if (o.group !== lastGroup) {
        renderRows.push({ type: 'group', group: o.group });
        lastGroup = o.group;
      }
      const item: FlatItem = { type: 'option', value: o.value, group: o.group, index: idx };
      renderRows.push(item);
      flat.push(item);
      idx++;
    }
    return { rows: renderRows, selectable: flat };
  }, [options, query]);

  // Keep activeIndex in range whenever the filtered set changes.
  useEffect(() => {
    if (activeIndex > selectable.length - 1) {
      setActiveIndex(Math.max(0, selectable.length - 1));
    }
  }, [selectable.length, activeIndex]);

  // Scroll the active option into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeAndReset();
      }
    }
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    // Position the active option on the current selection if present.
    const current = selectable.findIndex((s) => s.value === value);
    setActiveIndex(current >= 0 ? current : 0);
  }

  function closeAndReset() {
    setOpen(false);
    setQuery('');
  }

  function selectOption(opt: FlatItem) {
    onChange(opt.value);
    closeAndReset();
    inputRef.current?.focus();
  }

  function onInput(e: Event) {
    setQuery((e.target as HTMLInputElement).value);
    if (!open) setOpen(true);
    setActiveIndex(0);
  }

  function onKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActiveIndex((i) => Math.min(i + 1, selectable.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActiveIndex(selectable.length - 1);
        }
        break;
      case 'Enter':
        if (open && selectable[activeIndex]) {
          e.preventDefault();
          selectOption(selectable[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          closeAndReset();
        }
        break;
      default:
        break;
    }
  }

  // The input displays the typed query while filtering; otherwise the selection.
  const displayValue = open ? query : value;
  const activeId = open && selectable[activeIndex] ? optionId(activeIndex) : undefined;

  return (
    <div class="combobox" ref={rootRef}>
      <span id={labelId} class="combobox-label">
        {label}
      </span>
      <div class="combobox-control">
        <input
          ref={inputRef}
          type="text"
          class="combobox-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-labelledby={labelId}
          autocomplete="off"
          spellcheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={displayValue}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onFocus={openList}
          onClick={openList}
        />
        <span class="combobox-arrow" aria-hidden="true">
          ▾
        </span>
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          class="combobox-listbox"
          role="listbox"
          aria-labelledby={labelId}
        >
          {selectable.length === 0 && (
            <li class="combobox-empty" role="presentation">
              Sin resultados
            </li>
          )}
          {rows.map((row) =>
            row.type === 'group' ? (
              <li key={`g-${row.group}`} class="combobox-group" role="presentation">
                {row.group}
              </li>
            ) : (
              <li
                key={row.value}
                id={optionId(row.index)}
                class="combobox-option"
                role="option"
                aria-selected={row.value === value}
                data-active={row.index === activeIndex}
                // pointerdown (not click) so it fires before the input blur closes the list.
                onPointerDown={(e) => {
                  e.preventDefault();
                  selectOption(row);
                }}
                onMouseEnter={() => setActiveIndex(row.index)}
              >
                {row.value}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
};

export default Combobox;
