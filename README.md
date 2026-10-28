# Land of Memes

**The memes you love, mapped as land.**

[![Live site](https://img.shields.io/badge/live%20site-landofmemes.fun-fbfbfb?style=flat&labelColor=070506)](https://landofmemes.fun)
[![Chain](https://img.shields.io/badge/chain-Solana-fbfbfb?style=flat&labelColor=070506)](https://solana.com)

| | |
|---|---|
| Chain | Solana |
| Contract address | pending |

## Overview

Land of Memes is a Solana meme project with a landing site that carries a live market board: the ten Solana tokens moving the most volume right now, a scrolling ticker, and a record board that shows which project facts are confirmed and which are still pending.

## Features

- Live board of the top ten Solana tokens by 24h volume (price, change, volume, liquidity, copy-address button)
- Ticker driven by the same feed, refreshed every minute while the tab is visible
- Contract address slot pinned to the top of the page, inert until the address is announced
- Social icons in the header, inert until the channels are announced
- Reduced-motion support across every animation

## Links

- Website: https://landofmemes.fun
- X: pending
- GitHub: pending

## Development

```bash
npm run assets   # regenerate logo sizes, palette and favicon from brand/
npm run build    # src/ -> dist/
npm run gates    # build checks, exit 0 on success
npm run serve    # preview dist/ on port 5173
```

Deploy by uploading the `dist/` folder.

## License

MIT, see [LICENSE](LICENSE).
