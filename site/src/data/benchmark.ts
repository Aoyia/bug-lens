export interface PerfKpiSpec {
  id: "kpi1" | "kpi2" | "kpi3" | "kpi4";
  initialText: string;
  countTo: string;
  decimals: string;
  prefix?: string;
  suffix: string;
  sub: string;
}

export interface PerfBarMetricSpec {
  id: "m1" | "m2" | "m3" | "m4";
  rustPct: string;
  rustVal: string;
  jsPct: string;
  jsVal: string;
}

export interface PerfStepSliceSpec {
  id: "open" | "timeline" | "net";
  cmd: string;
  size: string;
}

export const PERF_KPIS: PerfKpiSpec[] = [
  {
    id: "kpi1",
    initialText: "4.2×",
    countTo: "4.2",
    decimals: "1",
    suffix: "×",
    sub: "13.5 ms vs 57.2 ms",
  },
  {
    id: "kpi2",
    initialText: "3.4×",
    countTo: "3.4",
    decimals: "1",
    suffix: "×",
    sub: "15.8 ms vs 54.2 ms",
  },
  {
    id: "kpi3",
    initialText: "-74%",
    countTo: "74",
    decimals: "0",
    prefix: "-",
    suffix: "%",
    sub: "20.6 MB vs 79.3 MB",
  },
  {
    id: "kpi4",
    initialText: "-99.6%",
    countTo: "99.6",
    decimals: "1",
    prefix: "-",
    suffix: "%",
    sub: "6.20 MB ➔ 24.5 KB",
  },
];

export const PERF_BAR_METRICS: PerfBarMetricSpec[] = [
  {
    id: "m1",
    rustPct: "30.1%",
    rustVal: "56.3 MB",
    jsPct: "100%",
    jsVal: "186.8 MB",
  },
  {
    id: "m2",
    rustPct: "23.6%",
    rustVal: "13.5 ms",
    jsPct: "100%",
    jsVal: "57.2 ms",
  },
  {
    id: "m3",
    rustPct: "29.2%",
    rustVal: "15.8 ms",
    jsPct: "100%",
    jsVal: "54.2 ms",
  },
  {
    id: "m4",
    rustPct: "26%",
    rustVal: "20.6 MB",
    jsPct: "100%",
    jsVal: "79.3 MB",
  },
];

export const PERF_RING_GAUGE = {
  countTo: "99.6",
  decimals: "1",
  suffix: "%",
  initialText: "99.6%",
  dashArray: "402.12",
  dashOffset: "1.61",
} as const;

export const PERF_STEP_SLICES: PerfStepSliceSpec[] = [
  { id: "open", cmd: "open_pack", size: "5.6 KB" },
  { id: "timeline", cmd: "timeline", size: "8.7 KB" },
  { id: "net", cmd: "query_network", size: "10.2 KB" },
];
