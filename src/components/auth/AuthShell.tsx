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
 *
 * Desktop layout is locked to 100dvh (no page scroll). Mobile may scroll.
 * Split: hero ~60–65% · login ~35–40%.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-x-hidden overflow-y-auto bg-neutral-900 font-sans sm:overflow-hidden">
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
      <header className="absolute left-4 top-3 z-20 flex items-center gap-2.5 sm:left-8 sm:top-4 lg:left-10">
        <BrandLogo whiteBg size="sm" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">{APP_NAME}</p>
          <p className="text-[11px] font-medium text-white/60">
            {t("login.workspace")}
          </p>
        </div>
      </header>

      {/* ── Content: flex, vertically centered, fits viewport ── */}
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1600px] min-h-0 flex-1 flex-col items-stretch justify-center gap-4 px-4 py-14 sm:px-8 sm:py-10 lg:flex-row lg:items-center lg:gap-8 lg:px-8 lg:py-8 desktop:gap-10">
        {/* Left — hero (~62%) */}
        <section className="bsphere-rise flex min-h-0 min-w-0 flex-col justify-center text-white lg:basis-0 lg:flex-[1.7]">
          <div className="w-full max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary-300" />
              {t("login.tagline")}
            </span>

            <h1 className="mt-4 max-w-2xl text-balance text-3xl font-bold leading-[1.12] tracking-tight lg:text-4xl desktop:text-[2.75rem] desktop:leading-[1.1]">
              {t("login.headline")}
              <span className="mt-1.5 block bg-gradient-to-r from-primary-200 via-primary-300 to-white bg-clip-text font-semibold text-transparent">
                {t("login.headlineAccent")}
              </span>
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 lg:text-base">
              {t("login.description")}
            </p>

            <div className="mt-5 grid max-w-2xl grid-cols-1 items-stretch gap-2.5 sm:grid-cols-3">
              <FeatureChip
                icon={<Globe2 className="h-4 w-4" />}
                label={t("login.supplyChain")}
              />
              <FeatureChip
                icon={<Boxes className="h-4 w-4" />}
                label={t("login.workspace")}
              />
              <FeatureChip
                icon={<ShieldCheck className="h-4 w-4" />}
                label={t("login.secureNotice")}
              />
            </div>
          </div>
        </section>

        {/* Right — auth (~38%), card centered inside */}
        <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center lg:basis-0 lg:flex-[1]">
          {children}
        </div>
      </div>
    </div>
  );
}

function FeatureChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-full min-h-[48px] items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 text-primary-200">
        {icon}
      </span>
      <span className="text-xs font-medium leading-snug text-white/85">
        {label}
      </span>
    </div>
  );
}
