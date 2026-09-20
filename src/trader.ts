import { appendFileSync, mkdirSync } from "node:fs";
import { config } from "./config";
import { synthBook } from "./book";
import { PaperBroker, type Book, type Fill, type Quote, type Side } from "./broker";
import type { Action, Decision, Model, TradeState } from "./model";
import type { QuoteFeed } from "./feed";

export interface TickEvent {
  tick: number;
  ts: number;
  marketOpen: boolean;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  decision: { action: Action; probabilities: Record<Action, number>; upIn10: number; latencyMs: number; late: boolean } | null;
  /** A ordem que este tick colocou no livro simulado. */
  quote: Quote | null;
  /** Fills agregados deste tick. */
  fill: Fill | null;
  /** Ações nossas descansando no livro depois deste tick. */
  resting: { bidShares: number; askShares: number };
  position: { side: "long" | "short" | "flat"; size: number; entryPrice: number | null; unrealizedBrl: number };
  totals: Totals;
}

/** Latência do tick: montagem do livro, e ler cotação + decidir + postar fim a fim. */
export interface Timing {
  readMs: number;
  loopMs: number;
}

export interface Totals {
  ticks: number;
  decisions: number;
  quotes: number;
  fills: number;
  lateTicks: number;
  jevUsd: number;
  feesBrl: number;
  realizedBrl: number;
  pnlBrl: number;
  pnlPct: number;
}

interface Resting {
  side: Side;
  price: number;
  size: number;
  tick: number;
}

/**
 * A cada tick: monta o livro sintético a partir da cotação, pergunta ao modelo compra ou venda e
 * "posta" uma ordem limite simulada naquele lado (`quoteInsideTicks` ticks dentro do touch),
 * substituindo a anterior. Um tick que chega enquanto o anterior ainda roda é emitido como `late`.
 *
 * Fills: a ordem descansa um tick; um print com preço atravessando o dela executa até o tamanho
 * do print — mesma regra do dry-run original, só que os prints vêm das mudanças de preço da B3.
 */
export class Trader {
  readonly history: TickEvent[] = [];
  private mids: number[] = [];
  private busy = false;
  private lastBook: Book | null = null;
  private orders = new Map<number, Resting>();
  private position = { shares: 0, costBrl: 0 }; // inventário assinado e seu custo médio
  private totals: Totals = { ticks: 0, decisions: 0, quotes: 0, fills: 0, lateTicks: 0, jevUsd: 0, feesBrl: 0, realizedBrl: 0, pnlBrl: 0, pnlPct: 0 };

  constructor(
    private broker: PaperBroker,
    private feed: QuoteFeed,
    private model: Model,
    private onEvent: (e: TickEvent, timing?: Timing) => void,
    private onFill: (tick: number, fill: Fill) => void = () => {},
  ) {
    mkdirSync("data", { recursive: true });
  }

