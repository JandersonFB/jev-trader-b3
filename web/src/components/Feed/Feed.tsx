"use client";

import { useEffect, useRef, useState } from "react";
import type { TickEvent } from "@/lib/types";
import { fmtInt, fmtPrice } from "@/lib/format";
import styles from "./Feed.module.css";

/** Must match `.row { height }` in Feed.module.css. */
const ROW_H = 26;
/** Hard ceiling, so a very tall viewport does not render an absurd list. */
const MAX_ROWS = 40;

type Kind = "buy" | "sell" | "late";

function kindOf(event: TickEvent): Kind {
  const d = event.decision;
  if (!d || d.late) return "late";
  if (d.action === "buy") return "buy";
  if (d.action === "sell") return "sell";
  return "late";
}

function fmtSize(size: number): string {
  return size.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const KIND_CLASS: Record<Kind, string> = {
  buy: styles.kindBuy,
  sell: styles.kindSell,
  late: styles.kindLate,
};

const WORD: Record<Kind, string> = { buy: "COMPRA", sell: "VENDA", late: "ATRASO" };

/**
 * Uma linha por tick. A palavra é o lado que o modelo escolheu, o detalhe é a ordem que entrou no
 * livro simulado (compra ou venda no preço), e quando um print executou uma ordem nossa naquele
 * tick o detalhe vira a execução.
 */
export default function Feed({ events }: { events: TickEvent[] }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // How many whole 26px rows fit in the box the layout gives us. The list
  // itself clips, so a wrong guess is never a half-drawn row, only a hidden one.
  const [capacity, setCapacity] = useState(MAX_ROWS);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const measure = () => {
      const fits = Math.max(1, Math.min(MAX_ROWS, Math.floor(el.clientHeight / ROW_H)));
      setCapacity((prev) => (prev === fits ? prev : fits));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = events.slice(-capacity).reverse();

  return (
    <section className={styles.feed}>
      <div className={styles.label}>FITA</div>
      <div className={styles.list} ref={listRef}>
        {rows.length === 0 ? (
          <div className={styles.empty}>sem ticks ainda</div>
        ) : (
          rows.map((event, i) => {
            const kind = kindOf(event);
            const decision = event.decision;
            const quote = event.quote;
            const fill = event.fill;
            const decided = kind !== "late";
            const kindClass = KIND_CLASS[kind];

            const conf =
              !decided || !decision
                ? ""
                : "conf " +
                  Math.max(decision.probabilities.buy, decision.probabilities.sell, decision.probabilities.hold)
                    .toFixed(2);

            const lat = !decided || !decision ? "" : `${decision.latencyMs}ms`;

            let detail = "";
            if (fill && fill.size > 0) {
              detail = `EXEC ${fmtSize(fill.size)} @ ${fmtPrice(fill.price)}`;
            } else if (decided && quote) {
              const word = quote.side === "buy" ? "compra" : "venda";
              detail = `${word} ${fmtSize(quote.size)} @ ${fmtPrice(quote.price)}${quote.capped ? " cap" : ""}`;
            } else if (decided) {
              detail = "sem ordem";
            }

            const rowClass = [styles.row, kindClass, i === 0 ? styles.newest : "", fill ? styles.filled : ""]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={event.tick} className={rowClass}>
                <span className={`${styles.cell} ${styles.block}`}>{fmtInt(event.tick)}</span>
                <span className={`${styles.cell} ${styles.word}`}>{WORD[kind]}</span>
                <span className={`${styles.cell} ${styles.conf}`}>{conf}</span>
                <span className={`${styles.cell} ${styles.lat}`}>{lat}</span>
                <span className={`${styles.cell} ${styles.detail}`}>{detail}</span>
                <span className={`${styles.cell} ${styles.tx}`}>
                  {quote || fill ? <span className={styles.muted}>sim</span> : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
