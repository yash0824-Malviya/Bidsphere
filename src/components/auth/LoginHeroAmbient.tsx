export default function LoginHeroAmbient() {
  // Single monochrome tone so the logistics shapes read as a flat watermark.
  const INK = "#475569";

  return (
    <svg
      className="login-hero-ambient-svg absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="hero-route" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0" />
          <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Soft network arcs — subtle depth that supports the globe */}
      <path
        d="M 760 250 Q 920 320 1060 280"
        stroke="url(#hero-route)"
        strokeWidth="1"
        opacity="0.45"
      />
      <path
        d="M 720 560 Q 900 600 1080 540"
        stroke="url(#hero-route)"
        strokeWidth="0.8"
        opacity="0.35"
      />

      {/* ── Monochrome supply-chain watermark, bottom edge only ── */}

      {/* Slow truck path near the bottom edge */}
      <path id="hero-truck-path" d="M 40 752 Q 380 740 720 750 T 1180 742" fill="none" />

      {/* Warehouse silhouette */}
      <g opacity="0.075" fill={INK} transform="translate(150 706)">
        <polygon points="0,0 86,-44 172,0" />
        <rect x="0" y="0" width="172" height="74" rx="2" />
      </g>

      {/* Cargo ship silhouette */}
      <g opacity="0.075" fill={INK} transform="translate(560 728)">
        <path d="M 0 14 L 92 14 L 80 30 L 12 30 Z" />
        <rect x="16" y="0" width="16" height="14" rx="1" />
        <rect x="36" y="0" width="16" height="14" rx="1" />
        <rect x="56" y="0" width="16" height="14" rx="1" />
        <rect x="76" y="-8" width="10" height="22" rx="1" />
      </g>

      {/* Freight truck silhouette — very slow movement */}
      <g opacity="0.085" fill={INK}>
        <rect x="-13" y="-8" width="24" height="13" rx="2" />
        <rect x="11" y="-5" width="9" height="10" rx="1.5" />
        <circle cx="-4" cy="7" r="2.6" />
        <circle cx="13" cy="7" r="2.6" />
        <animateMotion dur="80s" repeatCount="indefinite" calcMode="linear">
          <mpath href="#hero-truck-path" />
        </animateMotion>
      </g>
    </svg>
  );
}
