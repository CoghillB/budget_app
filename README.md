# 💰 Budget Quest

A fun, neon-themed budget tracker. No backend, no signup — just open `index.html` in a browser.

## Features

- **Budget categories** with animated progress bars that glow as you spend.
- **Over-budget alerts** — bars pulse red, the page shakes, and a warning toast pops up.
- **Sub-budgets** inside each category for finer tracking (e.g. "Food → Groceries / Eating Out").
- **Income tracker** with confetti when you add some.
- **Monthly reset** — start a new month and your categories carry over with $0 spent.
- **History** — flip back through previous months as read-only snapshots.
- **Custom icons & colors** per category.
- **Animated particle background** + glassmorphism + shimmer + shake effects.
- All data stored locally in `localStorage`. Your numbers never leave your machine.

## Run it

Just open `index.html` in any modern browser. That's it.

```bash
# macOS
open index.html

# Linux
xdg-open index.html

# Or serve locally with any static server
python3 -m http.server 8000
```

## Files

- `index.html` — markup
- `styles.css` — theme & animations
- `app.js` — state, rendering, effects (vanilla JS, no dependencies)
