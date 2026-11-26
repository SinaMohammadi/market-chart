import license from '../../../../LICENSE?raw';
import { MarkdownPage } from './MarkdownPage';

const legal = () => import('../../../../docs/LEGAL.md?raw').then((m) => m.default);

/** The MIT licence text, then the legal notes (trademarks, disclaimers, privacy, third-party notices). */
export default function License() {
  return (
    <>
      <p>
        market-chart is released under the MIT license. You may use, modify and redistribute it,
        including commercially, as long as the copyright notice and the license text are kept. It is
        provided &ldquo;as is&rdquo;, without warranty of any kind.
      </p>
      <pre className="license">{license}</pre>
      <MarkdownPage load={legal} />
    </>
  );
}
