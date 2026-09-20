import { config } from "./config";
import type { Book } from "./broker";
import type { QuoteTick } from "./feed";

export type Level = [price: number, size: number];

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Livro sintético para a simulação: a fonte gratuita de cotações não expõe o livro real da B3.
 * bid/ask = último preço menos/meio-spread (`SIM_SPREAD_BPS`), alinhado ao tick de R$ 0,01.
 * A profundidade é proporcional ao volume negociado no dia e inclinada pelo momentum recente
 * (`imbalance`), só para dar ao modelo um gradiente plausível de liquidez.
 */
export function synthBook(tick: number, q: QuoteTick, momentumBps: number): Book {
  const mid = q.price;
  const tickSize = config.tickSize;
  const half = Math.max(tickSize, round2((mid * (config.simSpreadBps / 2)) / 10_000));
  const bid = round2(mid - half);
  const ask = round2(mid + half);

  // Profundidade de referência por lado: ~volume/2000 do dia, no mínimo 8 lotes.
  const base = Math.max(config.tradeShares * 8, Math.round(q.volume / 2000));
  const tilt = Math.max(-0.6, Math.min(0.6, momentumBps / 200)); // momentum inclina a liquidez
  const bidDepth = Math.round(base * (1 + tilt));
  const askDepth = Math.round(base * (1 - tilt));
  const imbalance = bidDepth + askDepth ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;

  // 5 níveis por lado, afastando 1 tick, tamanho decaindo.
  const spread = (side: "bid" | "ask", depth: number): Level[] => {
    const weights = [0.34, 0.24, 0.17, 0.14, 0.11];
    return weights.map((w, i) => [
      round2(side === "bid" ? bid - i * tickSize : ask + i * tickSize),
      Math.round((depth * w) / 100) * 100 || 100,
    ]);
  };
  const bids = spread("bid", bidDepth);
  const asks = spread("ask", askDepth);

  // Profundidade acumulada por banda de distância do mid.
  const within = (levels: Level[], bps: number) =>
    levels.filter((l) => (Math.abs(l[0] - mid) / mid) * 10_000 <= bps).reduce((s, l) => s + l[1], 0);
  const depthBps: Book["depthBps"] = {};
  for (const b of [10, 25, 50]) depthBps[String(b)] = { bid: within(bids, b), ask: within(asks, b) };

  return {
    tick,
    bid,
    ask,
    mid,
    spreadBps: ((ask - bid) / mid) * 10_000,
    imbalance,
    levels: { bids, asks },
    depthBps,
  };
}
