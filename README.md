# Brain Bucks 💰

A simple quiz game in the style of Gimkit: answer questions to earn cash, spend it on upgrades, and race to **$10,000**.

## Play

Open `index.html` in a browser. No install or build step is needed.

- ✅ A right answer earns cash and grows your streak 🔥.
- ❌ A wrong answer costs some cash and resets your streak.
- 🛒 The shop sells four upgrades, each with four levels:
  - **Money per Answer**: more base cash per right answer.
  - **Streak Bonus**: extra cash for every answer already in your streak.
  - **Multiplier**: multiplies everything you earn.
  - **Insurance**: shrinks what you lose on a wrong answer.
- ⌨️ Keys: `1`–`4` to answer, `Enter` for the next question, `S` to open or close the shop, `Esc` to leave the shop.

Questions mix a trivia deck with generated arithmetic, so you never run out. Your best time is saved in the browser.

## Develop

```sh
npm test   # runs the rule and question tests with Node's built-in test runner
```

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout and styles |
| `src/game.js` | Game rules: cash, upgrades, streaks, the win condition (no DOM) |
| `src/questions.js` | Trivia deck and arithmetic question generator |
| `src/main.js` | Connects the rules to the page |

To add trivia, append `[prompt, correctAnswer, wrong1, wrong2, wrong3]` to `TRIVIA` in `src/questions.js`. To tune the pace, edit the upgrade `levels` or `DEFAULT_GOAL` in `src/game.js`.
