import { formatCompact } from "../chart-kit";

export function money(n: number | undefined, currency?: string | null): string {
  if (n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n);
}

export function num(n: number | undefined): string {
  return n === undefined ? "—" : formatCompact(n);
}

export function pct(n: number | undefined): string {
  return n === undefined ? "—" : `${n.toFixed(2)}%`;
}

export function roas(n: number | undefined): string {
  return n === undefined ? "—" : `${n.toFixed(2)}x`;
}
