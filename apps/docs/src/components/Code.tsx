import { useState } from 'react';
import type { ReactNode } from 'react';

const KEYWORDS = new Set(
  (
    'import export from default const let var function return if else for while do switch case break ' +
    'continue new class extends implements interface type enum as of in instanceof typeof keyof readonly ' +
    'async await yield try catch finally throw void null undefined true false this super static public ' +
    'private protected declare namespace satisfies'
  ).split(' '),
);

/** One small tokenizer for TS/TSX/JS, JSON and shell: enough for documentation snippets, no dependency. */
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#(?!\/)[^\n]*)|(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|(<\/?[A-Za-z][\w.]*)|(\b[A-Za-z_$][\w$]*\b)|([{}()[\];,.:=<>+\-*/!?&|%^~@]+)/g;

function highlight(code: string, language: string): ReactNode[] {
  const out: ReactNode[] = [];
  const shell = language === 'sh' || language === 'bash' || language === 'powershell';
  let last = 0;
  let key = 0;
  for (const match of code.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(code.slice(last, index));
    const [text, comment, string, number, tag, word] = match;
    let cls: string | null = null;
    if (comment !== undefined) {
      // `#` starts a comment only in shell snippets.
      cls = comment.startsWith('#') && !shell ? null : 'tok-comment';
    } else if (string !== undefined) cls = 'tok-string';
    else if (number !== undefined) cls = 'tok-number';
    else if (tag !== undefined) cls = 'tok-tag';
    else if (word !== undefined) {
      if (KEYWORDS.has(word)) cls = 'tok-keyword';
      else if (/^[A-Z]/.test(word)) cls = 'tok-type';
      else if (code[index + word.length] === '(') cls = 'tok-fn';
      else if (shell && index === code.lastIndexOf('\n', index) + 1) cls = 'tok-fn';
    } else cls = 'tok-punct';
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        text
      ),
    );
    last = index + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export interface CodeProps {
  readonly code: string;
  readonly language?: string;
  readonly title?: string;
}

/** Highlighted code block with a copy button. */
export function Code({ code, language = 'tsx', title }: CodeProps) {
  const [copied, setCopied] = useState(false);
  const text = code.replace(/\n+$/, '');
  return (
    <div className="code">
      <div className="code-bar">
        <span className="code-lang">{title ?? language}</span>
        <button
          type="button"
          className="code-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{highlight(text, language)}</code>
      </pre>
    </div>
  );
}
