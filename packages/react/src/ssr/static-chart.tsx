import { useId } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import {
  candleGeometry,
  createPriceFormatter,
  downsampleLine,
  lineGeometry,
  resolveTheme,
} from '@market-chart/core/static';
import type { LinePoint, OhlcBar, PriceFormat, ThemeInput } from '@market-chart/core/static';

interface StaticChartBaseProps {
  /** Rendered height in CSS px. */
  height: number;
  /** Internal drawing width (viewBox units); the SVG always stretches to 100% of its container. */
  viewBoxWidth?: number;
  theme?: ThemeInput;
  /** Accessible label, e.g. "BTCUSDT price, last 30 days". */
  title?: string;
  /** Show the last value as a label on the right. */
  showLastValue?: boolean;
  priceFormat?: PriceFormat;
  /** Draw the theme background. Defaults to transparent. */
  background?: boolean;
  className?: string;
  style?: CSSProperties;
}

export interface StaticLineChartProps extends StaticChartBaseProps {
  type: 'line' | 'area';
  data: readonly LinePoint[];
  color?: string;
  /** Long histories are downsampled (min/max per bucket) to keep HTML small. */
  maxPoints?: number;
}

export interface StaticCandleChartProps extends StaticChartBaseProps {
  type: 'candlestick';
  data: readonly OhlcBar[];
  upColor?: string;
  downColor?: string;
}

export type StaticChartProps = StaticLineChartProps | StaticCandleChartProps;

/**
 * Server-renderable, dependency-light chart for landing pages, previews and SEO content.
 *
 * - No browser globals, no DOM access, no effects: output depends only on props, so server and
 *   client markup are identical (no hydration mismatch).
 * - Does not import the interactive engine.
 */
export function StaticChart(props: StaticChartProps) {
  const {
    height,
    viewBoxWidth = 600,
    theme = 'light',
    title,
    showLastValue = false,
    background = false,
    className,
    style,
  } = props;
  const colors = resolveTheme(theme);
  const gradientId = `mc-static-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const format = createPriceFormatter(props.priceFormat ?? { type: 'price', precision: 2 });
  const viewport = {
    width: viewBoxWidth,
    height,
    padding: { top: 6, bottom: 6, left: 0, right: 0 },
  };

  let content: ReactElement[] = [];
  let last: { y: number; value: number; color: string } | null = null;

  if (props.type === 'candlestick') {
    const up = props.upColor ?? colors.upColor;
    const down = props.downColor ?? colors.downColor;
    const { candles } = candleGeometry(props.data, viewport);
    content = candles.map((c, i) => (
      <g key={i} fill={c.up ? up : down} stroke={c.up ? up : down}>
        <line
          x1={c.x}
          x2={c.x}
          y1={c.wickTop}
          y2={c.wickBottom}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={Math.round((c.x - c.bodyWidth / 2) * 100) / 100}
          y={c.bodyTop}
          width={c.bodyWidth}
          height={c.bodyHeight}
          stroke="none"
        />
      </g>
    ));
    const lastBar = props.data[props.data.length - 1];
    const lastCandle = candles[candles.length - 1];
    if (lastBar && lastCandle) {
      const y = lastCandle.up ? lastCandle.bodyTop : lastCandle.bodyTop + lastCandle.bodyHeight;
      last = { y, value: lastBar.close, color: lastCandle.up ? up : down };
    }
  } else {
    const color = props.color ?? colors.lineColor;
    const points = downsampleLine(props.data, props.maxPoints ?? 600);
    const g = lineGeometry(points, viewport);
    if (props.type === 'area' && g.area) {
      content.push(
        <defs key="defs">
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>,
        <path key="area" d={g.area} fill={`url(#${gradientId})`} stroke="none" />,
      );
    }
    if (g.line) {
      content.push(
        <path
          key="line"
          d={g.line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    if (g.last) last = { y: g.last.y, value: g.last.value, color };
  }

  const isEmpty = content.length === 0;
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height,
        background: background ? colors.background : undefined,
        ...style,
      }}
    >
      <svg
        role="img"
        aria-label={title ?? (isEmpty ? 'Empty chart' : 'Price chart')}
        viewBox={`0 0 ${viewBoxWidth} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {title ? <title>{title}</title> : null}
        {content}
      </svg>
      {showLastValue && last ? (
        <span
          style={{
            position: 'absolute',
            right: 0,
            top: `${((last.y / height) * 100).toFixed(2)}%`,
            transform: 'translateY(-50%)',
            padding: '1px 4px',
            font: '11px/1.4 system-ui, sans-serif',
            color: '#fff',
            background: last.color,
            borderRadius: 2,
          }}
        >
          {format(last.value)}
        </span>
      ) : null}
    </div>
  );
}
