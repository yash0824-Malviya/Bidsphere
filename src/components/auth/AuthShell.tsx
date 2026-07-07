import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";
import { Boxes, Globe2, ShieldCheck, Sparkles } from "lucide-react";

import BrandLogo from "../BrandLogo";
import { APP_NAME } from "../../config/branding";
import loginBackground from "../../assets/bidsphere-login-bg.png";

/*
 * Shared enterprise authentication shell used by both the Login and OTP
 * verification screens so the two pages read as a single, cohesive
 * experience. All colours come from the Tailwind theme tokens
 * (primary / neutral) plus white-with-opacity glass surfaces — no
 * page-level hard-coded hex values.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-neutral-900 font-sans">
      {/* ── Full-screen logistics background ── */}
      <div
        className="bsphere-fade absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${loginBackground})` }}
        aria-hidden="true"
      />
      {/* Blue gradient + dark overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-neutral-900/85 via-primary-900/55 to-neutral-900/80"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-neutral-900/70 via-transparent to-primary-900/40 backdrop-blur-[2px]"
        aria-hidden="true"
      />

      {/* ── Company logo, top-left ── */}
      <header className="absolute left-5 top-5 z-20 flex items-center gap-3 sm:left-9 sm:top-7">
        <BrandLogo whiteBg size="sm" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">{APP_NAME}</p>
          <p className="text-[11px] font-medium text-white/60">
            {t("login.workspace")}
          </p>
        </div>
      </header>

      {/* ── Content grid ── */}
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1500px] grid-cols-1 items-center gap-10 px-5 pb-14 pt-28 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-0">
        {/* Left — branding */}
        <section className="bsphere-rise hidden text-white lg:block">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary-300" />
            {t("login.tagline")}
          </span>

          <h1 className="mt-7 text-4xl font-bold leading-[1.08] tracking-tight xl:text-5xl">
            {t("login.headline")}
            <span className="mt-2 block bg-gradient-to-r from-primary-200 via-primary-300 to-white bg-clip-text font-semibold text-transparent">
              {t("login.headlineAccent")}
            </span>
          </h1>

          <p className="mt-6 max-w-md text-base leading-relaxed text-white/75">
            {t("login.description")}
          </p>

          <div className="mt-10 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-3">
            <FeatureChip icon={<Globe2 className="h-4 w-4" />} label={t("login.supplyChain")} />
            <FeatureChip icon={<Boxes className="h-4 w-4" />} label={t("login.workspace")} />
            <FeatureChip icon={<ShieldCheck className="h-4 w-4" />} label={t("login.secureNotice")} />
          </div>
        </section>

        {/* Right — auth card slot */}
        <div className="flex justify-center lg:justify-end">{children}</div>
      </div>
    </div>
  );
}

function FeatureChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-3.5 py-3 backdrop-blur-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-primary-200">
        {icon}
      </span>
      <span className="text-xs font-medium leading-tight text-white/85">
        {label}
      </span>
    </div>
  );
}
