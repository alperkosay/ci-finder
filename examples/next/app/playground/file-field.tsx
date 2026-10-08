"use client";

import { useId } from "react";
import { useFilePicker, type Accept, type PickedFile } from "@ci-finder/react";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i;

/**
 * A text input with a "Choose" button next to it. The button opens ciFinder as a picker and writes
 * the chosen file's URL into the input; the input stays editable, so a URL can also be pasted.
 */
export function FileField({
  label,
  name,
  value,
  onChange,
  accept,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string, file?: PickedFile) => void;
  accept?: Accept;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  const picker = useFilePicker({ endpoint: "/api/files", locale: "tr", accept });

  const choose = async () => {
    const files = await picker.open();
    if (files?.[0]) onChange(files[0].url, files[0]);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="file-row">
        {IMAGE.test(value) && <img className="file-thumb" src={value} alt="" />}
        <input id={id} name={name} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        {value && (
          <button type="button" className="btn ghost" aria-label={`${label}: temizle`} onClick={() => onChange("")}>
            ×
          </button>
        )}
        <button type="button" className="btn" disabled={picker.isOpen} onClick={() => void choose()}>
          Dosya seç
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Several images: the picker opens with `multiple`, picks are appended. */
export function GalleryField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const picker = useFilePicker({ endpoint: "/api/files", locale: "tr", accept: "image/*", multiple: true, selectLabel: "Galeriye ekle" });
  const add = async () => {
    const files = await picker.open();
    if (files?.length) onChange([...value, ...files.map((f) => f.url).filter((url) => !value.includes(url))]);
  };
  return (
    <div className="field">
      <span className="label">{label}</span>
      <ul className="gallery">
        {value.map((url) => (
          <li key={url}>
            <img src={url} alt="" />
            <button type="button" aria-label={`${url} kaldır`} onClick={() => onChange(value.filter((u) => u !== url))}>
              ×
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="gallery-add" disabled={picker.isOpen} onClick={() => void add()}>
            + Görsel ekle
          </button>
        </li>
      </ul>
      <p className="hint">Ctrl / Shift ile birden fazla görsel seçebilirsiniz.</p>
    </div>
  );
}
