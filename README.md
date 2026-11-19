# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ardimakefun/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ardimakefun/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar for make.fun's token-radar-01 bounty. It reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token, and ranks them by what a token would be worth if the protocol's record stayed as it is — then hands in a web dashboard that shows the board, a detail view for each protocol, and the steps to farm it.

The value model is a comparables model, not a TVL sort: each protocol's implied value is its TVL times the median market-cap / TVL of the launched protocols in its own category (at least three launched peers, else the market-wide median), adjusted by its seven-day TVL growth and by how long it has run with no token. The same function scores every row; no protocol name is ever special-cased. Farm plans are built from each protocol's own record (category, chains, TVL, age), with a cost and a time for every step; where the snapshot records no points program, the plan says so instead of inventing one.

The board covers all 40 watchlist protocols plus 138 early launch candidates below the $50M floor, 178 rows in all. The dashboard is a static page with no network: sortable and filterable board, a detail view per protocol with its model breakdown and farm plan, and the live-token protocols set aside at their market values.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with the vendored make.fun library. Run it twice and the outputs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0vh6bwht&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
