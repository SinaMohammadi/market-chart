import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon.js';
import { useUiStyles } from './styles.js';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly direction?: 'ltr' | 'rtl';
  readonly lang?: string;
  readonly theme?: 'dark' | 'light';
  readonly size?: 'small' | 'large' | 'search' | 'ticket';
  readonly closeLabel?: string;
  /** Element focused when the dialog opens (default: the first focusable element). */
  readonly initialFocus?: RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog: labelled, focus moved in and trapped, Escape and backdrop close it, focus restored after. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  direction = 'ltr',
  lang,
  theme,
  size = 'large',
  closeLabel = 'Close',
  initialFocus,
}: DialogProps) {
  useUiStyles();
  const id = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const restore = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const first = initialFocus?.current ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      if (restore.current && document.contains(restore.current))
        restore.current.focus({ preventScroll: true });
    };
  }, [open, initialFocus]);
  if (!open) return null;
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;
  return createPortal(
    <div
      className="mc-ui-dialog-backdrop"
      data-mc-theme={theme}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div
        ref={panel}
        className="mc-ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        dir={direction}
        lang={lang}
        data-size={size}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close.current();
            return;
          }
          if (e.key !== 'Tab') return;
          const nodes = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (!nodes.length) return;
          const firstNode = nodes[0]!;
          const lastNode = nodes[nodes.length - 1]!;
          if (e.shiftKey && document.activeElement === firstNode) {
            e.preventDefault();
            lastNode.focus();
          } else if (!e.shiftKey && document.activeElement === lastNode) {
            e.preventDefault();
            firstNode.focus();
          }
        }}
      >
        <div className="mc-ui-dialog-head">
          <span id={id}>{title}</span>
          <button
            type="button"
            className="mc-ui-btn"
            aria-label={closeLabel}
            onClick={() => close.current()}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
        {footer ? <div className="mc-ui-dialog-foot">{footer}</div> : null}
      </div>
    </div>,
    doc.body,
  );
}
