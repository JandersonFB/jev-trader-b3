# jev-trader-b3

Uma decisão por tick. Adaptação do [jev-trader](https://github.com/jarrodwatts/jev-trader) para a B3:
um modelo de IA (Jev, da TypeSafe) olha a cotação de um ativo da B3 e responde **compra ou venda**
a cada tick. Todas as ordens e o caixa são **simulados** — nada sai da máquina. Um pequeno servidor
(Bun + SSE) transmite cada tick para o dashboard em `web/`.

Quando o pregão está aberto (seg–sex, 10:00–18:00 horário de São Paulo) o feed busca o último preço
real do ativo na [brapi.dev](https://brapi.dev) (fallback: Yahoo Finance). Fora do pregão, um random
walk ancorado no último fechamento real mantém a simulação viva (`CLOSED_MODE=walk`).

## Rodar

    cp .env.example .env
    bun install
    bun run start          # backend em :3001
    cd web && bun install && bun run dev   # dashboard em :3000

Sem `TYPESAFE_AI_API_KEY`/`MODEL=jev` roda com o modelo `mock` (heurístico de momentum).
Com `MODEL=jev` e a key, cada decisão é do Jev de verdade.

## O que é simulado e o que é real

| Real | Simulado |
|---|---|
| Preço do ativo (brapi/Yahoo, com delay) | Livro de ofertas (sintético: `SIM_SPREAD_BPS` em torno do mid) |
| Decisões do modelo Jev | Execuções, caixa e posição (`PaperBroker`, BRL) |
| Prints derivados das mudanças de preço | Custos (`SIM_FEES_BPS` por execução) |

Regra de execução do simulador: a ordem postada no tick N descansa a partir do tick N+1; um print
de venda no nosso bid (ou de compra na nossa ask) executa até o tamanho do print — mesma regra do
dry-run original, mas com prints da B3 em vez de logs on-chain.

## Endpoints

- `GET /` snapshot: model, symbol, sim, último evento
- `GET /history` últimos 1000 eventos de tick
- `GET /events` SSE: `snapshot` na conexão, depois um evento `tick` por tick e `fill` por execução

Formato de cada evento (ver `src/trader.ts`):

    {
      "tick": 42, "ts": 1789867185214, "marketOpen": false,
      "mid": 48.54, "bestBid": 48.52, "bestAsk": 48.56, "spreadBps": 8.24,
      "decision": { "action": "buy", "probabilities": {"buy": 0.66, "sell": 0.34, "hold": 0}, "upIn10": 0.66, "latencyMs": 80, "late": false },
      "quote": { "side": "buy", "price": 48.53, "size": 100, "status": "sim", "orderId": 3, "capped": false },
      "fill": null,
      "resting": { "bidShares": 100, "askShares": 0 },
      "position": { "side": "flat", "size": 0, "entryPrice": null, "unrealizedBrl": 0 },
      "totals": { "ticks": 3, "decisions": 3, "quotes": 3, "fills": 2, "lateTicks": 0, "jevUsd": 0.000023, "feesBrl": 0.97, "realizedBrl": 1, "pnlBrl": 0.03, "pnlPct": 0 }
    }

## Layout

    src/config.ts   env
    src/feed.ts     feed de cotações B3 (brapi.dev + fallback Yahoo, horário do pregão, walk fora do pregão)
    src/book.ts     livro sintético a partir da cotação (spread + profundidade estimada)
    src/broker.ts   PaperBroker: caixa/custódia simulados em BRL, preço da ordem, taxas
    src/model.ts    Model interface, JevModel (AI SDK experimental_evaluate), MockModel
    src/trader.ts   o loop: um em voo, `late` quando atrasado, posição e P&L em BRL
    src/server.ts   Bun.serve: snapshot, history, SSE

    bun run scripts/probe-quotes.ts   # sanity check do feed de cotações

## Para ligar um broker real depois

O ponto de troca é `src/broker.ts`: implemente a mesma interface (`quotePrice`, `send`, `applyFill`,
`balance`) chamando a API da corretora, e alimente `src/feed.ts` com um market-data real da B3.
