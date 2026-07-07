import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";

/**
 * Supported UI languages. `flag` is a Unicode regional-indicator emoji and
 * `dir` keeps the architecture RTL-ready (all current languages are LTR).
 */
export interface AppLanguage {
  code: string;
  labelKey: string;
  nativeLabel: string;
  flag: string;
  dir: "ltr" | "rtl";
}

export const SUPPORTED_LANGUAGES: AppLanguage[] = [
  { code: "en", labelKey: "language.english", nativeLabel: "English", flag: "🇺🇸", dir: "ltr" },
  { code: "es", labelKey: "language.spanish", nativeLabel: "Español", flag: "🇪🇸", dir: "ltr" },
  { code: "es-MX", labelKey: "language.mexican", nativeLabel: "Español (MX)", flag: "🇲🇽", dir: "ltr" },
  { code: "fr", labelKey: "language.french", nativeLabel: "Français", flag: "🇫🇷", dir: "ltr" },
  { code: "de", labelKey: "language.german", nativeLabel: "Deutsch", flag: "🇩🇪", dir: "ltr" },
];

export const DEFAULT_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "netlink.lang";

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

/** Resolve the initial language: persisted choice → default English. */
export function getInitialLanguage(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && SUPPORTED_CODES.includes(stored)) return stored;
  } catch {
    /* localStorage unavailable (SSR / privacy mode) — fall back to default. */
  }
  return DEFAULT_LANGUAGE;
}

/** Apply the document direction for the active language (RTL-ready). */
export function applyDocumentDirection(code: string): void {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  const dir = lang?.dir ?? "ltr";
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", code);
  }
}

i18n
  // Lazy-load each language file as its own chunk — languages are NOT bundled
  // together. Vite code-splits every match of `messages/<lang>.json`.
  .use(
    resourcesToBackend(
      (language: string) => import(`../../messages/${language}.json`)
    )
  )
  .use(initReactI18next)
  .init({
    lng: getInitialLanguage(),
    fallbackLng: {
      "es-MX": ["es", "en"],
      default: ["en"],
    },
    supportedLngs: SUPPORTED_CODES,
    load: "currentOnly",
    // Deep-merge nested namespaces; default namespace covers the whole app.
    defaultNS: "translation",
    ns: "translation",
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: true },
  });

// Persist the choice and keep <html dir/lang> in sync on every change.
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* ignore persistence failures */
  }
  applyDocumentDirection(lng);
});

applyDocumentDirection(i18n.language || DEFAULT_LANGUAGE);

export default i18n;
