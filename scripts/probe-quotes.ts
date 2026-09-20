/** Sanity check do feed: busca uma cotação real e mostra se o pregão está aberto. */
import { config } from "../src/config";
import { QuoteFeed, marketOpenNow } from "../src/feed";

const feed = new QuoteFeed();
console.log(`symbol=${config.symbol} provider=${config.quoteProvider} pregão aberto: ${marketOpenNow()}`);

const t0 = performance.now();
const q = await feed.fetchOnce().catch((e: Error) => ({ erro: e.message }));
console.log(`${Math.round(performance.now() - t0)}ms`, q);
