// Browser UI: wires the game rules and question source to the page.
(function () {
  'use strict';

  const G = window.BrainBucksGame;
  const Q = window.BrainBucksQuestions;
  const BEST_KEY = 'brain-bucks-best';

  const $ = (id) => document.getElementById(id);
  const choiceButtons = [...document.querySelectorAll('.choice')];
  const upgradeCards = {};

  let state = null;
  let questions = null;
  let current = null;
  let answered = false;
  let startedAt = 0;
  let activeScreen = 'start';

  function show(name) {
    for (const s of ['start', 'play', 'shop', 'win']) $(s + '-screen').hidden = s !== name;
    activeScreen = name;
  }

  function startGame() {
    state = G.createGame();
    questions = Q.createQuestionSource();
    startedAt = Date.now();
    show('play');
    nextQuestion();
  }

  function nextQuestion() {
    if (state.won) return finish();
    current = questions.next();
    answered = false;
    $('prompt').textContent = current.prompt;
    choiceButtons.forEach((btn, i) => {
      btn.querySelector('.choice-text').textContent = current.choices[i];
      btn.disabled = false;
      btn.classList.remove('correct', 'wrong', 'dim');
    });
    $('feedback').hidden = true;
    updateHud();
  }

  function choose(index) {
    if (answered) return;
    answered = true;
    const result = G.answer(state, index === current.answerIndex);

    choiceButtons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === current.answerIndex) btn.classList.add('correct');
      else if (i === index) btn.classList.add('wrong');
      else btn.classList.add('dim');
    });

    const text = $('feedback-text');
    if (result.correct) {
      text.className = 'feedback-text good';
      text.textContent = `Correct! +${G.formatCash(result.delta)}` +
        (result.streak > 1 ? ` · ${result.streak} in a row 🔥` : '');
    } else {
      const answer = current.choices[current.answerIndex];
      text.className = 'feedback-text bad';
      text.textContent = `Not quite, it was ${answer}. ` +
        (result.delta < 0 ? G.formatCash(result.delta) : 'No cash lost.');
    }
    if (result.won) {
      text.textContent += ' 🎉 Goal reached!';
      $('next-btn').textContent = 'See results →';
    } else {
      $('next-btn').textContent = 'Next question →';
    }
    $('feedback-shop-btn').hidden = result.won;
    $('feedback').hidden = false;

    updateHud(result.delta);
    $('next-btn').focus();
  }

  function updateHud(delta = 0) {
    const pct = Math.min(100, Math.floor((state.cash / state.goal) * 100));
    $('cash').textContent = G.formatCash(state.cash);
    $('streak').textContent = state.streak;
    $('progress-fill').style.width = pct + '%';
    $('progress').setAttribute('aria-valuenow', pct);
    $('progress-text').textContent = pct + '%';
    $('shop-btn').hidden = state.won;

    if (delta !== 0) {
      const cash = $('cash');
      cash.classList.remove('up', 'down');
      void cash.offsetWidth; // restart the animation
      cash.classList.add(delta > 0 ? 'up' : 'down');
    }
  }

  function openShop() {
    if (state.won) return;
    renderShop();
    show('shop');
    $('back-btn').focus();
  }

  function closeShop() {
    show('play');
    updateHud();
    if (answered) $('next-btn').focus();
  }

  function buildShop() {
    for (const u of G.UPGRADES) {
      const card = document.createElement('div');
      card.className = 'card upgrade';
      card.innerHTML = `
        <h3></h3>
        <p class="muted desc"></p>
        <div class="pips" aria-hidden="true"></div>
        <p class="values"></p>
        <button class="btn primary buy"></button>`;
      card.querySelector('h3').textContent = u.name;
      card.querySelector('.desc').textContent = u.description;
      card.querySelector('.buy').addEventListener('click', () => {
        if (G.buy(state, u.id)) renderShop();
      });
      $('upgrades').appendChild(card);
      upgradeCards[u.id] = card;
    }
  }

  function renderShop() {
    $('shop-cash').textContent = G.formatCash(state.cash);
    $('shop-reward').textContent = G.formatCash(G.rewardFor(state));

    for (const u of G.UPGRADES) {
      const card = upgradeCards[u.id];
      const level = state.levels[u.id];
      const next = G.nextLevel(state, u.id);
      const now = u.format(u.levels[level].value);

      card.querySelector('.pips').innerHTML = u.levels
        .slice(1)
        .map((_, i) => `<span class="pip${i < level ? ' on' : ''}"></span>`)
        .join('');
      card.querySelector('.values').innerHTML = next
        ? `<span>${now}</span> → <strong>${u.format(next.value)}</strong>`
        : `<strong>${now}</strong> (max)`;

      const buy = card.querySelector('.buy');
      buy.textContent = next ? `Buy for ${G.formatCash(next.cost)}` : 'Maxed out';
      buy.disabled = !G.canBuy(state, u.id);
      card.classList.toggle('affordable', G.canBuy(state, u.id));
    }
  }

  function finish() {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    $('win-goal').textContent = G.formatCash(state.goal);
    $('stat-time').textContent = formatTime(seconds);
    $('stat-questions').textContent = state.answered;
    $('stat-accuracy').textContent = Math.round((state.correct / state.answered) * 100) + '%';
    $('stat-streak').textContent = state.bestStreak;

    const best = loadBest();
    const isRecord = best === null || seconds < best;
    if (isRecord) saveBest(seconds);
    $('record-text').hidden = !isRecord;
    show('win');
    $('again-btn').focus();
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  // Storage can be unavailable (private mode, blocked site data); the game works without it.
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  function saveBest(seconds) {
    try {
      localStorage.setItem(BEST_KEY, String(seconds));
    } catch {
      // ignore
    }
  }

  function showStart() {
    const best = loadBest();
    $('best-text').hidden = best === null;
    if (best !== null) $('best-text').textContent = `Your best time: ${formatTime(best)}`;
    show('start');
    $('start-btn').focus();
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (activeScreen === 'play') {
      if (!answered && key >= '1' && key <= '4') {
        e.preventDefault();
        choose(Number(key) - 1);
      } else if (key === 's') {
        openShop();
      }
    } else if (activeScreen === 'shop' && (key === 's' || key === 'escape')) {
      closeShop();
    }
  }

  choiceButtons.forEach((btn, i) => btn.addEventListener('click', () => choose(i)));
  $('start-btn').addEventListener('click', startGame);
  $('again-btn').addEventListener('click', startGame);
  $('next-btn').addEventListener('click', nextQuestion);
  $('shop-btn').addEventListener('click', openShop);
  $('feedback-shop-btn').addEventListener('click', openShop);
  $('back-btn').addEventListener('click', closeShop);
  document.addEventListener('keydown', onKey);

  const goal = G.formatCash(G.DEFAULT_GOAL);
  $('goal-text').textContent = goal;
  $('goal-label').textContent = goal;
  buildShop();
  showStart();
})();
