import { Sparkles } from "lucide-react";

import { APP_NAME } from "../../config/branding";
import BrandLogo from "../BrandLogo";
import LoginHeroVisual from "./LoginHeroVisual";

export default function LoginHeroPanel() {
  return (
    <section className="login-hero-light relative flex min-h-[520px] w-full flex-col overflow-hidden lg:min-h-screen lg:w-[58%]">
      <LoginHeroVisual />

      <div className="relative z-10 flex h-full flex-1 flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14 lg:py-10">
        <header className="shrink-0">
          <BrandLogo size="md" />
        </header>

        <div className="relative z-10 flex flex-1 flex-col justify-center py-10 lg:py-0 lg:pr-[44%]">
          <div className="relative w-full max-w-[500px]">
            <h1 className="login-hero-brand text-[2.75rem] font-bold tracking-tight sm:text-5xl lg:text-[3.2rem] lg:leading-[1.05]">
              <span className="bg-gradient-to-r from-[#0284c7] via-[#0ea5e9] to-[#38bdf8] bg-clip-text text-transparent">
                {APP_NAME}
              </span>
            </h1>

            <div className="login-hero-badge mt-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium">
              <Sparkles className="h-3 w-3 text-[#0ea5e9]" />
              AI-Powered Procurement Platform
            </div>

            <h2 className="mt-8 text-2xl font-semibold leading-[1.3] tracking-tight text-slate-900 sm:text-[1.85rem]">
              Procurement Intelligence
              <span className="mt-1.5 block font-medium text-slate-500">
                for Enterprise Supply Chains
              </span>
            </h2>

            <p className="mt-6 max-w-md text-sm leading-relaxed text-slate-500 sm:text-[15px]">
              Manage sourcing, suppliers, RFQs, purchase orders and logistics
              operations from a unified platform.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
}
