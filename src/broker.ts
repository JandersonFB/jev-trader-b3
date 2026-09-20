import { config } from "./config";

export interface Book {
  tick: number;
  bid: number;
  ask: number;
  mid: number;
  spreadBps: number;
  /** (bidDepth - askDepth) / (bidDepth + askDepth) perto do mid. -1..1 */
  imbalance: number;
  /** Top 5 níveis por lado, melhor primeiro: [preço, ações]. */
  levels: { bids: [number, number][]; asks: [number, number][] };
  /** Profundidade acumulada (ações) dentro de N bps do mid, por lado. */
  depthBps: { [band: string]: { bid: number; ask: number } };
}

export type Side = "buy" | "sell";

/**
 * A ordem deste tick: uma ordem limite simulada no livro sintético, substituindo a anterior.
 * `sim` enquanto descansa; vira fill quando um print cruza o preço dela.
 */
export interface Quote {
  side: Side;
  price: number; // BRL por ação, alinhado ao tick de R$ 0,01
  size: number; // ações
  status: "sim";
  orderId: number;
  /** O cap de posição (ou o caixa) escolheu este lado; as probabilidades continuam mostrando a decisão do modelo. */
  capped: boolean;
}

/** Um print cruzou uma ordem nossa que descansava no livro simulado. */
export interface Fill {
  side: Side;
  size: number; // ações
  price: number; // BRL: o preço da nossa ordem
  orderId: number;
  feeBrl: number; // custo simulado da execução
}

/**
 * Corretora simulada em BRL. Mantém caixa e ações, precifica a ordem do tick
 * (`QUOTE_INSIDE_TICKS` ticks dentro do touch, sem cruzar) e contabiliza fills.
 * Nada sai da máquina: quando o usuário ligar um broker real, esta classe é o ponto de troca.
 */
export class PaperBroker {
  /** Caixa e custódia simulados. `shares` pode ficar negativo (venda a descoberto até o cap). */
  balance = { brl: config.bankrollBrl, shares: 0 };
  private seq = 0;

  /** Preço da ordem: `insideTicks` ticks dentro do touch, alinhado a R$ 0,01, nunca cruzando. */
  quotePrice(side: Side, book: Book, insideTicks: number): number {
    const tick = config.tickSize;
    const round = (p: number) => Math.round(p / tick) * tick;
    let p = round(side === "buy" ? book.bid + insideTicks * tick : book.ask - insideTicks * tick);
    if (side === "buy" && p >= book.ask) p = round(book.bid);
    if (side === "sell" && p <= book.bid) p = round(book.ask);
    return Math.round(p * 100) / 100;
  }

  /** "Posta" a ordem simulada do tick: só registra a intenção; o fill vem dos prints seguintes. */
  send(side: Side, size: number, book: Book, insideTicks: number, capped: boolean): Quote {
    return { side, price: this.quotePrice(side, book, insideTicks), size, status: "sim", orderId: ++this.seq, capped };
  }

  feeBrl(size: number, price: number): number {
    return (size * price * config.simFeesBps) / 10_000;
  }

  /** Aplica um fill no caixa e na custódia. Compra debita caixa + taxa; venda credita menos taxa. */
  applyFill(f: Fill) {
    const notional = f.size * f.price;
    if (f.side === "buy") {
      this.balance.brl -= notional + f.feeBrl;
      this.balance.shares += f.size;
    } else {
      this.balance.brl += notional - f.feeBrl;
      this.balance.shares -= f.size;
    }
  }
}
