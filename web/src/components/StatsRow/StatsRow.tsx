"use client";

import { useEffect, useState } from "react";
import type { Meta, TickEvent } from "@/lib/types";
import { fmtBrl, fmtInt, fmtSignedBrl, uptime } from "@/lib/format";
import styles from "./StatsRow.module.css";

const DASH = "-";

export default function StatsRow({
  latest,
  avgLatencyMs,
  meta,
}: {
  latest: TickEvent | null;
  avgLatencyMs: number;
  meta: Meta | null;
}) {
  const startedAt = meta?.startedAt ?? null;
  // Ticks once a second; starts on the client so SSR and hydration agree.
  const [up, setUp] = useState<string | null>(null);

  useEffect(() => {
    if (startedAt == null) {
      setUp(null);
      return;
    }
    const tick = () => setUp(uptime(startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const decision = latest?.decision ?? null;
  const last = decision && !decision.late ? `${decision.latencyMs} ms` : `${DASH} ms`;
  const avg = Number.isFinite(avgLatencyMs) && avgLatencyMs > 0 ? `${Math.round(avgLatencyMs)}ms` : DASH;
  const totals = latest?.totals ?? null;
  const pnl = totals?.pnlBrl ?? 0;

  return (
    <div className={styles.stats}>
      <span>última {last}</span>
      <span>média {avg}</span>
      <span className={styles.nowrap}>{totals ? fmtInt(totals.decisions) : DASH} decisões</span>
      <span className={styles.nowrap}>{totals ? fmtInt(totals.fills) : DASH} execuções</span>
      <span className={styles.nowrap} title="custos simulados">custos {totals ? fmtBrl(totals.feesBrl) : DASH}</span>
      <span className={styles.nowrap} style={{ color: pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)" }}>
        p&amp;l {totals ? fmtSignedBrl(totals.pnlBrl) : DASH}
      </span>
      <span className={styles.spacer} />
      <span>uptime {up ?? "00:00:00"}</span>
    </div>
  );
}
