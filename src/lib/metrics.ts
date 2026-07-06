// The metric layer: which FRED series we ingest, and which dashboard
// metrics we derive from them. Adding a metric is a config change here —
// the ingest job and dashboard pick it up automatically.

export type SeriesDef = {
  code: string; // FRED series id, or ticker symbol (e.g. "VTI")
  name: string;
  units: string;
  frequency: "m" | "q"; // frequency as stored (after FRED-side aggregation)
  aggregateMonthly?: boolean; // average daily/weekly data to monthly at the API
  source?: "fred" | "yahoo" | "multpl"; // default fred
};

export type MetricTransform =
  | { type: "direct"; series: string }
  | { type: "yoy"; series: string } // % change vs same date one year earlier
  | { type: "ratio"; num: string; den: string; scale: number }
  | { type: "invert"; series: string; scale: number } // scale / value
  | { type: "inv_spread"; num: string; den: string; scale: number }; // (scale/num) − den

export type MetricDef = {
  key: string;
  name: string;
  // "internal" metrics are computed and stored like the rest but never
  // rendered as dashboard cards (e.g. recession dates for chart shading).
  panel: "dalio" | "buffett" | "internal";
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
  // Shiller CAPE from multpl.com (keyless; Shiller's own file is only served
  // as stale mirrors). Monthly, back to 1871.
  { code: "SHILLER_CAPE", name: "Shiller CAPE ratio", units: "ratio", frequency: "m", source: "multpl" },
  // — Regime-engine inputs (growth + inflation direction) —
  { code: "INDPRO", name: "Industrial production index", units: "index", frequency: "m" },
  { code: "PAYEMS", name: "Nonfarm payrolls", units: "thousands", frequency: "m" },
  { code: "T10YIE", name: "10y breakeven inflation", units: "%", frequency: "m", aggregateMonthly: true },
  // Ingested now, used in phase 2 for recession shading on charts.
  { code: "USREC", name: "NBER recession indicator", units: "0/1", frequency: "m" },
  // — Portfolio universe: monthly adjusted ETF closes from Yahoo Finance's
  // public chart API (no key needed). Not shown as dashboard cards; used
  // for tracking the model portfolio and, later, covariance-based risk parity.
  { code: "VTI", name: "Vanguard Total Stock Market ETF", units: "$", frequency: "m", source: "yahoo" },
  { code: "TLT", name: "iShares 20+ Year Treasury ETF", units: "$", frequency: "m", source: "yahoo" },
  { code: "IEF", name: "iShares 7-10 Year Treasury ETF", units: "$", frequency: "m", source: "yahoo" },
  { code: "SCHP", name: "Schwab US TIPS ETF", units: "$", frequency: "m", source: "yahoo" },
  { code: "GLD", name: "SPDR Gold Shares", units: "$", frequency: "m", source: "yahoo" },
  { code: "PDBC", name: "Invesco Commodity Strategy ETF", units: "$", frequency: "m", source: "yahoo" },
  { code: "BIL", name: "SPDR 1-3 Month T-Bill ETF", units: "$", frequency: "m", source: "yahoo" },
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
  {
    key: "cape", name: "Shiller CAPE", panel: "buffett",
    unit: "", decimals: 1,
    describe: "Price / 10-year average real earnings",
    transform: { type: "direct", series: "SHILLER_CAPE" },
  },
  {
    key: "excess_cape_yield", name: "Earnings yield − 10y", panel: "buffett",
    unit: "pp", decimals: 2,
    describe: "CAPE earnings yield minus the 10y Treasury (equity risk premium)",
    // (100 / CAPE) − 10y Treasury yield. Both series are month-start dated.
    transform: { type: "inv_spread", num: "SHILLER_CAPE", den: "DGS10", scale: 100 },
  },
  // — Internal: NBER recession months, used for chart shading —
  {
    key: "usrec", name: "NBER recession indicator", panel: "internal",
    unit: "", decimals: 0,
    describe: "1 during NBER-dated recessions",
    transform: { type: "direct", series: "USREC" },
  },
];

