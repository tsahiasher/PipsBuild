<p align="center"><img src="icon.jpg" alt="Pips Build" width="200"></p>

# Pips Build

Pips Build turns a screenshot of a Pips-style domino logic puzzle into a board you can play in the browser.

1. Upload, paste, or drag in a screenshot (phone or desktop capture).
2. The app reads the board, regions, conditions and domino tray on your device. Nothing is uploaded anywhere.
3. Check the result, optionally over the original screenshot with an opacity slider, and fix anything that's wrong.
4. Play: drag dominoes from the tray onto the board until every condition is met. A timer runs while you solve.

There's no screenshot? Use **Build manually** to draw the board, regions, conditions and dominoes yourself. Any puzzle can be saved to a JSON file from the check/edit screen and loaded again with **Import puzzle file**.

The app has no server, account, database or network calls. Progress is saved in the browser's local storage.

## Run

```
npm install
npm run dev      # development server
npm run build    # static build in dist/ (open with any static file host)
npm test         # unit tests (game engine + screenshot recognition)
```