  async onTick(tick: number) {
    this.totals.ticks++;
    if (this.busy) {
      this.totals.lateTicks++;
      if (this.lastBook) this.emit(tick, this.lastBook, null, null, true);
      return;
    }
    if (!this.feed.latest) return; // ainda não chegou nenhuma cotação
    this.busy = true;
    const t0 = performance.now();
    try {
      const momentum = this.momentumBps();
      const book = synthBook(tick, this.feed.latest, momentum);
      const readMs = performance.now() - t0;
      this.lastBook = book;
      this.mids.push(book.mid);
      if (this.mids.length > 400) this.mids.shift();
      const tickFill = this.harvest(tick); // prints desde o último tick executam ordens descansando

      const decision = await this.model.decide(this.buildState(tick, book));
      const wanted: Side = decision.action === "sell" ? "sell" : "buy";
      const other: Side = wanted === "buy" ? "sell" : "buy";
      // O cap de posição (ou o caixa) só pode escolher o lado que reduz exposição.
      const side: Side | null = this.allowed(wanted, book) ? wanted : this.allowed(other, book) ? other : null;
      this.totals.decisions++;
      this.totals.jevUsd += (decision.inputTokens / 1e6) * config.jevUsdPerMTok;

      let quote: Quote | null = null;
      if (side) {
        decision.action = side;
        quote = this.broker.send(side, config.tradeShares, book, config.quoteInsideTicks, side !== wanted);
        this.totals.quotes++;
        this.orders.clear(); // a ordem anterior é substituída
        this.orders.set(quote.orderId, { side, price: quote.price, size: quote.size, tick });
      }
      this.emit(tick, book, decision, quote, false, { readMs: Math.round(readMs), loopMs: Math.round(performance.now() - t0) }, tickFill);
      // o broadcast do fill sai depois do tick para o SSE chegar na ordem certa
      if (tickFill) this.onFill(tick, tickFill);
    } catch (e) {
      console.error(`tick ${tick}:`, (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** Retorno dos últimos `k` mids em bps (momentum que inclina o livro sintético). */
  private momentumBps(k = 10): number {
    const m = this.mids;
    const n = m.length;
    return n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0;
  }

  /**
   * Prints desde o último tick executam ordens descansando — uma ordem posta no tick N vale a
   * partir de N+1: print de venda no nosso bid (ou compra na nossa ask) executa até o tamanho
   * do print. Fills do tick em andamento são retornados para entrar direto no TickEvent emitido;
   * fills de prints de ticks passados (ex.: tick pulado por `late`) são anexados retroativamente.
   */
  private harvest(currentTick: number): Fill | null {
    const fills: (Fill & { tick: number })[] = [];
    for (const p of this.feed.drainPrints()) {
      for (const [id, o] of this.orders) {
        if (p.tick <= o.tick || o.size <= 0) continue;
        const hit = o.side === "buy" ? p.side === "sell" && p.price <= o.price : p.side === "buy" && p.price >= o.price;
        if (!hit) continue;
        const size = Math.min(o.size, p.size);
        o.size -= size;
        if (o.size <= 0) this.orders.delete(id);
        const fill: Fill = { side: o.side, size, price: o.price, orderId: id, feeBrl: this.broker.feeBrl(size, o.price) };
        this.broker.applyFill(fill);
        fills.push({ ...fill, tick: p.tick });
      }
    }
    if (!fills.length) return null;
    const byTick = new Map<number, Fill[]>();
    for (const f of fills) {
      this.applyFill(f);
      byTick.set(f.tick, [...(byTick.get(f.tick) ?? []), f]);
    }
    let current: Fill | null = null;
    for (const [t, fs] of byTick) {
      const fill = aggregate(fs);
      if (t === currentTick) {
        current = fill;
        continue;
      }
      const e = this.history.find((h) => h.tick === t);
      if (e) e.fill = fill;
      this.onFill(t, fill);
    }
    return current;
  }

  private restingShares(side: Side) {
    let s = 0;
    for (const o of this.orders.values()) if (o.side === side) s += o.size;
    return s;
  }

  /** A ordem, somada ao que já descansa do mesmo lado, fica dentro do cap e do caixa? */
  private allowed(side: Side, book: Book) {
    const size = config.tradeShares;
    const exposure =
      side === "buy" ? this.position.shares + this.restingShares("buy") + size : this.position.shares - this.restingShares("sell") - size;
    if (Math.abs(exposure) > config.maxPositionShares) return false;
    return side === "buy" ? this.broker.balance.brl >= size * book.ask : true;
  }

  private buildState(tick: number, book: Book): TradeState {
    const m = this.mids,
      n = m.length,
      H = config.horizonTicks;
    const ret = (k: number) => (n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0);
    const sampled = m.slice(-H).filter((_, i, a) => (a.length - 1 - i) % 2 === 0); // a cada 2 ticks, o mais novo incluso
    const lvl = (l: [number, number]) => `${l[0].toFixed(2)} x ${l[1]}`;
    const empty = { count: 0, buyShares: 0, sellShares: 0, cvdShares: 0, vwap: null, lastPrice: null, lastSide: null };
    const depth: TradeState["depth"] = {};
    for (const [k, v] of Object.entries(book.depthBps)) depth[k + "bps"] = { bid: v.bid, ask: v.ask };
    return {
      market: `${config.symbol}.B3`,
      tick,
      horizonTicks: H,
      tickMs: config.pollMs,
      marketOpen: this.feed.marketOpen(),
      mid: book.mid,
      spreadBps: round(book.spreadBps, 2),
      bookImbalance: round(book.imbalance, 3),
      depth,
      book: { bids: book.levels.bids.map(lvl), asks: book.levels.asks.map(lvl) },
      returnsBps: { last1: round(ret(1), 2), last5: round(ret(5), 2), last20: round(ret(20), 2), last100: round(ret(100), 2) },
      recentMids: sampled.map((x) => x.toFixed(2)).join(" "),
      trades: this.feed.summary(H),
      recentTrades: this.feed.recent(10).map((t) => `t${t.tick} ${t.side} ${t.size} @ ${t.price.toFixed(2)}`),
      allowed: { buy: this.allowed("buy", book), sell: this.allowed("sell", book) },
    };
  }

  private applyFill(f: Fill) {
    if (f.size <= 0) return;
    const signed = f.side === "buy" ? f.size : -f.size;
    const p = this.position;
    if (p.shares === 0 || Math.sign(p.shares) === Math.sign(signed)) {
      p.costBrl += signed * f.price; // aumentando a posição
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(p.shares)) * Math.sign(signed);
      const entry = p.costBrl / p.shares;
      this.totals.realizedBrl += -closing * (f.price - entry); // a parte que fecha realiza pnl
      p.costBrl += closing * entry;
      const remainder = signed - closing;
      p.costBrl += remainder * f.price; // o resto abre posição no outro lado
    }
    p.shares += signed;
    if (p.shares === 0) p.costBrl = 0;
    this.totals.fills++;
    this.totals.feesBrl += f.feeBrl;
  }

  private entryPrice() {
    return this.position.shares ? this.position.costBrl / this.position.shares : null;
  }
  private unrealizedBrl(mid: number) {
    return this.position.shares ? this.position.shares * (mid - this.entryPrice()!) : 0;
  }

  private emit(tick: number, book: Book, decision: Decision | null, quote: Quote | null, late: boolean, timing?: Timing, fill: Fill | null = null) {
    const t = this.totals;
    const unrealized = this.unrealizedBrl(book.mid);
    t.pnlBrl = t.realizedBrl + unrealized - t.feesBrl;
    t.pnlPct = (t.pnlBrl / config.bankrollBrl) * 100;
    const event: TickEvent = {
      tick,
      ts: Date.now(),
      marketOpen: this.feed.marketOpen(),
      mid: book.mid,
      bestBid: book.bid,
      bestAsk: book.ask,
      spreadBps: round(book.spreadBps, 2),
      decision: late
        ? { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 0, late: true }
        : decision && {
            action: decision.action,
            probabilities: decision.probabilities,
            upIn10: decision.upIn10,
            latencyMs: Math.round(decision.latencyMs),
            late: false,
          },
      quote,
      fill,
      resting: { bidShares: this.restingShares("buy"), askShares: this.restingShares("sell") },
      position: {
        side: this.position.shares > 0 ? "long" : this.position.shares < 0 ? "short" : "flat",
        size: Math.abs(this.position.shares),
        entryPrice: this.entryPrice(),
        unrealizedBrl: round(unrealized, 2),
      },
      totals: {
        ...t,
        jevUsd: round(t.jevUsd, 6),
        feesBrl: round(t.feesBrl, 4),
        realizedBrl: round(t.realizedBrl, 2),
        pnlBrl: round(t.pnlBrl, 2),
        pnlPct: round(t.pnlPct, 3),
      },
    };
    this.history.push(event);
    if (this.history.length > config.historySize) this.history.shift();
    appendFileSync("data/events.jsonl", JSON.stringify(event) + "\n");
    this.onEvent(event, timing);
  }
}

/** Vários fills num tick viram um só: tamanho total, preço ponderado, lado com mais volume. */
function aggregate(fills: Fill[]): Fill {
  const buy = fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.size, 0);
  const sell = fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.size, 0);
  const side: Side = buy >= sell ? "buy" : "sell";
  const same = fills.filter((f) => f.side === side);
  const size = same.reduce((s, f) => s + f.size, 0);
  const price = same.reduce((s, f) => s + f.size * f.price, 0) / size;
  const feeBrl = same.reduce((s, f) => s + f.feeBrl, 0);
  return { side, size: round(size, 2), price, orderId: same[0]!.orderId, feeBrl };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
