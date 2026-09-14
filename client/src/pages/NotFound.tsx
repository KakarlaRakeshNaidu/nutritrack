import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <main className="content-shell">
      <section className="state-card empty-state">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p>The requested page is not part of the current application.</p>
        <Link className="button primary" to="/">
          Return home
        </Link>
      </section>
    </main>
  );
}
