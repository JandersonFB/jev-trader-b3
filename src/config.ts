const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

export const config = {
  /** Ativo da B3 a operar, sem sufixo (PETR4, VALE3, ITUB4...). O sufixo .SA é aplicado no provider Yahoo. */
  symbol: env("SYMBOL", "PETR4")!.toUpperCase(),
  /** Intervalo entre ticks: cada poll de cotação é um tick do loop. */
  pollMs: Number(env("POLL_MS", "2000")),

  /** Fonte de cotação: auto tenta brapi.dev e cai para Yahoo Finance. */
  quoteProvider: env("QUOTE_PROVIDER", "auto") as "auto" | "brapi" | "yahoo",
  brapiToken: env("BRAPI_TOKEN"), // opcional; sem token a brapi aceita poucas req/min

  /** Janela do pregão em America/Sao_Paulo (HH:mm). Fora dela o feed usa CLOSED_MODE. */
  marketOpen: env("MARKET_OPEN", "10:00")!,
  marketClose: env("MARKET_CLOSE", "18:00")!,
  /** Fora do pregão: walk = random walk ancorado no último preço real; hold = só reenvia o último preço real. */
  closedMode: env("CLOSED_MODE", "walk") as "walk" | "hold",
  /** Desvio-padrão do passo do walk, em bps do preço. */
  walkStepBps: Number(env("WALK_STEP_BPS", "6")),

  /** Livro sintético: spread total em bps do mid e profundidade estimada pelo volume negociado. */
  simSpreadBps: Number(env("SIM_SPREAD_BPS", "8")),
  /** Tick mínimo de preço na B3 para ações (R$ 0,01). */
  tickSize: Number(env("TICK_SIZE", "0.01")),
  /** A ordem fica esta quantidade de ticks dentro do touch (0 = junta no melhor bid/ask). */
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),

  /** Conta simulada em BRL. Venda a descoberto é permitida até o cap de posição. */
  tradeShares: Number(env("TRADE_SIZE_SHARES", "100")), // lote padrão
  maxPositionShares: Number(env("MAX_POSITION_SHARES", "500")),
  bankrollBrl: Number(env("BANKROLL_BRL", "10000")),
  /** Custos simulados por execução (emolumentos + corretagem), em bps do volume financeiro. */
  simFeesBps: Number(env("SIM_FEES_BPS", "1")),

  horizonTicks: Number(env("HORIZON_TICKS", "15")), // o modelo prevê o movimento neste horizonte (~30 s a 2 s/tick)

  model: env("MODEL", "mock") as "mock" | "jev",
  jevModelId: env("JEV_MODEL_ID", "jev-latest")!,
  jevUsdPerMTok: 0.042,

  port: Number(env("PORT", "3001")),
  historySize: 1000,
};
