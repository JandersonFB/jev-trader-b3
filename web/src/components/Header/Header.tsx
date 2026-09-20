"use client";

import type { ConnectionState, Meta, TickEvent } from "@/lib/types";
import { fmtInt } from "@/lib/format";
import styles from "./Header.module.css";

export interface HeaderProps {
  meta: Meta | null;
  latest: TickEvent | null;
  connection: ConnectionState;
}

/** Only shown when we are NOT live. Live is the silent, default state. */
const OFFLINE_LABEL: Partial<Record<ConnectionState, string>> = {
  connecting: "conectando",
  reconnecting: "reconectando",
};

export default function Header({ meta, latest, connection }: HeaderProps) {
  const model = meta?.model ?? null;
  const isJev = (model ?? "").toLowerCase().startsWith("jev");
  const offline = OFFLINE_LABEL[connection] ?? null;
  const closed = latest ? !latest.marketOpen : false;

  return (
    <div className={styles.header}>
      <span className={styles.brand}>‖ Jev Trader B3</span>

      <span className={styles.block}>tick {latest ? fmtInt(latest.tick) : "-"}</span>

      <span className={styles.spacer} />

      {closed ? (
        <span
          className={styles.badge}
          style={{ background: "var(--badge-standin-bg)", color: "var(--badge-standin-fg)" }}
          title="Fora do pregão: preços simulados ancorados no último fechamento real"
        >
          pregão fechado
        </span>
      ) : null}

      {offline ? <span className={styles.offline}>{offline}</span> : null}

      {meta?.symbol ? <span className={styles.wallet}>{meta.symbol}</span> : null}

      <span
        className={styles.badge}
        style={{ background: "var(--badge-standin-bg)", color: "var(--badge-standin-fg)" }}
        title="Conta e ordens simuladas em BRL"
      >
        simulação
      </span>

      {model ? (
        <span
          className={styles.badge}
          style={{
            background: isJev ? "var(--badge-jev-bg)" : "var(--badge-standin-bg)",
            color: isJev ? "var(--badge-jev-fg)" : "var(--badge-standin-fg)",
          }}
        >
          {model}
        </span>
      ) : null}
    </div>
  );
}
