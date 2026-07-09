// Global debt-cycle panel config: which economies and which BIS series make
// up the cross-country heatmap. All from the BIS SDMX API (keyless).
// Global metric points are stored under keys "global:<metric>:<country>".

export const GLOBAL_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "XM", name: "Euro area" },
  { code: "CN", name: "China" },
  { code: "JP", name: "Japan" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
] as const;

export type GlobalMetricDef = {
  key: string;
  name: string;
  unit: string; // "%", "pp", ""
  decimals: number;
  describe: string;
  dataflow: string; // BIS SDMX dataflow id
  // Server-side SDMX key filtering the dataflow's dimensions to one series
  // per country (dots = "all" for that dimension).
  queryKey: string;
};

export const GLOBAL_METRICS: GlobalMetricDef[] = [
  {
    key: "credit_gap", name: "Credit/GDP gap", unit: "pp", decimals: 1,
    describe: "Private credit/GDP minus its long-run trend (the Basel gap). High = a late-cycle credit buildup that has often preceded financial stress.",
    dataflow: "WS_CREDIT_GAP", queryKey: "Q..P.A.C",
  },
  {
    key: "credit_ratio", name: "Credit/GDP", unit: "%", decimals: 0,
    describe: "Total credit to the private non-financial sector as a share of GDP — the level of private leverage.",
    dataflow: "WS_CREDIT_GAP", queryKey: "Q..P.A.A",
  },
  {
    key: "debt_service", name: "Debt service", unit: "%", decimals: 1,
    describe: "Share of income the private non-financial sector spends servicing debt. High readings leave borrowers fragile to rate rises or income shocks.",
    dataflow: "WS_DSR", queryKey: "Q..P",
  },
  {
    key: "policy_rate", name: "Policy rate", unit: "%", decimals: 2,
    describe: "The central bank's main policy rate — how tight monetary policy is on that economy's debt load.",
    dataflow: "WS_CBPOL", queryKey: "M.",
  },
];

export const GLOBAL_KEY_PREFIX = "global:";
export const globalKey = (metric: string, country: string) => `${GLOBAL_KEY_PREFIX}${metric}:${country}`;
