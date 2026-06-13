import { Link } from "react-router-dom";

/** Shared footer with full site navigation (keeps the top nav lean). */
export function SiteFooter() {
  return (
    <footer className="foot wrap">
      <div className="foot-links">
        <Link to="/docs">Docs</Link>
        <Link to="/sdk">SDK</Link>
        <Link to="/security">Security</Link>
        <Link to="/marketplace">Marketplace</Link>
        <Link to="/business">Business</Link>
        <Link to="/explorer">Live Demo</Link>
        <Link to="/post">Post a job</Link>
      </div>
      <span>Built on Avalanche</span>
    </footer>
  );
}
