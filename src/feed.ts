import { config } from "./config";

/** Uma cotação da B3 (possivelmente com delay do provider gratuito). */
export interface QuoteTick {
  ts: number; // epoch ms do último negócio reportado pelo provider
  price: number; // último preço em BRL
  volume: number; // volume acumulado do dia (ações)
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  provider: "brapi" | "yahoo" | "walk";
}

/** Um print de negócio. A fonte gratuita não traz negócio-a-negócio: cada mudança de preço vira um print. */
export interface Print {
  tick: number;
  price: number;
  size: number; // ações estimadas pelo delta de volume
  side: "buy" | "sell"; // classificação tick-test: preço subiu = agressão de compra
}

export interface TradeSummary {
  count: number;
  buyShares: number;
  sellShares: number;
  cvdShares: number; // agressões de compra menos de venda
  vwap: number | null;
  lastPrice: number | null;
  lastSide: "buy" | "sell" | null;
}

const RING = 500;
const SP_TZ = "America/Sao_Paulo";

interface BrapiResult {
  regularMarketPrice?: number;
  regularMarketVolume?: number;
  regularMarketTime?: string;
  regularMarketPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
}

async function fetchBrapi(): Promise<QuoteTick> {
  const token = config.brapiToken ? `&token=${config.brapiToken}` : "";
  const res = await fetch(`https://brapi.dev/api/quote/${config.symbol}?fundamental=false${token}`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`brapi http ${res.status}`);
  const r = ((await res.json()) as { results?: BrapiResult[] }).results?.[0];
  if (!r?.regularMarketPrice) throw new Error("brapi: sem preço");
  return {
    ts: r.regularMarketTime ? Date.parse(r.regularMarketTime) : Date.now(),
    price: r.regularMarketPrice,
    volume: r.regularMarketVolume ?? 0,
    prevClose: r.regularMarketPreviousClose ?? r.regularMarketPrice,
    dayHigh: r.regularMarketDayHigh ?? r.regularMarketPrice,
    dayLow: r.regularMarketDayLow ?? r.regularMarketPrice,
    provider: "brapi",
  };
}

interface YahooMeta {
  regularMarketPrice?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
}

