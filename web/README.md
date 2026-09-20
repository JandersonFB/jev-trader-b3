# Jev Trader B3 — web

Frontend Next.js (App Router, TypeScript, CSS Modules — sem Tailwind) do Jev Trader B3:
uma decisão de IA por tick de cotação da B3, em conta simulada.

## Run

```bash
export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
bun install
bun run dev      # http://localhost:3000
bun run build
```

Use Bun only.

## Config

Copie `.env.example` para `.env.local`. `NEXT_PUBLIC_API_URL` aponta para o backend
(default `http://localhost:3001`); o app abre um EventSource em `$NEXT_PUBLIC_API_URL/events`.

## Layout

- `src/lib/types.ts` — wire types (`TickEvent`, `Decision`, `Fill`, `Meta`, …)
- `src/lib/useFeed.ts` — SSE hook: snapshot / tick / fill / ping, janela de 1000 eventos,
  reconexão 1s→10s, `connection` state, `avgLatencyMs`
- `src/lib/useUptime.ts` — `useUptime(startedAt)` → `"hh:mm:ss"`
- `src/lib/format.ts` — formatação BRL/preço/números em pt-BR
- `src/app/globals.css` — design tokens, `.card`
- `src/components/<Name>/<Name>.tsx` — componentes (uma pasta cada)
