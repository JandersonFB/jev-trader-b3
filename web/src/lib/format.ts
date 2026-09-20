/** Formatting helpers. All are pure and SSR-safe. */

const INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const BRL2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRL4 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4, maximumFractionDigits: 4 });

function safe(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** 105416201 -> "105.416.201" */
export function fmtInt(n: number | null | undefined): string {
  return INT.format(Math.round(safe(n)));
}

/** 48.5 -> "48,50" (tick da B3: R$ 0,01) */
export function fmtPrice(n: number | null | undefined): string {
  return safe(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 1234.56 -> "R$ 1.234,56"; negatives handled by Intl */
export function fmtBrl(n: number | null | undefined, d = 2): string {
  return (d === 4 ? BRL4 : BRL2).format(safe(n));
}

/** -12.34 -> "-R$ 12,34" com sinal explícito: "+R$ 12,34" */
export function fmtSignedBrl(n: number | null | undefined, d = 2): string {
  const v = safe(n);
  return `${v >= 0 ? "+" : "-"}${(d === 4 ? BRL4 : BRL2).format(Math.abs(v))}`;
}

/** 0.62 -> "62%" */
export function fmtPct(p: number | null | undefined): string {
  return `${Math.round(safe(p) * 100)}%`;
}

/** 0.62 -> "0,62" (confiança com duas casas) */
export function fmtConf(p: number | null | undefined): string {
  return safe(p).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Signed number with a forced +/- sign: (0.003, 3) -> "+0,003" */
export function fmtSigned(n: number | null | undefined, d = 3): string {
  const v = safe(n);
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** 100 -> "100 ações" via plain int */
export function fmtShares(n: number | null | undefined): string {
  return INT.format(Math.round(safe(n)));
}

/** 107 -> "107 ms" */
export function fmtMs(n: number | null | undefined): string {
  return `${Math.round(safe(n))} ms`;
}

/** Accepts ms- or seconds-epoch. Elapsed since `startedAt` as "04:13:42". */
export function uptime(startedAt: number | null | undefined, now: number = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt)) return "00:00:00";
  const startMs = startedAt < 1e12 ? startedAt * 1000 : startedAt;
  return hhmmss(Math.max(0, now - startMs));
}

/** Milliseconds -> "hh:mm:ss" (hours are not capped at 24). */
export function hhmmss(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
