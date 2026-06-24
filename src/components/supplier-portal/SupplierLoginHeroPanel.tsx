import {
  CreditCard,
  FileSearch,
  Handshake,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import BrandLogo from "../BrandLogo";
import { APP_NAME } from "../../config/branding";

const FEATURE_CARDS: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: "RFQ Management",
    description: "View invitations and submit competitive quotations online.",
    icon: FileSearch,
  },
  {
    title: "Purchase Orders",
    description: "Track awarded POs, line items, and fulfillment status.",
    icon: ShoppingCart,
  },
  {
    title: "Delivery Tracking",
    description: "Monitor goods receipt progress and shipment milestones.",
    icon: Truck,
  },
  {
    title: "Payment Visibility",
    description: "See invoice status and payment disbursement updates.",
    icon: CreditCard,
  },
];

const WORKFLOW_NODES = [
  { icon: FileSearch, label: "RFQ", top: "12%", left: "50%" },
  { icon: ShoppingCart, label: `${APP_NAME} PO`, top: "50%", left: "84%" },
  { icon: Truck, label: "GRN", top: "84%", left: "50%" },
  { icon: CreditCard, label: "Supplier PAY", top: "50%", left: "16%" },
] as const;

export default function SupplierLoginHeroPanel() {
  return (
    <section className="supplier-login-hero relative flex min-h-[520px] w-full flex-col overflow-hidden lg:min-h-screen lg:w-[65%]">
      <div className="supplier-login-hero-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="login-grid-mesh pointer-events-none absolute inset-0 opacity-30" aria-hidden />

      <div className="relative z-10 flex h-full flex-1 flex-col px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
        <header className="shrink-0">
          <div className="flex items-center gap-3">
            <BrandLogo whiteBg size="sm" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                {APP_NAME}
              </h1>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/60">
                Supplier Portal
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8 flex flex-1 flex-col gap-10 lg:mt-10 lg:flex-row lg:items-center lg:gap-10">
          <div className="max-w-lg shrink-0 lg:w-[48%]">
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              Supplier Collaboration Portal
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/80 sm:text-base">
              Submit quotations, track purchase orders, monitor deliveries and
              payment status from a single portal.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {FEATURE_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <article
                    key={card.title}
                    className="supplier-login-feature-card rounded-xl p-3.5"
                  >
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <h3 className="text-sm font-semibold text-white">
                      {card.title}
                    </h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                      {card.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="relative flex flex-1 items-center justify-center lg:min-h-[360px]">
            <div className="supplier-login-hub relative aspect-square w-full max-w-[min(100%,360px)]">
              <svg viewBox="0 0 400 400" className="h-full w-full" aria-hidden>
                <defs>
                  <radialGradient id="sp-hub-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                  </radialGradient>
                </defs>
                <circle
                  cx="200"
                  cy="200"
                  r="150"
                  fill="url(#sp-hub-glow)"
                  className="login-network-pulse"
                />
                <ellipse
                  cx="200"
                  cy="200"
                  rx="128"
                  ry="86"
                  fill="none"
                  stroke="rgba(255,255,255,0.14)"
                  strokeWidth="1"
                  strokeDasharray="5 7"
                  className="login-network-spin-slow"
                />
                <circle
                  cx="200"
                  cy="200"
                  r="118"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                  strokeDasharray="3 6"
                />
                {WORKFLOW_NODES.map((node) => (
                  <line
                    key={`line-${node.label}`}
                    x1="200"
                    y1="200"
                    x2={
                      node.left === "50%"
                        ? 200
                        : node.left === "84%"
                          ? 310
                          : 90
                    }
                    y2={
                      node.top === "50%"
                        ? 200
                        : node.top === "12%"
                          ? 72
                          : 328
                    }
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1.5"
                  />
                ))}
              </svg>

              <div className="supplier-login-hub-center pointer-events-none absolute left-1/2 top-1/2 flex h-[24%] w-[24%] min-h-[64px] min-w-[64px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl">
                <Handshake className="h-7 w-7 text-white" />
                <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-white/75">
                  Collaborate
                </span>
              </div>

              {WORKFLOW_NODES.map((node, i) => {
                const Icon = node.icon;
                return (
                  <div
                    key={node.label}
                    className={`login-network-node login-float-delay-${(i % 2) + 1} pointer-events-none absolute -translate-x-1/2 -translate-y-1/2`}
                    style={{ top: node.top, left: node.left }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/25 bg-white/12 shadow-lg backdrop-blur-md">
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="mt-1 block max-w-[72px] text-center text-[8px] font-semibold uppercase leading-tight tracking-wide text-white/60">
                      {node.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
