import { ShieldCheck } from "lucide-react";

export default function SupplierLoginHeroPanel() {
  return (
    <div
      className="relative flex flex-col justify-center text-white text-left my-auto"
      style={{ maxWidth: "540px" }}
    >
      {/* Subtle glass container behind the text */}
      <div
        style={{
          background: "rgba(10, 25, 50, 0.32)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "22px",
          padding: "32px",
          boxShadow: "0 18px 50px rgba(0, 0, 0, 0.12)",
        }}
      >
        {/* "Welcome to" */}
        <p
          style={{
            fontSize: "22px",
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.88)",
            marginBottom: "8px",
            lineHeight: 1.2,
          }}
        >
          Welcome to
        </p>

        {/* "BidSphere" */}
        <h1
          style={{
            fontSize: "56px",
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: "-1.5px",
            color: "#FFFFFF",
            marginBottom: "12px",
          }}
        >
          BidSphere
        </h1>

        {/* "Supplier Collaboration Portal" */}
        <p
          style={{
            fontSize: "22px",
            fontWeight: 600,
            color: "#FFFFFF",
            marginBottom: "22px",
            lineHeight: 1.3,
          }}
        >
          Supplier Collaboration Portal
        </p>

        {/* Security Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            padding: "9px 15px",
            background: "rgba(10, 62, 125, 0.42)",
            border: "1px solid rgba(80, 170, 255, 0.45)",
            borderRadius: "10px",
            marginBottom: "18px",
            width: "fit-content",
          }}
        >
          <ShieldCheck style={{ height: "16px", width: "16px", color: "#38BDF8", flexShrink: 0 }} />
          <span style={{ color: "#FFFFFF", fontSize: "14px", fontWeight: 600 }}>
            Secure. Transparent. Connected.
          </span>
        </div>

        {/* Description */}
        <p
          style={{
            fontSize: "17px",
            lineHeight: 1.6,
            fontWeight: 400,
            color: "rgba(255, 255, 255, 0.85)",
            margin: 0,
          }}
        >
          Manage RFQs, Purchase Orders, Deliveries and
          <br />
          Payments from one secure portal.
        </p>
      </div>
    </div>
  );
}
