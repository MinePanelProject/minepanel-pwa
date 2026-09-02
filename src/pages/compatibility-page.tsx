import { Link } from 'react-router';

export const CompatibilityPage = (): React.JSX.Element => (
  <article className="mx-auto grid w-full max-w-3xl gap-8">
    <header className="grid gap-4">
      <p className="pixel-label text-accent">[ Hosted browser requirements ]</p>
      <h1 className="page-title text-3xl font-bold text-ink">MinePanel compatibility</h1>
      <p className="max-w-2xl text-lg leading-7 text-ink-muted">
        MinePanel is a hosted PWA that connects your browser directly to a self-hosted panel. When
        those services are on different sites, the browser must provide secure cross-site session features.
      </p>
    </header>

    <section className="panel-surface grid gap-4 p-6" aria-labelledby="hosted-auth-heading">
      <h2 id="hosted-auth-heading" className="section-title text-xl font-bold text-ink">How hosted sign-in stays safe</h2>
      <p className="leading-7 text-ink-muted">
        Sign-in and session cookies are <strong className="text-ink">HttpOnly</strong>, so application
        JavaScript cannot read session tokens. The backend marks hosted cookies as{' '}
        <strong className="text-ink">Secure; SameSite=None; Partitioned</strong>. The browser isolates
        those cookies to the MinePanel top-level site, allowing the dashboard to connect directly without
        relying on globally shared third-party cookies.
      </p>
    </section>

    <section className="panel-surface grid gap-4 p-6" aria-labelledby="locks-heading">
      <h2 id="locks-heading" className="section-title text-xl font-bold text-ink">Why Web Locks are required</h2>
      <p className="leading-7 text-ink-muted">
        Multiple tabs can try to refresh the same rotating session at once. MinePanel uses the browser's
        Web Locks feature to coordinate those refreshes and prevent tabs from racing the same session authority.
      </p>
    </section>

    <section className="panel-surface grid gap-4 p-6" aria-labelledby="supported-heading">
      <h2 id="supported-heading" className="section-title text-xl font-bold text-ink">What to use</h2>
      <ul className="grid list-disc gap-2 pl-5 leading-7 text-ink-muted">
        <li>An up-to-date stable release of a major browser.</li>
        <li>The hosted PWA loaded over HTTPS.</li>
        <li>A browser-trusted public HTTPS origin for the panel.</li>
        <li>An updated MinePanel backend when its compatibility check fails.</li>
      </ul>
      <p className="leading-7 text-ink-muted">
        MinePanel cannot currently guarantee support for old browsers without these web-platform features,
        arbitrary embedded WebViews, browser-untrusted HTTP endpoints, or arbitrary private and LAN origins
        from the hosted app. The PWA can verify the backend's advertised protocol and hosted-auth capability,
        but it cannot independently prove an HttpOnly partitioned-cookie exchange for every backend origin.
      </p>
    </section>

    <section className="panel-surface grid gap-4 p-6" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" className="section-title text-xl font-bold text-ink">Privacy and security</h2>
      <p className="leading-7 text-ink-muted">
        MinePanel intentionally keeps normal web session tokens in HttpOnly cookies instead of exposing them
        to application JavaScript. There is currently no alternate token-based hosted-auth fallback for an
        unsupported browser environment.
      </p>
    </section>

    <nav className="flex flex-wrap gap-3" aria-label="Compatibility navigation">
      <Link className="mp-button mp-button-primary inline-flex items-center px-4 py-2 no-underline" to="/">Back to panels</Link>
      <a className="mp-button mp-button-secondary inline-flex items-center px-4 py-2 no-underline" href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#partitioned_cookie" target="_blank" rel="noreferrer">
        CHIPS reference
      </a>
      <a className="mp-button mp-button-secondary inline-flex items-center px-4 py-2 no-underline" href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API" target="_blank" rel="noreferrer">
        Web Locks reference
      </a>
    </nav>
  </article>
);
