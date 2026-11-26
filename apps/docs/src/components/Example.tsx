import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { Code } from './Code';

/** Keeps one failing example from taking the page down. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? (
      <p className="example-error">This example failed: {this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

export interface SourceFile {
  readonly file: string;
  /** The file's text (imported with `?raw`), so the code shown is the code running. */
  readonly code: string;
}

export interface ExampleProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly sources: readonly SourceFile[];
  readonly children: ReactNode;
}

/** A live example with a Preview tab and one tab per source file. */
export function Example({ title, description, sources, children }: ExampleProps) {
  const [tab, setTab] = useState<string>('preview');
  const current = sources.find((s) => s.file === tab);
  return (
    <section className="example">
      <header className="example-head">
        <div>
          <h3
            className="example-title"
            id={`example-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          >
            {title}
          </h3>
          {description ? <p className="example-desc">{description}</p> : null}
        </div>
        <div className="tabs" role="tablist" aria-label={`${title}: view`}>
          {['preview', ...sources.map((s) => s.file)].map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className="tab"
              onClick={() => setTab(t)}
            >
              {t === 'preview' ? 'Preview' : t}
            </button>
          ))}
        </div>
      </header>
      <div className="example-body" hidden={tab !== 'preview'}>
        <Boundary>{children}</Boundary>
      </div>
      {current ? <Code code={current.code} language="tsx" title={current.file} /> : null}
    </section>
  );
}
