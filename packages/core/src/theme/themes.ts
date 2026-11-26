/** Colour tokens used by the engine. Series colours default from here unless overridden. */
export interface ChartTheme {
  readonly name: string;
  readonly background: string;
  readonly textColor: string;
  readonly gridColor: string;
  readonly borderColor: string;
  readonly crosshairColor: string;
  readonly crosshairLabelBackground: string;
  readonly crosshairLabelText: string;
  readonly paneSeparatorColor: string;
  readonly upColor: string;
  readonly downColor: string;
  readonly lineColor: string;
  readonly areaTopColor: string;
  readonly areaBottomColor: string;
  readonly histogramColor: string;
  readonly baselineTopLineColor: string;
  readonly baselineTopFillColor: string;
  readonly baselineBottomLineColor: string;
  readonly baselineBottomFillColor: string;
}

export const darkTheme: ChartTheme = {
  name: 'dark',
  background: '#0f1117',
  textColor: '#b2b5be',
  gridColor: 'rgba(42, 46, 57, 0.6)',
  borderColor: '#2a2e39',
  crosshairColor: 'rgba(149, 152, 161, 0.75)',
  crosshairLabelBackground: '#363a45',
  crosshairLabelText: '#e6e8ee',
  paneSeparatorColor: '#2a2e39',
  upColor: '#26a69a',
  downColor: '#ef5350',
  lineColor: '#2962ff',
  areaTopColor: 'rgba(41, 98, 255, 0.4)',
  areaBottomColor: 'rgba(41, 98, 255, 0)',
  histogramColor: 'rgba(38, 166, 154, 0.5)',
  baselineTopLineColor: '#26a69a',
  baselineTopFillColor: 'rgba(38, 166, 154, 0.25)',
  baselineBottomLineColor: '#ef5350',
  baselineBottomFillColor: 'rgba(239, 83, 80, 0.25)',
};

export const lightTheme: ChartTheme = {
  name: 'light',
  background: '#ffffff',
  textColor: '#131722',
  gridColor: 'rgba(224, 227, 235, 0.8)',
  borderColor: '#d1d4dc',
  crosshairColor: 'rgba(117, 134, 150, 0.75)',
  crosshairLabelBackground: '#131722',
  crosshairLabelText: '#ffffff',
  paneSeparatorColor: '#e0e3eb',
  upColor: '#089981',
  downColor: '#f23645',
  lineColor: '#2962ff',
  areaTopColor: 'rgba(41, 98, 255, 0.28)',
  areaBottomColor: 'rgba(41, 98, 255, 0)',
  histogramColor: 'rgba(8, 153, 129, 0.5)',
  baselineTopLineColor: '#089981',
  baselineTopFillColor: 'rgba(8, 153, 129, 0.2)',
  baselineBottomLineColor: '#f23645',
  baselineBottomFillColor: 'rgba(242, 54, 69, 0.2)',
};

export const builtInThemes = { dark: darkTheme, light: lightTheme } as const;
export type BuiltInThemeName = keyof typeof builtInThemes;

/** Either a built-in theme name or a complete custom theme object. */
export type ThemeInput = BuiltInThemeName | ChartTheme;

export function resolveTheme(theme: ThemeInput): ChartTheme {
  if (typeof theme === 'string') {
    const found = builtInThemes[theme];
    if (!found) throw new Error(`[market-chart] unknown theme "${String(theme)}"`);
    return found;
  }
  return theme;
}

/** Creates a custom theme from a base theme plus overrides. */
export function createTheme(
  base: ThemeInput,
  overrides: Partial<ChartTheme> & { name: string },
): ChartTheme {
  return { ...resolveTheme(base), ...overrides };
}
