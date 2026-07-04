// The metric layer: which FRED series we ingest, and which dashboard
// metrics we derive from them. Adding a metric is a config change here —
// the ingest job and dashboard pick it up automatically.

export type SeriesDef = {
  code: string; // FRED series id, or Stooq symbol (e.g. "VTI.US")
  name: string;
  units: string;
  frequency: "m" | "q"; // frequency as stored (after FRED-side aggregation)
  aggregateMonthly?: boolean; // average daily/weekly data to monthly at the API
  source?: "fred" | "stooq"; // default fred
};

export type MetricTransform =
  | { type: "direct"; series: string }
  | { type: "yoy"; series: string } // % change vs same date one year earlier
  | { type: "ratio"; num: string; den: string; scale: number };

export type MetricDef = {
  key: string;
  name: string;
  panel: "dalio" | "buffett";
  unit: string; // display suffix: "%", "pp", ""
  decimals: number;
  describe: string;
  transform: MetricTransform;
};

export const SERIES: SeriesDef[] = [
  // — Dalio panel inputs (debt cycle, liquidity, regime) —
  { code: "GFDEGDQ188S", name: "Federal debt to GDP", units: "%", frequency: "q" },
  { code: "TDSP", name: "Household debt service ratio", units: "%", frequency: "q" },
  { code: "T10Y3M", name: "10y minus 3m Treasury spread", units: "pp", frequency: "m", aggregateMonthly: true },
  { code: "DFII10", name: "10y real yield (TIPS)", units: "%", frequency: "m", aggregateMonthly: true },
  { code: "WALCL", name: "Fed balance sheet", units: "$M", frequency: "m", aggregateMonthly: true },
  { code: "M2SL", name: "M2 money supply", units: "$B", frequency: "m" },
  { code: "CPIAUCSL", name: "CPI (all urban)", units: "index", frequency: "m" },
  { code: "PCEPILFE", name: "Core PCE price index", units: "index", frequency: "m" },
  { code: "BAMLH0A0HYM2", name: "High-yield credit spread", units: "pp", frequency: "m", aggregateMonthly: true },
  { code: "DTWEXBGS", name: "Trade-weighted dollar index", units: "index", frequency: "m", aggregateMonthly: true },
  { code: "UNRATE", name: "Unemployment rate", units: "%", frequency: "m" },
  { code: "SAHMREALTIME", name: "Sahm rule recession indicator", units: "pp", frequency: "m" },
  { code: "FEDFUNDS", name: "Effective fed funds rate", units: "%", frequency: "m" },
  // — Buffett panel inputs (valuation) —
  { code: "NCBEILQ027S", name: "Corporate equities; liability (Z.1)", units: "$M", frequency: "q" },
  { code: "GDP", name: "Nominal GDP", units: "$B", frequency: "q" },
  { code: "CP", name: "Corporate profits after tax", units: "$B", frequency: "q" },
  { code: "DGS10", name: "10y Treasury yield", units: "%", frequency: "m", aggregateMonthly: true },
  { code: "MORTGAGE30US", name: "30y fixed mortgage rate", units: "%", frequency: "m", aggregateMonthly: true },
  { code: "CSUSHPINSA", name: "Case-Shiller national home price index", units: "index", frequency: "m" },
  { code: "UMCSENT", name: "Consumer sentiment (U. Michigan)", units: "index", frequency: "m" },
  // — Regime-engine inputs (growth + inflation direction) —
  { code: "INDPRO", name: "Industrial production index", units: "index", frequency: "m" },
  { code: "PAYEMS", name: "Nonfarm payrolls", units: "thousands", frequency: "m" },
  { code: "T10YIE", name: "10y breakeven inflation", units: "%", frequency: "m", aggregateMonthly: true },
  // Ingested now, used in phase 2 for recession shading on charts.
  { code: "USREC", name: "NBER recession indicator", units: "0/1", frequency: "m" },
  // — Portfolio universe: monthly ETF closes from Stooq (no key needed).
  // Not shown as dashboard cards; used for tracking the model portfolio
  // and, later, covariance-based risk parity.
  { code: "VTI.US", name: "Vanguard Total Stock Market ETF", units: "$", frequency: "m", source: "stooq" },
  { code: "TLT.US", name: "iShares 20+ Year Treasury ETF", units: "$", frequency: "m", source: "stooq" },
  { code: "IEF.US", name: "iShares 7-10 Year Treasury ETF", units: "$", frequency: "m", source: "stooq" },
  { code: "SCHP.US", name: "Schwab US TIPS ETF", units: "$", frequency: "m", source: "stooq" },
  { code: "GLD.US", name: "SPDR Gold Shares", units: "$", frequency: "m", source: "stooq" },
  { code: "PDBC.US", name: "Invesco Commodity Strategy ETF", units: "$", frequency: "m", source: "stooq" },
  { code: "BIL.US", name: "SPDR 1-3 Month T-Bill ETF", units: "$", frequency: "m", source: "stooq" },
];

