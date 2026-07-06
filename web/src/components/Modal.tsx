import { useEffect, useRef } from "react";

interface ConfirmProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Styled confirmation dialog replacing window.confirm(). */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={"btn primary" + (danger ? " danger" : "")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface InputProps {
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Styled single-input dialog replacing window.prompt(). */
export function InputModal({
  title,
  placeholder,
  initialValue = "",
  confirmLabel = "Create",
  onSubmit,
  onCancel,
}: InputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      // Select the name but not the extension, like Finder.
      const dot = initialValue.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
    }
  }, [initialValue]);

  function submit() {
    const v = inputRef.current?.value.trim();
    if (v) onSubmit(v);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder={placeholder}
          defaultValue={initialValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
