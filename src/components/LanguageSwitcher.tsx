import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGUAGES } from "../i18n/config";

/**
 * Global language switcher — a flag dropdown for the app header. Changing the
 * language updates the whole app immediately (no refresh) and persists the
 * choice to localStorage via the i18n `languageChanged` handler.
 */
export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ??
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language?.split("-")[0]) ??
    SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (code: string) => {
    if (code !== i18n.language) void i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language.label", "Language")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
      >
        <Globe className="h-4 w-4 text-neutral-500" />
        <span className="hidden sm:inline">{active.flag}</span>
        <span className="hidden md:inline">{active.nativeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = lang.code === active.code;
            return (
              <li key={lang.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(lang.code)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-neutral-50 ${
                    selected ? "font-semibold text-primary" : "text-neutral-700"
                  }`}
                >
                  <span className="text-base leading-none">{lang.flag}</span>
                  <span className="flex-1">{t(lang.labelKey)}</span>
                  {selected && <Check className="h-4 w-4 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
