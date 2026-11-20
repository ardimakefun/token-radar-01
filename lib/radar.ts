// Launch Radar: a fitted comparables value model for pre-token protocols
// (radar-fit-1).
//
// The board ranks protocols that record no token by what a token would be worth if the
// protocol's record stayed as it is. The value is FITTED at runtime from the sealed
// snapshot's own launched protocols, in log space (y = log(market-cap / TVL)):
//
//   peer set        = the launched protocols that pass the watchlist exclusion rules,
//                     ignoring the token test (88 of the 128 launched)
//   log-ratios      = clipped to [-4, +2] before fitting, so one extreme peer cannot
//                     carry a whole thin category
//   category effect = the shrunk log-mean of a category's cleaned peers, shrunk toward
//                     the global log-mean with k = 5; categories with no cleaned peer
//                     use the global log-mean
//   size effect     = slope x (log(TVL) - centre), the slope by one-variable OLS of
//                     (clipped y - category estimate) on (log TVL - centre), where the
//                     centre is the mean log TVL of the launched protocols
//   implied value   = TVL x exp(category estimate + slope x (log(TVL) - centre))
//
// Growth and age carry weight 0, by design: the growth slope is outlier-driven and
// points the wrong way (the two highest ratios both sit on a TVL collapse of about
// -37%, a denominator artefact), and age has no measurable effect (correlation with
// the log-ratio about +0.002). Both figures are still shown for every row, and the
// dashboard states the fitted evidence. No protocol name is ever special-cased in
// the value: the same function scores every row. Farm plans are built from each
// protocol's own record (category, chains, TVL, age); the snapshot carries no
// airdrop flag, so no step claims a points program it does not record.
//
// The 80% interval around each implied value comes from the same deterministic
// 5-fold cross-validation the design prototype uses (fold = crc32(slug) % 5, the
// fit retrained per fold with a train-only TVL centre, scored against the raw
// log-ratio): the out-of-sample residual SD over comparable protocols only,
// factor exp(+/-1.2816 x SD).

/** One protocol of the sealed snapshot: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's design constants: the shrinkage, the winsorizing bounds and the
 *  80% interval's z-value. The FITTED constants (global log-mean, TVL centre,
 *  slope, interval SD) are computed at runtime from the snapshot, never written
 *  here. Stated on the dashboard next to the formula. */
export interface ModelConstants {
  shrink_k: number;
  clip_low: number;
  clip_high: number;
  interval_z: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 5,
  clip_low: -4,
  clip_high: 2,
  interval_z: 1.2816,
};

/** The model's version label: the dashboard names it next to the formula. */
export const MODEL_VERSION = 'radar-fit-1';

/** How many launched protocols the live-token view carries, by market cap. */
export const LIVE_ROWS = 20;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token at all for a protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product, never a launch of their own. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol may not begin with: an exchange's own product is not a launch. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is comparable: not a wrapped, staked or bridged product, not
 *  versioned, not an exchange's own product. The token test is NOT part of this:
 *  launched protocols are the peers the model is fitted on. */
export function isComparable(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Whether a protocol is a launch candidate: pre-token and not a wrapped, staked or bridged product. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  return isComparable(p);
}

/** One category's fitted multiple: the shrunk log-mean over its cleaned comparable
 *  peers, as a multiple. `peers` is the cleaned comparable peer count: 0 when the
 *  estimate is the pure global mean. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
  source: 'category' | 'global';
}

/** Everything the fitted model computes at runtime from the snapshot it is given. */
export interface FittedModel {
  globalLogMean: number;
  globalMultiple: number;
  tvlCenter: number;
  slope: number;
  launchedPeers: number;
  comparablePeers: number;
  intervalSd: number;
  intervalLow: number;
  intervalHigh: number;
  byCategory: Map<string, CategoryMultiple>;
}

