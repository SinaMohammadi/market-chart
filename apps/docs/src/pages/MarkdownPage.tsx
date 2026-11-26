import { useEffect, useState } from 'react';
import { Markdown } from '../components/Markdown';

/** A repository document rendered as a page (optionally only the part between two headings). */
export function MarkdownPage({
  load,
  slice,
}: {
  load: () => Promise<string>;
  slice?: readonly [string, string];
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((source) => {
      if (!live) return;
      if (slice) {
        const from = source.indexOf(slice[0]);
        const to = source.indexOf(slice[1], from + 1);
        source = from >= 0 ? source.slice(from, to > from ? to : undefined) : source;
      }
      setText(source);
    });
    return () => {
      live = false;
    };
  }, [load, slice]);
  if (text === null) return <p className="muted">Loading…</p>;
  return <Markdown source={text} skipTitle={!slice} />;
}
