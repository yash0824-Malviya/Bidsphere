import { DEFAULT_ERP_TIME_ZONE } from "./erpServerDateCore.js";

/** Match the site's existing configured date policy, including midnight boundaries. */
export function clmNow(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.ERP_TIME_ZONE || process.env.VITE_ERP_TIME_ZONE || DEFAULT_ERP_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(row => row.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