/** CRC-32 (IEEE) of a string: the deterministic 5-fold CV assigns fold = crc32(slug) % 5. */
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(s: string): number {
  let c = 0xffffffff;
  for (let i = 0; i < s.length; i++) c = CRC_TABLE[(c ^ s.charCodeAt(i)) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The mean of a non-empty list of numbers. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** A launched protocol's log-ratio, winsorized to the design bounds before fitting. */
function clippedLogRatio(p: SnapshotProtocol): number {
  const y = Math.log(p.mcap_usd! / p.tvl_usd);
  return Math.min(MODEL.clip_high, Math.max(MODEL.clip_low, y));
}

/**
 * One winsorized fit over a set of launched protocols: the global log-mean, the
 * shrunk category log-means (k = 5) and the logTVL slope by one-variable OLS of
 * (clipped y - category estimate) on (log TVL - centre). The centre is the mean
 * log TVL of the launched set it is given, so a CV fold's fit uses its train
 * fold only. Launched protocols are taken slug-sorted, so the fit is
 * deterministic for a given snapshot.
 */
interface WinsorizedFit {
  globalLogMean: number;
  tvlCenter: number;
  slope: number;
  estimate: (category: string | null) => number;
  peers: (category: string | null) => number;
}

function winsorizedFit(launched: SnapshotProtocol[]): WinsorizedFit {
  const comp = launched.filter(isComparable);
  const globalLogMean = mean(comp.map(clippedLogRatio));
  const tvlCenter = mean(launched.map((p) => Math.log(p.tvl_usd)));
  // Per-category clipped log-ratio sums over the comparable peers, shrunk toward
  // the global log-mean. Categories with no comparable peer fall back to it.
  const byCat = new Map<string, { n: number; sum: number }>();
  for (const p of comp) {
    if (p.category === null) continue;
    const e = byCat.get(p.category);
    if (e === undefined) byCat.set(p.category, { n: 1, sum: clippedLogRatio(p) });
    else {
      e.sum += clippedLogRatio(p);
      e.n += 1;
    }
  }
  const estimate = (category: string | null): number => {
    if (category === null) return globalLogMean;
    const e = byCat.get(category);
    if (e === undefined) return globalLogMean;
    return (e.n * (e.sum / e.n) + MODEL.shrink_k * globalLogMean) / (e.n + MODEL.shrink_k);
  };
  const peers = (category: string | null): number => {
    if (category === null) return 0;
    return byCat.get(category)?.n ?? 0;
  };
  // One-variable OLS slope of (clipped y - category estimate) on (log TVL - centre).
  let num = 0;
  let den = 0;
  for (const p of comp) {
    const x = Math.log(p.tvl_usd) - tvlCenter;
    num += x * (clippedLogRatio(p) - estimate(p.category));
    den += x * x;
  }
  const slope = den === 0 ? 0 : num / den;
  return { globalLogMean, tvlCenter, slope, estimate, peers };
}

/**
 * The 80% interval from the same deterministic 5-fold CV the design prototype
 * uses: fold = crc32(slug) % 5, the winsorized fit retrained per fold with a
 * train-only TVL centre, predictions scored against the RAW log-ratio, and the
 * residual SD taken over comparable test rows only. The factor is
 * exp(+/-interval_z x SD). Residuals are gathered in slug order, as in the
 * prototype, so the SD matches it.
 */
function intervalFromCv(launched: SnapshotProtocol[]): { sd: number; low: number; high: number } {
  const pred = new Map<string, number>();
  for (let f = 0; f < 5; f++) {
    const train = launched.filter((p) => crc32(p.slug) % 5 !== f);
    const fit = winsorizedFit(train);
    for (const p of launched) {
      if (crc32(p.slug) % 5 !== f) continue;
      pred.set(p.slug, fit.estimate(p.category) + fit.slope * (Math.log(p.tvl_usd) - fit.tvlCenter));
    }
  }
  const residuals: number[] = [];
  for (const p of launched) {
    if (!isComparable(p)) continue;
    residuals.push(Math.log(p.mcap_usd! / p.tvl_usd) - pred.get(p.slug)!);
  }
  if (residuals.length < 2) return { sd: NaN, low: NaN, high: NaN };
  const m = mean(residuals);
  const sd = Math.sqrt(residuals.reduce((a, r) => a + (r - m) * (r - m), 0) / (residuals.length - 1));
  return { sd, low: Math.exp(-MODEL.interval_z * sd), high: Math.exp(MODEL.interval_z * sd) };
}

/** The fitted model, computed at runtime from the snapshot's launched set. */
export function fitModel(protocols: SnapshotProtocol[]): FittedModel {
  const launched = protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const fit = winsorizedFit(launched);
  const comp = launched.filter(isComparable);
  const cv = intervalFromCv(launched);
  // The interval comes from the runtime CV. If that ever fails to produce a
  // finite SD, fall back to the documented design constants (see README).
  const intervalLow = Number.isFinite(cv.low) ? cv.low : 0.075;
  const intervalHigh = Number.isFinite(cv.high) ? cv.high : 13.3;
  const byCategory = new Map<string, CategoryMultiple>();
  const seen = new Set<string>();
  for (const p of launched) if (p.category !== null) seen.add(p.category);
  for (const category of [...seen].sort()) {
    const n = fit.peers(category);
    byCategory.set(category, {
      category,
      multiple: Math.exp(fit.estimate(category)),
      peers: n,
      source: n >= 1 ? 'category' : 'global',
    });
  }
  return {
    globalLogMean: fit.globalLogMean,
    globalMultiple: Math.exp(fit.globalLogMean),
    tvlCenter: fit.tvlCenter,
    slope: fit.slope,
    launchedPeers: launched.length,
    comparablePeers: comp.length,
    intervalSd: cv.sd,
    intervalLow,
    intervalHigh,
    byCategory,
  };
}

/** The fitted multiple for one category: its shrunk estimate, else the global mean with 0 peers. */
export function comparableFor(category: string | null, model: FittedModel): CategoryMultiple {
  if (category !== null) {
    const hit = model.byCategory.get(category);
    if (hit !== undefined) return hit;
  }
  return { category: 'All cleaned comparable protocols', multiple: model.globalMultiple, peers: 0, source: 'global' };
}

/** The implied value one protocol gets, with every factor the dashboard shows. */
export interface Valuation {
  implied: number;
  impliedLow: number;
  impliedHigh: number;
  growthPct: number;
  growthMult: number;
  tenureMult: number;
  age: number | null;
  multiple: number;
  multiplePeers: number;
  multipleSource: 'category' | 'global';
  sizeFactor: number;
  categoryLabel: string;
}

export function valueProtocol(p: SnapshotProtocol, asOf: string, model: FittedModel): Valuation {
  const age = ageInDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(100, Math.max(-50, rawGrowth));
  // Growth and age carry weight 0, by design: the fitted growth slope is
  // outlier-driven and points the wrong way (the two highest ratios both sit
  // on a TVL collapse of about -37%, a denominator artefact), and age has no
  // measurable effect. The multipliers stay 1.0000; the dashboard states why.
  const growthMult = 1;
  const tenureMult = 1;
  const comp = comparableFor(p.category, model);
  const sizeFactor = Math.exp(model.slope * (Math.log(p.tvl_usd) - model.tvlCenter));
  const implied = Math.max(1, Math.round(p.tvl_usd * comp.multiple * sizeFactor));
  return {
    implied,
    impliedLow: Math.max(1, Math.round(implied * model.intervalLow)),
    impliedHigh: Math.max(1, Math.round(implied * model.intervalHigh)),
    growthPct,
    growthMult,
    tenureMult,
    age,
    multiple: comp.multiple,
    multiplePeers: comp.peers,
    multipleSource: comp.source,
    sizeFactor,
    categoryLabel: p.category ?? 'Uncategorised',
  };
}

// ---------------------------------------------------------------- farm plans

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: action, cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A category's main farm action and its weekly cadence action. */
interface CategoryPlay {
  action: (name: string, capital: number, chain: string) => string;
  cadence: (name: string) => string;
}

const PLAYS: [RegExp, CategoryPlay][] = [
  [
    /risk curator/i,
    {
      action: (n, c, ch) => `Deposit $${c} into a ${n} curator vault on ${ch} and keep the vault shares.`,
      cadence: (n) => `Check the vault's allocation once a week and top it up only through the vault's own page.`,
    },
  ],
  [
    /onchain capital allocator/i,
    {
      action: (n, c, ch) => `Deposit $${c} into a ${n} allocator vault on ${ch} and hold the shares.`,
      cadence: (n) => `Review the vault's strategy allocation weekly and add only through the vault's own deposit page.`,
    },
  ],
  [
    /cdp/i,
    {
      action: (n, c, ch) => `Lock $${c} of collateral in ${n} on ${ch} and mint its stable asset against it, keeping the ratio above the protocol's minimum.`,
      cadence: (n) => `Check the collateral ratio weekly and top it up before it nears liquidation.`,
    },
  ],
  [
    /lend/i,
    {
      action: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the supply position open.`,
      cadence: (n) => `Borrow a small amount against the supply once a week and repay it, so the account shows both sides.`,
    },
  ],
  [
    /dex/i,
    {
      action: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open.`,
      cadence: (n) => `Swap a small amount through the pool once a week and collect the fees it earns.`,
    },
  ],
  [
    /rwa/i,
    {
      action: (n, c, ch) => `Mint $${c} of ${n}'s yield asset on ${ch} and hold it.`,
      cadence: (n) => `Check the asset's yield accrual weekly and keep the holding through a full distribution cycle.`,
    },
  ],
  [
    /restak/i,
    {
      action: (n, c, ch) => `Restake $${c} of ETH or a liquid staking token through ${n} on ${ch} and keep the receipt.`,
      cadence: (n) => `Check the restaked position weekly and add to it only through the protocol's own restaking page.`,
    },
  ],
  [
    /collateral market/i,
    {
      action: (n, c, ch) => `Deposit $${c} of collateral into a ${n} market on ${ch} and keep the position open.`,
      cadence: (n) => `Check the collateral health weekly and rebalance before it nears the limit.`,
    },
  ],
  [
    /payment/i,
    {
      action: (n, c, ch) => `Open a payment channel with $${c} through ${n} on ${ch} and route a payment through it.`,
      cadence: (n) => `Send one payment a week through the channel so the route stays active.`,
    },
  ],
  [
    /^chain$/i,
    {
      action: (n, c, ch) => `Bridge $${c} to ${n}'s chain and use it in one of the chain's own apps, keeping the funds on the chain.`,
      cadence: (n) => `Use one app on the chain each week and keep the balance on the chain between uses.`,
    },
  ],
  [
    /cedefi/i,
    {
      action: (n, c, ch) => `Deposit $${c} into ${n} on ${ch} and hold the position in its app.`,
      cadence: (n) => `Check the position's yield weekly and keep the deposit through a full cycle.`,
    },
  ],
  [
    /yield aggregator/i,
    {
      action: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the vault shares.`,
      cadence: (n) => `Check the vault's APY weekly and move only within the vault's own pages.`,
    },
  ],
  [
    /yield/i,
    {
      action: (n, c, ch) => `Deposit $${c} into ${n}'s highest-TVL strategy on ${ch} and keep the position open.`,
      cadence: (n) => `Claim or compound the yield once a week through the strategy's own page.`,
    },
  ],
  [
    /basis trading/i,
    {
      action: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s basis vault on ${ch} and hold the position.`,
      cadence: (n) => `Check the basis position weekly and keep it through a full funding cycle.`,
    },
  ],
  [
    /insurance/i,
    {
      action: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy active.`,
      cadence: (n) => `Review the cover weekly and renew it before it lapses.`,
    },
  ],
  [
    /stablecoin wrapper/i,
    {
      action: (n, c, ch) => `Wrap $${c} of the underlying asset through ${n} on ${ch} and hold the wrapped asset.`,
      cadence: (n) => `Check the peg weekly and unwrap only through the protocol's own page.`,
    },
  ],
  [
    /staking pool/i,
    {
      action: (n, c, ch) => `Stake $${c} through ${n}'s pool on ${ch} and keep the receipt.`,
      cadence: (n) => `Check the staking rewards weekly and restake them through the pool's own page.`,
    },
  ],
  [
    /governance incentive/i,
    {
      action: (n, c, ch) => `Lock $${c} in ${n}'s incentive program on ${ch} and keep the lock for the full period.`,
      cadence: (n) => `Vote or claim the incentive weekly through the program's own page.`,
    },
  ],
  [
    /derivative/i,
    {
      action: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedged position.`,
      cadence: (n) => `Adjust the hedge once a week and never leave the margin unmonitored.`,
    },
  ],
  [
    /privacy/i,
    {
      action: (n, c, ch) => `Deposit $${c} into a ${n} private pool on ${ch} and hold the shielded balance.`,
      cadence: (n) => `Use the shielded balance once a week and keep the disclosure key offline.`,
    },
  ],
  [
    /index/i,
    {
      action: (n, c, ch) => `Buy $${c} of ${n}'s index on ${ch} and hold it.`,
      cadence: (n) => `Check the index composition weekly and hold through a full rebalance.`,
    },
  ],
  [
    /prediction/i,
    {
      action: (n, c, ch) => `Fund $${c} and place one market position on ${n}.`,
      cadence: (n) => `Settle or roll the position weekly and keep the funds in the market.`,
    },
  ],
];

const DEFAULT_PLAY: CategoryPlay = {
  action: (n, c, ch) => `Deposit $${c} of USDC into ${n} on ${ch} and keep the position open.`,
  cadence: (n) => `Make one qualifying action each week, such as a deposit, a swap or a vote, through ${n}'s own app.`,
};

/** The play for one category: the first pattern that matches it, else the default. */
function playFor(category: string | null): CategoryPlay {
  const c = category ?? '';
  for (const [re, play] of PLAYS) if (re.test(c)) return play;
  return DEFAULT_PLAY;
}

/**
 * A protocol-specific main action and claim note, only where the protocol's own shape is
 * plain from its record: a payment layer with no token program, a chain that issues
 * another asset, a stablecoin, a staking system, a restaking program with points, or
 * tokenised property. Every other protocol uses its category's play.
 */
const OVERRIDES: Record<string, { action: (capital: number) => string; claim: string }> = {
  'lightning-network': {
    action: (c) => `Open a Lightning channel with $${c} of BTC and route a payment through it. Lightning Network is Bitcoin's payment layer and records no token program, so this farms use of the network, not a launch.`,
    claim: 'There is no token to claim for Lightning Network: the steps above are for using the network, and any page offering a Lightning token is not the protocol\'s own.',
  },
  noble: {
    action: (c) => `Hold $${c} of USDC on Noble and use it in a Cosmos app on the chain. Noble is the chain that issues native USDC and records no token of its own.`,
    claim: 'Noble records no token of its own, so there is nothing to claim: keep the USDC on the chain and use it in Cosmos apps.',
  },
  usdd: {
    action: (c) => `Mint or hold $${c} of USDD on Tron through the protocol's own app. USDD is itself a stablecoin, so a separate token launch is not recorded.`,
    claim: 'USDD is itself the protocol\'s stable asset: there is no separate launch to claim, so hold the stablecoin and watch the protocol\'s own announcements.',
  },
  'bittensor-dtao': {
    action: (c) => `Stake $${c} of TAO into a dTAO subnet through the protocol's own staking page and keep the stake.`,
    claim: 'Check the subnet\'s own rewards page for staking rewards, and claim only from the link the protocol publishes.',
  },
  symbiotic: {
    action: (c) => `Restake $${c} of ETH or a liquid staking token into a Symbiotic vault on Ethereum and keep the receipt.`,
    claim: 'Symbiotic has run a points program for restakers: open its own rewards page, confirm the points balance, and claim only from the link it publishes.',
  },
  lofty: {
    action: (c) => `Buy $${c} of a fractional Lofty property share on Algorand and hold it through a full rent cycle.`,
    claim: 'Collect the rent distributions the property pays, and check Lofty\'s own page before any sale.',
  },
};

/** Deterministic variant pick from a slug: same input, same wording, every run. */
function variantOf(slug: string, count: number): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % count;
}

/** The opening safety step, worded three ways so no two rows read identically. */
const WALLET_STEPS: ((name: string, chain: string) => string)[] = [
  () => 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
  (_name, chain) => `Set aside a fresh wallet for this farm alone, funded only with what you plan to use on ${chain}, and keep its seed phrase offline.`,
  (name) => `Open a new wallet just for ${name}, move in only the funds you plan to farm, and store its seed phrase offline.`,
];

/** The closing log step, worded three ways so no two rows read identically. */
const LOG_STEPS: string[] = [
  'Write the wallet, the dates and every transaction in a farm log. To unwind, withdraw in two tranches a week apart and keep the log until the position is fully closed.',
  'Keep a farm log of the wallet, the dates and every transaction. To unwind, exit in two tranches a week apart and keep the log until the position is fully closed.',
  'Record the wallet, the dates and every transaction in a farm log, and keep it until the position is fully closed; unwind by withdrawing in two tranches a week apart.',
];

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, built from the
 * protocol's own record. The snapshot carries no airdrop flag, so the claim step says
 * plainly when no points program is recorded, instead of inventing one.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalTier(p.tvl_usd);
  const hold = holdWindow(age);
  const play = playFor(p.category);
  const over = OVERRIDES[p.slug];
  const mainAction = over !== undefined ? over.action(capital) : play.action(p.name, capital, chain);
  const claimText =
    over !== undefined
      ? over.claim
      : `The snapshot records no points program for ${p.name}. Before you withdraw, check the protocol's own rewards page; if a program appears, claim only from the link the protocol itself publishes and never pay to claim.`;
  return [
    {
      text: WALLET_STEPS[variantOf(p.slug, WALLET_STEPS.length)]!(p.name, chain),
      cost: 'a few dollars of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: play.cadence(p.name),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: claimText,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: LOG_STEPS[variantOf(`${p.slug}:log`, LOG_STEPS.length)]!,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    category_multiple: number;
    multiple_peers: number;
    multiple_source: 'category' | 'global';
    size_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    tenure_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A launched protocol, for the dashboard's live-token view: the market's own value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  market_multiple: number;
  market_peers: number;
  category_multiples: { category: string; multiple: number; peers: number; source: 'category' | 'global' }[];
  /** The fitted constants, computed at runtime from the snapshot: the dashboard
   *  prints them next to the formula. */
  fit: {
    global_log_mean: number;
    global_multiple: number;
    tvl_center: number;
    slope: number;
    launched_peers: number;
    comparable_peers: number;
    interval_sd: number;
    interval_low: number;
    interval_high: number;
  };
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever the candidate rule says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every launch candidate below the floor, not just the biggest: the
  // radar exists to find them all, and the board is capped by the gate, not by a cut.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = valueProtocol(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    token_status: 'pre-token',
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.impliedLow,
    implied_high_usd: s.v.impliedHigh,
    model: {
      category_multiple: Math.round(s.v.multiple * 1e4) / 1e4,
      multiple_peers: s.v.multiplePeers,
      multiple_source: s.v.multipleSource,
      size_factor: Math.round(s.v.sizeFactor * 1e4) / 1e4,
      growth_pct: s.v.growthPct,
      growth_multiplier: Math.round(s.v.growthMult * 1e4) / 1e4,
      tenure_multiplier: Math.round(s.v.tenureMult * 1e4) / 1e4,
      age_days: s.v.age,
    },
    farm_steps: farmPlan(s.p, s.v.age).map(stepText),
  }));
}

/** The launched protocols, by market cap, for the dashboard's live-token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot.protocols);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    market_multiple: Math.round(model.globalMultiple * 1e4) / 1e4,
    market_peers: model.comparablePeers,
    category_multiples: [...model.byCategory.values()]
      .map((c) => ({ category: c.category, multiple: Math.round(c.multiple * 1e4) / 1e4, peers: c.peers, source: c.source }))
      .sort((a, b) => b.multiple - a.multiple),
    fit: {
      global_log_mean: Math.round(model.globalLogMean * 1000) / 1000,
      global_multiple: Math.round(model.globalMultiple * 10000) / 10000,
      tvl_center: Math.round(model.tvlCenter * 1000) / 1000,
      slope: Math.round(model.slope * 1000) / 1000,
      launched_peers: model.launchedPeers,
      comparable_peers: model.comparablePeers,
      interval_sd: Math.round(model.intervalSd * 1000) / 1000,
      interval_low: Math.round(model.intervalLow * 1000) / 1000,
      interval_high: Math.round(model.intervalHigh * 10) / 10,
    },
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network, the page reads window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
