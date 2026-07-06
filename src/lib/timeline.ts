// Shared timeline types and date helpers, safe for both server and client.
// Timeline points are [monthIndex, value] pairs: monthIndex = year*12 + month
// keeps the payload compact and makes x-axis math trivial.

import type { QuadrantKey } from "@/lib/portfolio";

export type TimelinePoint = [number, number];

export type TimelineSeries = {
  key: string;
  name: string;
  panel: "dalio" | "buffett";
  unit: string;
  decimals: number;
  points: TimelinePoint[];
};

export type TimelineData = {
  metrics: TimelineSeries[];
  regimes: { key: QuadrantKey; name: string; points: TimelinePoint[] }[];
  recessions: [number, number][]; // inclusive [startIdx, endIdx] month spans
};

export const monthIdxFromDate = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

export const yearOfIdx = (idx: number) => Math.floor(idx / 12);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function labelOfIdx(idx: number): string {
  return `${MONTHS[idx % 12]} ${yearOfIdx(idx)}`;
}
