# Jev Trader B3 — Spec

## Uma linha
Um dashboard ao vivo mostrando uma IA tomando uma decisão de trade a cada tick de cotação da B3.

## O que é
Um web app de página única. Um modelo "Jev" (TypeSafe) observa a cotação de um ativo da B3
(ex.: PETR4) e a cada tick (~2 s) responde uma pergunta: compra ou venda. Cada tick gera uma ordem
limite **simulada** no livro sintético, que descansa até o próximo tick e executa quando um print
de preço cruza o seu nível. Conta, custos e P&L em BRL. Nada é enviado a uma corretora.

## Diferenças do original (Monad/Kuru)
- Bloco de 300 ms → tick de `POLL_MS` (2 s) — o cadenciador é o poll de cotação, não a chain.
- Livro on-chain real → livro sintético (fontes gratuitas não expõem o book da B3).
- Gas em MON → custos simulados em BRL (`SIM_FEES_BPS`).
- Fora do pregão o preço real não anda: `CLOSED_MODE=walk` mantém o demo vivo com um random walk
  ancorado no último fechamento; `hold` congela no último preço.

## A mensagem
"Esta IA decide comprar ou vender um ativo da B3 a cada tick." Tudo na tela deve reforçar isso:
preço, decisão, barra de probabilidade, fita de execuções e P&L em reais.

## Estados
- Live: tick verde/vermelho por decisão, amber quando o modelo atrasa (`late`).
- Pregão fechado: badge "pregão fechado" no header; os preços seguem o walk simulado.
- Reconectando: overlay/label no header.
- Modelo stand-in (`mock`): badge amber; com `jev-latest` a badge roxa.

## Não-objetivos
- Sem multi-ativos, sem login, sem histórico/backtests.
- Sem promessa de lucro: custos e perdas aparecem tão claramente quanto ganhos.
- Sem ordens reais nesta versão.
