# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ardimakefun/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ardimakefun/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar for make.fun's token-radar-01 bounty. It reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token, and ranks them by what a token would be worth if the protocol's record stayed as it is — then hands in a web dashboard that shows the board, a detail view for each protocol, and the steps to farm it.

The value model is a fitted comparables model (radar-fit-1), not a TVL sort and not a hand-tuned formula: the program fits the model at runtime from the sealed snapshot's own launched protocols, in log space (y = log(market-cap / TVL)). The peer set is the 88 launched protocols that pass the watchlist exclusion rules, ignoring the token test. Their log-ratios are clipped to [−4, +2] before fitting; each category's multiple is its shrunk log-mean (k = 5 toward the global log-mean), and a size factor exp(slope × (log TVL − TVL centre)) carries the one stable slope. Implied value = TVL × exp(category estimate + slope × (log TVL − centre)). Fitted at runtime from the 2026-11-14 snapshot: global log-mean −1.424 (multiple 0.2406×), TVL centre 17.709, logTVL slope −0.368 — so market cap scales as TVL^0.63. The same function scores every row; no protocol name is ever special-cased. Farm plans are built from each protocol's own record (category, chains, TVL, age), with a cost and a time for every step; where the snapshot records no points program, the plan says so instead of inventing one.

Growth and age carry weight 0, by design and with the evidence on the dashboard: the fitted growth slope is −3.82 but falls to −0.31 when the five highest-ratio protocols are dropped (the two highest ratios, rain 400× and nexo 69×, both sit on a 7-day TVL change of about −37% — a denominator artefact of a collapsing TVL), and age has no measurable effect (correlation +0.002; fitted slope ≈ 0 once the five highest ratios are dropped). Both figures are still shown for every row, with multipliers of 1.0000.

Validation (5-fold cross-validation, protocol-level folds, every fit retrained on the train fold only, scored out of sample on the raw target): the fitted model reaches log-RMSE 2.106, log-MAE 1.604, median absolute percentage error 86.3%, against v1's 2.386 / 1.788 / 91.9% (paired MSE difference +1.260 ± 0.428, t = +2.94) and a naive global median's 2.277. The unwinsorized twin of the model is statistically identical (paired MSE −0.008 ± 0.081, t = −0.10); the winsorized fit is adopted because it caps the thin-category fragility — the highest effective multiple on the board is 0.922×, where the unwinsorized fit reaches 1.633× on a single-peer category. Every row carries an 80% interval of ×0.075–×13.3, from the out-of-sample residual SD of 2.016 log units on comparable protocols. The interval is wide because the multiple is genuinely hard to predict (in-sample R² 0.186); the dashboard says so plainly.

Thin categories, disclosed: Risk Curators — ranks #1–3, #6, #8–9, #11, #13 — rests on exactly one comparable peer (api3, 2.975×), and 89 of 178 rows sit in categories with two or fewer comparable peers. The dashboard shows the cleaned peer count next to every category multiple.

The board covers all 40 watchlist protocols plus 138 early launch candidates below the $50M floor, 178 rows in all. Top 5: Steakhouse Financial $228.6M, Gauntlet $160.8M, nonce-capital $79.2M, bittensor-dtao $59.2M, usdd $57.0M. Against v1 the ranking shifts with Spearman rho 0.850 and top-10 overlap 7/10. The dashboard is a static page with no network: sortable and filterable board, a detail view per protocol with its model breakdown and farm plan, the live-token protocols set aside at their market values, and a validation panel with the formula, the cross-validation table, the interval, and the growth/age explanation.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with the vendored make.fun library. Run it twice and the outputs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0vh6bwht&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
