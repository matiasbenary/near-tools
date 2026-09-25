'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCombobox } from 'downshift';

export type AssetOption = {
  value: string;
  label: string;
  /** Balance line or token id, shown under the label. */
  detail?: string;
  icon?: string;
  group: 'Tokens' | 'NFTs';
};

/** Searchable asset select: the query lives inside the control, grouped by kind. */
export function AssetPicker({
  id,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  options: AssetOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const controlRef = useRef<HTMLDivElement>(null);
  // ponytail: the menu renders in a portal because the wizard panel clips it.
  // Fixed coords tracked on scroll/resize — no positioning library for one dropdown.
  const [rect, setRect] = useState<DOMRect | null>(null);
  const selected = options.find((option) => option.value === value) ?? null;
  const items = query.trim()
    ? options.filter((option) =>
        `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
      )
    : options;

  const combobox = useCombobox({
    items,
    inputValue: query,
    selectedItem: selected,
    itemToString: (item) => item?.label ?? '',
    onInputValueChange: ({ inputValue, isOpen }) => setQuery(isOpen ? (inputValue ?? '') : ''),
    // ponytail: the input is the search box, never the display — the picked asset
    // shows in the trigger row below, so clear the query on every open/close.
    onIsOpenChange: () => setQuery(''),
    onSelectedItemChange: ({ selectedItem }) => selectedItem && onChange(selectedItem.value),
  });

  useLayoutEffect(() => {
    if (!combobox.isOpen) return setRect(null);
    const track = () => setRect(controlRef.current?.getBoundingClientRect() ?? null);
    track();
    window.addEventListener('scroll', track, true);
    window.addEventListener('resize', track);
    return () => {
      window.removeEventListener('scroll', track, true);
      window.removeEventListener('resize', track);
    };
  }, [combobox.isOpen]);

  const menu = (
    <ul
      {...combobox.getMenuProps()}
      className="asset-picker-menu"
      hidden={!combobox.isOpen}
      style={rect ? { top: rect.bottom + 4, left: rect.left, width: rect.width } : undefined}
    >
      {combobox.isOpen &&
        items.map((item, index) => (
          <li key={item.value}>
            {(index === 0 || items[index - 1].group !== item.group) && (
              <span className="asset-picker-group">{item.group}</span>
            )}
            <div
              className={`asset-picker-option${combobox.highlightedIndex === index ? ' is-highlighted' : ''}`}
              {...combobox.getItemProps({ item, index })}
            >
              {item.icon ? (
                <img src={item.icon} alt="" className="asset-icon" />
              ) : (
                <span className="asset-icon asset-icon-empty" aria-hidden="true" />
              )}
              <span>
                {item.label}
                {item.detail && <small>{item.detail}</small>}
              </span>
            </div>
          </li>
        ))}
      {combobox.isOpen && items.length === 0 && (
        <li className="asset-picker-empty">Nothing matches that search.</li>
      )}
    </ul>
  );

  return (
    <div className="asset-picker">
      <div className="asset-picker-control" ref={controlRef}>
        {selected?.icon && <img src={selected.icon} alt="" className="asset-icon" />}
        <input {...combobox.getInputProps({ id, placeholder: selected?.label ?? placeholder })} />
        <button type="button" {...combobox.getToggleButtonProps()} aria-label="Show assets">
          ▾
        </button>
      </div>
      {rect ? createPortal(menu, document.body) : menu}
    </div>
  );
}
