"use client";

import { useEffect, useState } from "react";
import { CiFinder } from "@ci-finder/react";

type Theme = "auto" | "light" | "dark";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Demo() {
  const [theme, setTheme] = useState<Theme>("auto");
  const [locale, setLocale] = useState<"tr" | "en">("tr");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="page">
      <header className="bar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h9.4a2.5 2.5 0 0 1 1.85.82L19.1 10.5H34.5A2.5 2.5 0 0 1 37 13v19.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 3 32.5z" fill="#d6a03d" />
            <path d="M3 15.75a2.5 2.5 0 0 1 2.5-2.5h29a2.5 2.5 0 0 1 2.5 2.5V32.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 3 32.5z" fill="#ecbf5f" />
            <circle cx="20" cy="24" r="4.5" fill="none" stroke="#7a5310" strokeWidth="2" />
            <path d="M23.3 27.3 26.5 30.5" stroke="#7a5310" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <strong>ciFinder</strong>
          <span>0.1</span>
        </div>
        <div className="controls">
          <Segmented label="Theme" value={theme} onChange={setTheme} options={[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]} />
          <Segmented label="Language" value={locale} onChange={setLocale} options={[["tr", "TR"], ["en", "EN"]]} />
          <Segmented label="Density" value={density} onChange={setDensity} options={[["comfortable", "Rahat"], ["compact", "Sıkı"]]} />
        </div>
      </header>
      <main className="stage">
        <CiFinder key={locale} endpoint="/api/files" locale={locale} theme={theme} density={density} />
      </main>
    </div>
  );
}