export const METRICS: MetricDef[] = [
  // — Dalio: where are we in the debt cycle, and what regime is this —
  {
    key: "federal_debt_gdp", name: "Federal debt / GDP", panel: "dalio",
    unit: "%", decimals: 0,
    describe: "Long-term debt cycle: government leverage relative to income",
    transform: { type: "direct", series: "GFDEGDQ188S" },
  },
  {
    key: "household_debt_service", name: "Household debt service", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "Share of disposable income going to debt payments",
    transform: { type: "direct", series: "TDSP" },
  },
  {
    key: "yield_curve", name: "Yield curve (10y−3m)", panel: "dalio",
    unit: "pp", decimals: 2,
    describe: "Inversion has preceded every US recession since the 1960s",
    transform: { type: "direct", series: "T10Y3M" },
  },
  {
    key: "real_10y", name: "Real 10y yield", panel: "dalio",
    unit: "%", decimals: 2,
    describe: "TIPS yield: the real price of money",
    transform: { type: "direct", series: "DFII10" },
  },
  {
    key: "fed_bs_yoy", name: "Fed balance sheet YoY", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "Central bank liquidity: QE expands, QT contracts",
    transform: { type: "yoy", series: "WALCL" },
  },
  {
    key: "m2_yoy", name: "M2 growth YoY", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "Broad money supply growth",
    transform: { type: "yoy", series: "M2SL" },
  },
  {
    key: "cpi_yoy", name: "CPI inflation YoY", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "Headline consumer price inflation",
    transform: { type: "yoy", series: "CPIAUCSL" },
  },
  {
    key: "core_pce_yoy", name: "Core PCE YoY", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "The Fed's preferred inflation gauge",
    transform: { type: "yoy", series: "PCEPILFE" },
  },
  {
    key: "hy_spread", name: "High-yield spread", panel: "dalio",
    unit: "pp", decimals: 2,
    describe: "Credit stress: junk bond yields over Treasuries",
    transform: { type: "direct", series: "BAMLH0A0HYM2" },
  },
  {
    key: "dollar_index", name: "Dollar index", panel: "dalio",
    unit: "", decimals: 1,
    describe: "Trade-weighted dollar vs major currencies",
    transform: { type: "direct", series: "DTWEXBGS" },
  },
  {
    key: "unemployment", name: "Unemployment", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "U-3 unemployment rate",
    transform: { type: "direct", series: "UNRATE" },
  },
  {
    key: "sahm_rule", name: "Sahm rule", panel: "dalio",
    unit: "pp", decimals: 2,
    describe: "Recession signal: fires when it crosses 0.50",
    transform: { type: "direct", series: "SAHMREALTIME" },
  },
  {
    key: "fed_funds", name: "Fed funds rate", panel: "dalio",
    unit: "%", decimals: 2,
    describe: "The short-term policy rate",
    transform: { type: "direct", series: "FEDFUNDS" },
  },
  {
    key: "indpro_yoy", name: "Industrial production YoY", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "Real-economy growth pulse",
    transform: { type: "yoy", series: "INDPRO" },
  },
  {
    key: "payems_yoy", name: "Payrolls YoY", panel: "dalio",
    unit: "%", decimals: 1,
    describe: "Employment growth",
    transform: { type: "yoy", series: "PAYEMS" },
  },
  {
    key: "breakeven_10y", name: "10y inflation breakeven", panel: "dalio",
    unit: "%", decimals: 2,
    describe: "The bond market's own inflation forecast",
    transform: { type: "direct", series: "T10YIE" },
  },
  // — Buffett: what you pay vs what you get —
  {
    key: "buffett_indicator", name: "Buffett indicator", panel: "buffett",
    unit: "%", decimals: 0,
    describe: "US corporate equity value as a share of GDP (Z.1 based)",
    // NCBEILQ027S is $M, GDP is $B: (num/1000)/den × 100 = num/den × 0.1
    transform: { type: "ratio", num: "NCBEILQ027S", den: "GDP", scale: 0.1 },
  },
  {
    key: "profit_margins", name: "Corporate profits / GDP", panel: "buffett",
    unit: "%", decimals: 1,
    describe: "Economy-wide profit margins — historically mean-reverting",
    transform: { type: "ratio", num: "CP", den: "GDP", scale: 100 },
  },
  {
    key: "treasury_10y", name: "10y Treasury yield", panel: "buffett",
    unit: "%", decimals: 2,
    describe: "Interest rates act on valuations like gravity",
    transform: { type: "direct", series: "DGS10" },
  },
  {
    key: "mortgage_30y", name: "30y mortgage rate", panel: "buffett",
    unit: "%", decimals: 2,
    describe: "Housing affordability input",
    transform: { type: "direct", series: "MORTGAGE30US" },
  },
  {
    key: "home_prices_yoy", name: "Home prices YoY", panel: "buffett",
    unit: "%", decimals: 1,
    describe: "Case-Shiller national index, year over year",
    transform: { type: "yoy", series: "CSUSHPINSA" },
  },
  {
    key: "consumer_sentiment", name: "Consumer sentiment", panel: "buffett",
    unit: "", decimals: 1,
    describe: "University of Michigan survey",
    transform: { type: "direct", series: "UMCSENT" },
  },
];

export const PANELS = [
  { id: "dalio" as const, title: "Debt cycle & regime", subtitle: "the Dalio panel" },
  { id: "buffett" as const, title: "Valuation & rates", subtitle: "the Buffett panel" },
];