async function fetchYahoo(): Promise<QuoteTick> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${config.symbol}.SA?interval=1m&range=1d`,
    { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(4000) },
  );
  if (!res.ok) throw new Error(`yahoo http ${res.status}`);
  const m = ((await res.json()) as { chart?: { result?: { meta?: YahooMeta }[] } }).chart?.result?.[0]?.meta;
  if (!m?.regularMarketPrice) throw new Error("yahoo: sem preço");
  return {
    ts: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now(),
    price: m.regularMarketPrice,
    volume: m.regularMarketVolume ?? 0,
    prevClose: m.previousClose ?? m.chartPreviousClose ?? m.regularMarketPrice,
    dayHigh: m.regularMarketDayHigh ?? m.regularMarketPrice,
    dayLow: m.regularMarketDayLow ?? m.regularMarketPrice,
    provider: "yahoo",
  };
}

/** Hora local em São Paulo como minutos do dia + dia da semana (0 = domingo). */
function spNow(): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  return { weekday: wd, minutes: hour * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function marketOpenNow(now = spNow()): boolean {
  return now.weekday >= 1 && now.weekday <= 5 && now.minutes >= toMin(config.marketOpen) && now.minutes < toMin(config.marketClose);
}

/**
 * Feed de cotações da B3. A cada `pollMs` emite um tick: dentro do pregão busca o último preço
 * real (brapi.dev, fallback Yahoo); fora do pregão roda um random walk ancorado no último preço
 * real (CLOSED_MODE=walk) ou repete a última cotação (hold). Cada mudança de preço vira um Print.
 */
export class QuoteFeed {
  latest: QuoteTick | null = null;
  private prints: Print[] = [];
  private fresh: Print[] = [];
  private tick = 0;
  private lastVolume = 0;
  private lastAnchorFetch = 0;
  private anchor = 0; // último preço real (base do walk)
  private walkOffset = 0; // deslocamento atual do walk em relação à âncora
  private preferYahoo = false;

  marketOpen() {
    return marketOpenNow();
  }

  start(onTick: (tick: number) => void) {
    const loop = async () => {
      this.tick++;
      try {
        await this.step();
        onTick(this.tick);
      } catch (e) {
        console.error(`tick ${this.tick}:`, (e as Error).message);
      }
    };
    void loop();
    setInterval(() => void loop(), config.pollMs);
  }

  private async step() {
    const open = this.marketOpen();
    if (open || config.closedMode === "hold") {
      const q = await this.fetchQuote();
      this.applyQuote(q, open ? "live" : "close");
      return;
    }
    // walk: recalibrar a âncora com o preço real a cada ~60 s
    if (Date.now() - this.lastAnchorFetch > 60_000 || !this.anchor) {
      const q = await this.fetchQuote().catch(() => null);
      if (q) this.applyQuote(q, "anchor");
    }
    this.walkStep();
  }

  /** Uma busca única, fora do loop — para scripts de diagnóstico. */
  fetchOnce() {
    return this.fetchQuote();
  }

  private async fetchQuote(): Promise<QuoteTick> {
    this.lastAnchorFetch = Date.now();
    const order: (() => Promise<QuoteTick>)[] =
      config.quoteProvider === "yahoo" || (config.quoteProvider === "auto" && this.preferYahoo)
        ? [fetchYahoo, fetchBrapi]
        : [fetchBrapi, fetchYahoo];
    const [first, second] = order;
    try {
      return await first!();
    } catch (e) {
      if (config.quoteProvider !== "auto") throw e;
      const q = await second!();
      this.preferYahoo = q.provider === "yahoo"; // gruda no provider que respondeu
      return q;
    }
  }

  /** Registra a cotação e gera um Print quando o preço mudou. */
  private applyQuote(q: QuoteTick, mode: "live" | "close" | "anchor") {
    const prev = this.latest;
    this.latest = q;
    if (mode === "anchor" || mode === "close") {
      this.anchor = q.price;
      this.walkOffset = 0;
    }
    if (mode !== "live" || !prev || q.price === prev.price) {
      this.lastVolume = q.volume;
      return;
    }
    const size = Math.max(0, q.volume - this.lastVolume) || config.tradeShares; // delta real ou estimativa
    this.lastVolume = q.volume;
    const side: Print["side"] = q.price > prev.price ? "buy" : "sell";
    this.pushPrint({ tick: this.tick, price: q.price, size, side });
  }

  /** Passo do random walk com leve reversão à âncora (último preço real). */
  private walkStep() {
    if (!this.latest) return;
    const sigma = this.anchor * (config.walkStepBps / 10_000);
    const shock = (Math.random() * 2 - 1 + (Math.random() * 2 - 1)) * sigma; // ~triangular
    const pull = (this.anchor + this.walkOffset - this.latest.price) * 0.05;
    const price = Math.max(config.tickSize, Math.round((this.latest.price + shock + pull) / config.tickSize) * config.tickSize);
    this.walkOffset = price - this.anchor;
    const prev = this.latest;
    this.latest = { ...prev, ts: Date.now(), price, provider: "walk" };
    if (price !== prev.price) {
      const size = config.tradeShares * (1 + Math.floor(Math.random() * 4));
      this.pushPrint({ tick: this.tick, price, size, side: price > prev.price ? "buy" : "sell" });
    }
  }

  private pushPrint(p: Print) {
    this.prints.push(p);
    this.fresh.push(p);
    if (this.prints.length > RING) this.prints.splice(0, this.prints.length - RING);
  }

  summary(lastTicks: number): TradeSummary {
    const minTick = this.tick - lastTicks;
    let count = 0, buy = 0, sell = 0, notional = 0;
    let lastPrice: number | null = null, lastSide: "buy" | "sell" | null = null;
    for (const t of this.prints) {
      if (t.tick <= minTick) continue;
      count++;
      if (t.side === "buy") buy += t.size;
      else sell += t.size;
      notional += t.size * t.price;
      lastPrice = t.price;
      lastSide = t.side;
    }
    const vol = buy + sell;
    return { count, buyShares: buy, sellShares: sell, cvdShares: buy - sell, vwap: vol > 0 ? notional / vol : null, lastPrice, lastSide };
  }

  recent(n: number): Print[] {
    return this.prints.slice(-n);
  }

  /** Prints desde a última chamada (mais antigos primeiro). Base do preenchimento simulado. */
  drainPrints(): Print[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
}