// Plain-English explainer shown under the master timeline: what the metric
// means and what low vs high readings imply. Keyed by metric key; the
// timeline falls back to `describe` if a key is missing.
export const EXPLAINERS: Record<string, string> = {
  federal_debt_gdp:
    "Federal debt / GDP measures how much the government owes relative to the size of the economy. When it's low, the state has room to borrow and spend to support growth; when it's high and rising, it raises the risk of higher taxes, inflationary money-printing, or restructuring — the late stage of Dalio's long-term debt cycle.",
  household_debt_service:
    "Household debt service is the share of after-tax income households spend servicing debt. Low readings mean consumers have room to borrow and spend, supporting growth; high readings leave households fragile, so a rate rise or job loss forces cutbacks that can tip the economy toward recession.",
  yield_curve:
    "The yield curve here is the gap between 10-year and 3-month Treasury yields. A wide positive gap is normal and signals expected growth; when it inverts (goes negative), markets are pricing rate cuts ahead — a signal that has preceded every US recession since the 1960s.",
  real_10y:
    "The real 10-year yield is the long-term Treasury rate after subtracting expected inflation — the true cost of money. Low or negative real yields are stimulative and push investors into risk assets; high real yields tighten conditions and weigh on stock and housing valuations.",
  fed_bs_yoy:
    "This is the year-over-year change in the Fed's asset holdings — how fast it's adding or draining liquidity. Expansion (quantitative easing) floods the system with cash and lifts asset prices; contraction (tightening) pulls cash out and pressures markets.",
  m2_yoy:
    "M2 growth is the annual change in the broad money supply. Rapid growth fuels spending and, with a lag, inflation; unusually slow or falling M2 signals shrinking liquidity and weakening demand.",
  cpi_yoy:
    "CPI inflation is the annual rate at which consumer prices rise. Low, stable inflation near 2% supports steady growth; high inflation erodes purchasing power and forces the Fed to raise rates, while negative readings (deflation) signal collapsing demand.",
  core_pce_yoy:
    "Core PCE is the Fed's preferred inflation gauge, excluding volatile food and energy. It drives interest-rate policy: readings above the 2% target push the Fed toward hikes, while readings well below it open the door to rate cuts.",
  hy_spread:
    "The high-yield spread is the extra yield investors demand to hold risky 'junk' bonds over safe Treasuries. Narrow spreads signal confidence and easy credit; a sharp widening is an early warning of credit stress that often front-runs recessions and market sell-offs.",
  dollar_index:
    "The dollar index tracks the US dollar's value against a basket of major currencies. A strong dollar lowers import prices (disinflationary) but hurts US exporters and strains dollar-indebted economies abroad; a weak dollar does the reverse.",
  unemployment:
    "The unemployment rate is the share of the labor force out of work but looking. Low unemployment signals a hot economy and potential wage-driven inflation; a rising rate signals slack and is one of the clearest markers of recession.",
  sahm_rule:
    "The Sahm rule is a real-time recession gauge based on how fast unemployment is climbing off its recent low. It has historically confirmed a recession is already underway once it crosses 0.50, making it one of the most reliable 'we're in it' signals.",
  fed_funds:
    "The fed funds rate is the Fed's short-term policy rate, the anchor for borrowing costs across the economy. Rising rates cool activity and inflation but risk over-tightening into recession; falling rates stimulate but can overheat.",
  indpro_yoy:
    "Industrial production growth tracks the annual change in factory, mining, and utility output — a direct read on the real economy. Positive growth signals expansion; contraction is a hallmark of recession, since manufacturing is highly cyclical.",
  payems_yoy:
    "Payrolls growth is the annual change in the number of nonfarm jobs. Steady growth underpins consumer spending and expansion; when it stalls or turns negative, it confirms the labor market is deteriorating and recession risk is elevated.",
  breakeven_10y:
    "The 10-year breakeven is the bond market's own forecast of average inflation over the next decade, read from the gap between nominal and inflation-protected yields. Rising breakevens mean markets expect more inflation; falling ones signal deflationary fear.",
  buffett_indicator:
    "The Buffett indicator is the total value of US stocks divided by GDP — Buffett's favorite gauge of whether the market is expensive. Low readings suggest stocks are cheap relative to the economy and offer strong long-run returns; high readings warn that valuations are stretched and future returns are likely muted.",
  profit_margins:
    "Corporate profits as a share of GDP measures economy-wide profit margins. Buffett called this one of the most reliably mean-reverting series in economics: unusually high margins tend to get competed away, while depressed margins tend to recover.",
  treasury_10y:
    "The 10-year Treasury yield is the benchmark long-term interest rate. Buffett describes rates as gravity for asset prices — low yields justify higher valuations across stocks and property, while high yields drag them down by offering a competitive risk-free return.",
  mortgage_30y:
    "The 30-year mortgage rate is the typical cost of a home loan. Low rates boost affordability and fuel housing demand and prices; high rates price out buyers, cool the market, and ripple through construction and consumer spending.",
  home_prices_yoy:
    "Home price growth is the annual change in national house prices. Steady appreciation builds household wealth and supports spending; rapid surges can signal a bubble, while outright declines — as in 2008 — can trigger broad financial stress.",
  consumer_sentiment:
    "Consumer sentiment surveys how optimistic households feel about their finances and the economy. High sentiment supports spending and growth; sharp drops often precede pullbacks in consumption, though at extremes it can be a contrarian bottoming signal.",
  cape:
    "The Shiller CAPE is the S&P 500 price divided by its inflation-adjusted average earnings over the past 10 years, which smooths out the business cycle. Low readings have historically signalled cheap stocks and strong long-run returns; high readings (above ~30) mark expensive markets and tend to precede weaker decade-ahead returns.",
  excess_cape_yield:
    "This is the CAPE earnings yield (the inverse of CAPE) minus the 10-year Treasury yield — how much extra stocks yield over bonds, a version of the 'Fed model' equity risk premium. A wide positive gap means stocks are cheap relative to bonds and favours equities; a negative gap (as in the late 1990s and again recently) means bonds offer competitive returns and stocks are richly priced.",
};

export const PANELS = [
  { id: "dalio" as const, title: "Debt cycle & regime", subtitle: "the Dalio panel" },
  { id: "buffett" as const, title: "Valuation & rates", subtitle: "the Buffett panel" },
];
