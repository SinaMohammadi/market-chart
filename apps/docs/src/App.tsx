import { Component, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChartProvider } from '@market-chart/react';
import { Search } from './components/Search';
import { PAGES, findPage } from './pages';
import { Link, SiteProvider, href, useRoute, useSite } from './site';

const SECTIONS = ['Introduction', 'Packages', 'Guides', 'Reference', 'Project'] as const;

function Nav({ path, onNavigate }: { path: string; onNavigate: () => void }) {
  return (
    <nav className="nav" aria-label="Documentation">
      {SECTIONS.map((section) => (
        <div key={section} className="nav-section">
          <h2 className="nav-title">{section}</h2>
          <ul>
            {PAGES.filter((p) => p.section === section).map((p) => (
              <li key={p.path}>
                <a
                  href={href(p.path)}
                  aria-current={p.path === path ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  {p.section === 'Packages' ? p.title.replace('@market-chart/', '') : p.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** "On this page": the headings of the rendered page, collected from the DOM after it renders. */
function Toc({ path, content }: { path: string; content: React.RefObject<HTMLElement | null> }) {
  const [items, setItems] = useState<{ id: string; text: string; level: number }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const collect = () => {
      const found = [...root.querySelectorAll<HTMLElement>('h2[id], h3[id]')]
        .filter((h) => !h.closest('.example-body, .code'))
        .map((h) => ({ id: h.id, text: h.textContent ?? '', level: h.tagName === 'H2' ? 2 : 3 }));
      setItems((prev) =>
        prev.length === found.length && prev.every((p, i) => p.id === found[i]!.id) ? prev : found,
      );
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(root, { childList: true, subtree: true });
    const onScroll = () => {
      const headings = [...root.querySelectorAll<HTMLElement>('h2[id], h3[id]')];
      let id: string | null = null;
      for (const h of headings) if (h.getBoundingClientRect().top < 120) id = h.id;
      setCurrent(id);
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      removeEventListener('scroll', onScroll);
    };
  }, [path, content]);
  if (items.length < 2) return <aside className="toc" />;
  return (
    <aside className="toc" aria-label="On this page">
      <h2 className="nav-title">On this page</h2>
      <ul>
        {items.map((i, n) => (
          <li key={`${n}-${i.id}`} data-level={i.level}>
            <a href={href(path, i.id)} aria-current={current === i.id ? 'location' : undefined}>
              {i.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Scrolls to the route's anchor once the (lazily loaded) page has rendered it, or to the top. */
function ScrollTo({ path, anchor }: { path: string; anchor: string | null }) {
  useLayoutEffect(() => {
    if (!anchor) {
      scrollTo({ top: 0 });
      return;
    }
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: 'start' });
      else if (tries++ < 20) setTimeout(tick, 100);
    };
    tick();
  }, [path, anchor]);
  return null;
}

/** A page that fails to load or render shows an error instead of taking the whole site down. */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="example-error" role="alert">
        <p>This page could not be shown: {this.state.error.message}</p>
        <p>
          <Link to="/">Back to the start page</Link>
        </p>
      </div>
    );
  }
}

function Shell() {
  const { path, anchor } = useRoute();
  const { theme, setTheme, locale, setLocale } = useSite();
  const [menu, setMenu] = useState(false);
  const content = useRef<HTMLElement | null>(null);
  const page = findPage(path);
  const index = page ? PAGES.indexOf(page) : -1;
  const prev = index > 0 ? PAGES[index - 1] : undefined;
  const next = index >= 0 && index < PAGES.length - 1 ? PAGES[index + 1] : undefined;
  const Page = page?.component;

  useEffect(() => {
    document.title =
      page && page.path !== '/' ? `${page.title} · market-chart` : 'market-chart docs';
  }, [page]);

  return (
    <div className="site" data-menu={menu || undefined}>
      <a className="skip" href={href(path, 'content')}>
        Skip to content
      </a>
      <header className="topbar">
        <button
          type="button"
          className="icon-button menu-button"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          ☰
        </button>
        <Link to="/" className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M5 4v16M5 8h-2v8h2M12 6v12M12 9h-2v6h2M19 3v14M19 6h-2v7h2" />
          </svg>
          market-chart
        </Link>
        <Search />
        <div className="topbar-tools">
          <label className="locale-select">
            <span className="sr-only">Language of the examples</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              title="Language of the examples"
            >
              <option value="en">English</option>
              <option value="fa">فارسی</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <Nav path={path} onNavigate={() => setMenu(false)} />
        </aside>
        <main className="content" id="content" ref={content}>
          {page ? (
            <>
              {page.path !== '/' ? (
                <header className="page-head">
                  <p className="eyebrow">{page.section}</p>
                  <h1>{page.title}</h1>
                  <p className="lead">{page.summary}</p>
                </header>
              ) : null}
              <PageBoundary key={path}>
                <Suspense fallback={<p className="muted">Loading…</p>}>
                  {Page ? <Page /> : null}
                  <ScrollTo path={path} anchor={anchor} />
                </Suspense>
              </PageBoundary>
              <nav className="pager" aria-label="Previous and next page">
                {prev ? (
                  <Link to={prev.path} className="pager-link">
                    <small>Previous</small>
                    {prev.title}
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link to={next.path} className="pager-link next">
                    <small>Next</small>
                    {next.title}
                  </Link>
                ) : null}
              </nav>
            </>
          ) : (
            <div>
              <h1>Page not found</h1>
              <p>
                <Link to="/">Back to the start page</Link>
              </p>
            </div>
          )}
          <footer className="footer">
            MIT licensed · Independent open-source project · All example data is synthetic · Not
            financial advice
          </footer>
        </main>
        <Toc path={path} content={content} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <SiteProvider>
      <Localized />
    </SiteProvider>
  );
}

/** The examples' language comes from the site header (the text of the docs is English). */
function Localized() {
  const { locale } = useSite();
  return (
    <ChartProvider locale={locale}>
      <Shell />
    </ChartProvider>
  );
}
