// Drop-in replacement for `twoslash-cdn`, wired in by remotion.offline.config.ts.
// Redirects TypeScript lib .d.ts fetches from playgroundcdn.typescriptlang.org
// (blocked in sandboxed containers) to the local lib server started by driver.mjs,
// which serves node_modules/typescript/lib. Everything else is passed through.
import * as real from "../../../node_modules/twoslash-cdn/dist/index.mjs";

export * from "../../../node_modules/twoslash-cdn/dist/index.mjs";

const LOCAL = "http://127.0.0.1:4719/";
const CDN = /^https:\/\/playgroundcdn\.typescriptlang\.org\/cdn\/[^/]+\/typescript\/lib\//;

const localFetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  return fetch(url.replace(CDN, LOCAL), init);
};

export const createTwoslashFromCDN = (options = {}) =>
  real.createTwoslashFromCDN({ ...options, fetcher: options.fetcher ?? localFetch });
