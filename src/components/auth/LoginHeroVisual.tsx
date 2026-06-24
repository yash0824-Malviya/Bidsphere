import LoginHeroAmbient from "./LoginHeroAmbient";
import LoginNetworkSphere from "./LoginNetworkSphere";

export default function LoginHeroVisual() {
  return (
    <div className="login-hero-visual pointer-events-none absolute inset-0" aria-hidden>
      <LoginHeroAmbient />
      <div className="login-hero-sphere-glow" />
      <div className="login-hero-canvas-wrap">
        <LoginNetworkSphere />
      </div>
    </div>
  );
}
