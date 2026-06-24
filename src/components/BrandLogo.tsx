import { NETLINK_LOGO_PATH, COMPANY_NAME } from "../config/branding";

const HEIGHT = {
  xs: "h-8",
  sm: "h-10",
  md: "h-14",
  lg: "h-[4.5rem]",
  xl: "h-24",
} as const;

interface BrandLogoProps {
  size?: keyof typeof HEIGHT;
  className?: string;
  /** Crop to the N mark only — for compact sidebar/header slots. */
  markOnly?: boolean;
  /** Frosted badge for dark hero panels. */
  framed?: boolean;
  /** Solid white tile — for login form and light backgrounds. */
  whiteBg?: boolean;
}

export default function BrandLogo({
  size = "sm",
  className = "",
  markOnly = false,
  framed = false,
  whiteBg = false,
}: BrandLogoProps) {
  const img = markOnly ? (
    <img
      src={NETLINK_LOGO_PATH}
      alt={`${COMPANY_NAME} logo`}
      className={`h-9 w-9 shrink-0 rounded-md object-cover object-top ${className}`}
    />
  ) : (
    <img
      src={NETLINK_LOGO_PATH}
      alt={`${COMPANY_NAME} logo`}
      className={`${HEIGHT[size]} w-auto max-w-[11rem] object-contain ${className}`}
    />
  );

  if (whiteBg || framed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-xl p-2 shadow-md ring-1 ring-neutral-200/60 ${
          whiteBg
            ? markOnly
              ? "h-11 w-11 bg-white"
              : "h-auto min-h-11 bg-white px-2.5 py-2"
            : markOnly
              ? "h-11 w-11 bg-black"
              : "h-auto min-h-11 bg-black px-2.5 py-2"
        }`}
      >
        {img}
      </div>
    );
  }

  return img;
}
