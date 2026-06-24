import { NETLINK_LOGO_PATH, COMPANY_NAME } from "../config/branding";

const HEIGHT = {
  xs: "h-7",
  sm: "h-9",
  md: "h-11",
  lg: "h-14",
  xl: "h-20",
} as const;

interface BrandLogoProps {
  size?: keyof typeof HEIGHT;
  className?: string;
  /** Frosted badge for dark hero panels. */
  framed?: boolean;
  /** Solid white tile — for login form and light backgrounds. */
  whiteBg?: boolean;
}

export default function BrandLogo({
  size = "sm",
  className = "",
  framed = false,
  whiteBg = false,
}: BrandLogoProps) {
  const img = (
    <img
      src={NETLINK_LOGO_PATH}
      alt={`${COMPANY_NAME} logo`}
      className={`${HEIGHT[size]} w-auto object-contain ${whiteBg || framed ? "h-full w-full" : ""} ${className}`}
    />
  );

  if (whiteBg || framed) {
    return (
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-md ring-1 ring-neutral-200/60">
        {img}
      </div>
    );
  }

  return img;
}
