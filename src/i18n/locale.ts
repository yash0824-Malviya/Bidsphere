import i18n, { DEFAULT_LANGUAGE } from "./config";

/** Map an app language code to a full BCP-47 locale for Intl formatting. */
const INTL_LOCALE: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  "es-MX": "es-MX",
  fr: "fr-FR",
  de: "de-DE",
};

/** The active Intl locale, derived from the current i18n language. */
export function getIntlLocale(): string {
  const lng = i18n.language || DEFAULT_LANGUAGE;
  return INTL_LOCALE[lng] ?? INTL_LOCALE[lng.split("-")[0]] ?? "en-US";
}
