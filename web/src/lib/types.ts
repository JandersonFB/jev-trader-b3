export type Action = "buy" | "sell" | "hold";
export type Side = "buy" | "sell";
/** A ordem limite simulada deste tick: descansa um tick e executa quando um print cruza o preço. */
export interface Quote { side: Side; price: number; size: number; status: "sim"; orderId: number; capped: boolean }
/** Um print executou uma ordem nossa que descansava no livro simulado. */
export interface Fill { side: Side; size: number; price: number; orderId: number; feeBrl: number }
export interface Decision { action: Action; probabilities: { buy: number; sell: number; hold: number }; upIn10: number; latencyMs: number; late: boolean }
export interface Position { side: "long" | "short" | "flat"; size: number; entryPrice: number | null; unrealizedBrl: number }
export interface Totals { ticks: number; decisions: number; quotes: number; fills: number; lateTicks: number; jevUsd: number; feesBrl: number; realizedBrl: number; pnlBrl: number; pnlPct: number }
export interface TickEvent { tick: number; ts: number; marketOpen: boolean; mid: number; bestBid: number; bestAsk: number; spreadBps: number; decision: Decision | null; quote: Quote | null; fill: Fill | null; resting: { bidShares: number; askShares: number }; position: Position; totals: Totals }
export interface Meta { model: string; symbol: string; currency: "BRL"; sim: boolean; startedAt: number }
export type ConnectionState = "connecting" | "live" | "reconnecting";
export interface FeedState { meta: Meta | null; events: TickEvent[]; latest: TickEvent | null; connection: ConnectionState; avgLatencyMs: number }
