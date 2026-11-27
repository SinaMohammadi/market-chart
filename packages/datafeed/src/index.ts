/**
 * `@market-chart/datafeed` — datafeed contract, adapters and chart binding.
 */
export type { Candle, CandleUpdate, Datafeed, SymbolInfo, Timeframe, TimeRange } from './types.js';
export { DatafeedError } from './types.js';
export { alignTime, isMultipleOf, nextBarTime, parseTimeframe, rangeForBars } from './timeframe.js';
export type { ParsedTimeframe, TimeframeUnit } from './timeframe.js';
export {
  CandleAggregator,
  MAX_CANDLE_TIME,
  MAX_CANDLE_VALUE,
  fillMissingCandles,
  mergeCandles,
  normalizeCandles,
  resampleCandles,
  toTimestamp,
} from './candles.js';
export type { NormalizeResult } from './candles.js';
export {
  DEFAULT_IMPORT_MAX_BYTES,
  DEFAULT_IMPORT_MAX_ROWS,
  parseCandleFile,
  parseCsv,
  parseJsonCandles,
} from './parse.js';
export type { CsvOptions, ImportLimits } from './parse.js';
export {
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  composeDatafeed,
  createRestDatafeed,
  createSseDatafeed,
  createStaticDatafeed,
  createWebSocketDatafeed,
  defaultTimers,
} from './adapters.js';
export type {
  ConnectionStatus,
  EventSourceLike,
  HistoryRequest,
  RestDatafeedOptions,
  SocketLike,
  SseDatafeedOptions,
  StaticDatafeed,
  StaticSymbolData,
  Timers,
  WebSocketDatafeed,
  WebSocketDatafeedOptions,
} from './adapters.js';
export { DatafeedController, connectDatafeed, sanitizeSymbolInfo } from './controller.js';
/** Safe URL building and log-safe URLs (re-exported from the core package). */
export { buildUrl, redactUrl } from '@market-chart/core';
export type { UrlParamValue } from '@market-chart/core';
export type {
  DatafeedControllerEvents,
  DatafeedControllerOptions,
  DatafeedStatus,
} from './controller.js';
export { createSyntheticDatafeed } from './synthetic.js';
export type { SyntheticDatafeed, SyntheticDatafeedOptions, SyntheticSymbol } from './synthetic.js';
export { attachDatafeed, datafeedSource } from './source.js';
export type { DatafeedAttachment, DatafeedSeriesOptions, DatafeedState } from './source.js';
