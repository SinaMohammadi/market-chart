import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { iconPath, isDirectionalIcon } from '../icons.js';

export interface IconProps {
  readonly name: string | undefined;
  readonly direction?: 'ltr' | 'rtl';
  readonly size?: number;
}

/** A built-in (or `registerIcon`) icon; directional icons are mirrored in RTL. Decorative (`aria-hidden`). */
export function Icon({ name, direction = 'ltr', size = 18 }: IconProps) {
  return (
    <svg
      className="mc-ui-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-mirror={direction === 'rtl' && isDirectionalIcon(name) ? 'true' : undefined}
    >
      <path d={iconPath(name)} />
    </svg>
  );
}

export interface TooltipProps {
  readonly label: string;
  readonly shortcut?: string;
  readonly children: ReactElement<Record<string, unknown>>;
  readonly theme?: 'dark' | 'light';
  /** Where to place it relative to the trigger. */
  readonly placement?: 'below' | 'beside';
  readonly direction?: 'ltr' | 'rtl';
}

/**
 * Accessible tooltip: shown on hover and keyboard focus (after a short delay), hidden with Escape, referenced
 * through `aria-describedby`. Rendered in a portal so it is not clipped by toolbars.
 */
export function Tooltip({
  label,
  shortcut,
  children,
  theme,
  placement = 'below',
  direction = 'ltr',
}: TooltipProps) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const element = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!position) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPosition(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [position]);
  const show = (target: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = target.getBoundingClientRect();
      if (placement === 'beside')
        setPosition({
          left: direction === 'rtl' ? r.left - 8 : r.right + 8,
          top: r.top + r.height / 2 - 12,
        });
      else setPosition({ left: r.left + r.width / 2, top: r.bottom + 6 });
    }, 450);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setPosition(null);
  };
  const trigger = cloneElement(children, {
    'aria-describedby': position ? id : undefined,
    ref: (node: HTMLElement | null) => {
      element.current = node;
    },
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) =>
      e.pointerType === 'mouse' && show(e.currentTarget),
    onPointerLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
    onBlur: hide,
    onPointerDown: hide,
  });
  const doc = (globalThis as { document?: Document }).document;
  return (
    <>
      {trigger}
      {position && doc
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className="mc-ui-tooltip"
              data-mc-theme={theme}
              dir={direction}
              style={{
                left: position.left,
                top: position.top,
                transform:
                  placement === 'below'
                    ? 'translateX(-50%)'
                    : direction === 'rtl'
                      ? 'translateX(-100%)'
                      : undefined,
              }}
            >
              {label}
              {shortcut ? <kbd>{shortcut}</kbd> : null}
            </div>,
            doc.body,
          )
        : null}
    </>
  );
}
