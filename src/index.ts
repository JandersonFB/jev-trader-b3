import { config } from "./config";
import { QuoteFeed } from "./feed";
import { PaperBroker } from "./broker";
import { createModel } from "./model";
import { Trader } from "./trader";
import { startServer } from "./server";

const feed = new QuoteFeed();
const broker = new PaperBroker();
const model = createModel();

const server = startServer(
  { model: model.name, symbol: config.symbol, currency: "BRL", sim: true, startedAt: Date.now() },
  () => trader.history,
);
const trader = new Trader(
  broker,
  feed,
  model,
  (e, t) => {
    server.broadcast(e);
    if (e.decision && !e.decision.late) {
      const p = e.decision.probabilities;
      const q = e.quote;
      const quote = !q ? " SEM ORDEM (cap ou caixa nos dois lados)" : ` ${q.side === "buy" ? "COMPRA" : "VENDA"} ${q.size} @ ${q.price.toFixed(2)}${q.capped ? " capped" : ""} (sim)`;
      console.log(
        `#${e.tick} ${e.mid.toFixed(2)} c${(p.buy * 100).toFixed(0)} v${(p.sell * 100).toFixed(0)} ${e.decision.latencyMs}ms${quote} pnl R$${e.totals.pnlBrl}${t ? ` · loop ${t.loopMs}ms` : ""}`,
      );
    }
  },
  (tick, fill) => {
    server.broadcastFill(tick, fill);
    console.log(`#${tick} FILL ${fill.side === "buy" ? "COMPRA" : "VENDA"} ${fill.size} @ ${fill.price.toFixed(2)} (sim) ordem ${fill.orderId} taxa R$${fill.feeBrl.toFixed(4)}`);
  },
);

console.log(
  `jev-trader-b3 · model=${model.name} · ${config.symbol} a cada ${config.pollMs}ms · SIMULAÇÃO · banca R$${config.bankrollBrl} · lote ${config.tradeShares} · pregão ${config.marketOpen}-${config.marketClose} (fecha: ${config.closedMode}) · :${config.port}`,
);
feed.start((tick) => trader.onTick(tick));
