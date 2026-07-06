import { useState } from "react";
import type { Property, PropertyValue } from "../frontmatter";
import Icon from "./Icon";

interface Props {
  properties: Property[];
  onChange: (props: Property[]) => void;
}

/** Notion-style key/value table for YAML frontmatter. */
export default function Properties({ properties, onChange }: Props) {
  const [adding, setAdding] = useState(false);

  if (properties.length === 0 && !adding) {
    return (
      <div className="props props-empty">
        <button className="props-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Add property
        </button>
      </div>
    );
  }

  function update(i: number, value: PropertyValue) {
    const next = properties.slice();
    next[i] = { ...next[i], value };
    onChange(next);
  }

  function removeProp(i: number) {
    onChange(properties.filter((_, j) => j !== i));
  }

  function addProp(key: string) {
    if (!key.trim()) {
      setAdding(false);
      return;
    }
    onChange([...properties, { key: key.trim(), value: "" }]);
    setAdding(false);
  }

  return (
    <div className="props">
      {properties.map((p, i) => (
        <div className="prop-row" key={p.key + i}>
          <div className="prop-key" title={p.key}>
            {p.key}
          </div>
          <div className="prop-value">
            <PropertyEditor value={p.value} onChange={(v) => update(i, v)} />
          </div>
          <button
            className="prop-remove icon-btn"
            title="Remove property"
            onClick={() => removeProp(i)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="prop-row">
          <input
            className="prop-new-key"
            placeholder="Property name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") addProp((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={(e) => addProp(e.target.value)}
          />
        </div>
      ) : (
        <button className="props-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Add property
        </button>
      )}
    </div>
  );
}

function PropertyEditor({
  value,
  onChange,
}: {
  value: PropertyValue;
  onChange: (v: PropertyValue) => void;
}) {
  // Tag-style editor for string arrays.
  if (Array.isArray(value)) {
    return (
      <div className="prop-tags">
        {value.map((tag, i) => (
          <span className="tag" key={tag + i}>
            {String(tag)}
            <button
              className="tag-x icon-btn"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          placeholder="Add…"
          onKeyDown={(e) => {
            const input = e.target as HTMLInputElement;
            if (e.key === "Enter" && input.value.trim()) {
              onChange([...value, input.value.trim()]);
              input.value = "";
            } else if (e.key === "Backspace" && !input.value && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  return (
    <input
      className="prop-input"
      value={value == null ? "" : String(value)}
      placeholder="Empty"
      onChange={(e) => {
        const raw = e.target.value;
        // Preserve numbers as numbers.
        const n = Number(raw);
        onChange(raw !== "" && !Number.isNaN(n) && String(n) === raw ? n : raw);
      }}
    />
  );
}
