import { experimental_evaluate } from "ai";
import { typeSafeAi } from "@ai-sdk/typesafe-ai";
import { config } from "./config";

/** Models answer buy or sell. `hold` only appears on late ticks (no decision was made). */
export type Action = "buy" | "sell" | "hold";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
  market: string; // e.g. "PETR4.B3"
  tick: number;
  horizonTicks: number; // the question is about the move over this many ticks
  tickMs: number;
  marketOpen: boolean;
  mid: number;
  spreadBps: number;
  bookImbalance: number; // -1 (all asks) .. 1 (all bids), near mid — synthetic book estimate
  /** Cumulative resting shares within 10/25/50 bps of mid, per side (synthetic). */
  depth: { [band: string]: { bid: number; ask: number } };
  /** Top 5 levels each side, best first, as "price x size" (synthetic). */
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string; // oldest..newest, sampled every 2 ticks over the horizon, space separated
  /** Prints over the last `horizonTicks`. cvdShares = buy-initiated minus sell-initiated shares. */
  trades: { count: number; buyShares: number; sellShares: number; cvdShares: number; vwap: number | null; lastPrice: number | null; lastSide: "buy" | "sell" | null };
  recentTrades: string[]; // newest last, "tick side size @ price"
  allowed: { buy: boolean; sell: boolean };
}

export interface Decision {
  action: Action;
  probabilities: Record<Action, number>;
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<Decision>;
}

const QUESTIONS = {
  direction: {
    type: "choice",
    instructions: {
      question: `Will ${config.symbol} trade higher or lower than the current mid after \`horizonTicks\` more ticks?`,
      goal: `Trade ${config.symbol} on B3, the Brazilian exchange, in BRL. One tick is a quote poll (~\`tickMs\` ms); \`horizonTicks\` (~30 s) is the horizon. A decision is made every tick and a simulated limit order rests until the next one. The trade crosses the spread (\`spreadBps\`), so the move must beat that cost.`,
      timing: "The order executes against the next prints: a sell print at or below our bid fills a buy, a buy print at or above our ask fills a sell.",
      inputs: "Order flow is the strongest signal: `trades.cvdShares` (buy-initiated minus sell-initiated shares over the horizon), `trades.lastSide` and `recentTrades` show who is aggressing. `depth` and `book` are SYNTHETIC liquidity estimates tilted by momentum — treat them as weak context. `returnsBps` and `recentMids` show the path over the horizon. If `marketOpen` is false the feed is a simulated walk anchored to the last real close. If `allowed.buy` is false the trade will be a sell regardless, and vice versa.",
    },
    criteria: {
      buy: `Buy ${config.symbol} now: mid more likely to be higher after \`horizonTicks\` ticks, by more than the spread.`,
      sell: `Sell ${config.symbol} now: mid more likely to be lower after \`horizonTicks\` ticks, by more than the spread.`,
    },
  },
} as const;

/** Real Jev via the AI SDK. Swap-in is the MODEL env var. */
export class JevModel implements Model {
  readonly name = config.jevModelId;
  private model = typeSafeAi.evaluationModel(config.jevModelId);

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    const r = await experimental_evaluate({ model: this.model, state: state as any, questions: QUESTIONS, maxRetries: 0 });
    const a = r.answers.direction;
    const p = a.probabilities ?? { buy: 0, sell: 0, [a.choice]: 1 };
    const buy = p.buy ?? 0, sell = p.sell ?? 0;
    return {
      action: a.choice as Action,
      probabilities: { buy, sell, hold: 0 },
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: r.usage?.inputTokens ?? 0,
    };
  }
}

/** Deterministic stand-in: momentum + imbalance + mean reversion toward flat. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    // momentum + book imbalance + noise, pulled back toward flat so it trades both ways
    const flow = state.trades.buyShares + state.trades.sellShares ? state.trades.cvdShares / (state.trades.buyShares + state.trades.sellShares) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const buy = 1 / (1 + Math.exp(-signal)); // binary softmax
    const probabilities = { buy, sell: 1 - buy, hold: 0 };
    const action: Action = buy >= 0.5 ? "buy" : "sell";
    await Bun.sleep(80); // stand in for inference time so the pipeline behaves like production
    return {
      action,
      probabilities,
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    };
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => (config.model === "jev" ? new JevModel() : new MockModel());
