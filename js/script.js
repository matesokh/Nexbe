(() => {
  'use strict';

  const FLOORS = 8;
  const HOUSE_EDGE = 0.98;
  const DIFFICULTIES = {
    easy: { tiles: 4, bombs: 1 },
    medium: { tiles: 3, bombs: 1 },
    hard: { tiles: 2, bombs: 1 }
  };

  const state = {
    balance: 1000,
    bet: 10,
    difficulty: 'easy',
    active: false,
    busy: false,
    currentFloor: 0,
    multiplier: 1,
    bombs: []
  };
  const session = { rounds: 0, wins: 0, losses: 0, wagered: 0, returned: 0, history: [] };
  const savedVolume = localStorage.getItem('nexbe-volume');
  const audio = { context: null, enabled: localStorage.getItem('nexbe-sound') !== 'off', volume: savedVolume === null ? 0.65 : Math.max(0, Math.min(1, Number(savedVolume))) };
  const $ = id => document.getElementById(id);
  const money = value => '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const factor = () => { const d = DIFFICULTIES[state.difficulty]; return (d.tiles / (d.tiles - d.bombs)) * HOUSE_EDGE; };
  const el = { balance: $('balanceValue'), mini: $('miniBalance'), tower: $('tower'), bet: $('betInput'), floor: $('floorValue'), readout: $('floorReadout'), mult: $('multValue'), payout: $('livePayout'), liveBet: $('liveBet'), cash: $('cashoutBtn'), cashVal: $('cashoutValue'), cashMult: $('cashoutMult'), primary: $('primaryBtn'), hint: $('hintText'), status: $('roundStatus'), diff: $('diffToggle'), odds: $('oddsLabel'), history: $('history'), count: $('historyCount'), rounds: $('sessionRounds'), wins: $('sessionWins'), losses: $('sessionLosses'), net: $('sessionNet'), modal: $('resultModal') };

  function buildTower() {
    const difficulty = DIFFICULTIES[state.difficulty];
    $('betQuick').querySelector('[data-action="double"]').textContent = '2x';
    let multiplier = 1;
    el.tower.innerHTML = '';
    el.tower.style.flexDirection = 'column-reverse';
    for (let floor = 1; floor <= FLOORS; floor += 1) {
      multiplier *= factor();
      const row = document.createElement('div');
      row.className = 'floor locked';
      row.dataset.floor = floor;
      const badge = document.createElement('div');
      badge.className = 'floor-badge';
      badge.textContent = String(floor).padStart(2, '0');
      const tiles = document.createElement('div');
      tiles.className = 'tiles';
      tiles.style.gridTemplateColumns = `repeat(${difficulty.tiles}, 1fr)`;
      for (let index = 0; index < difficulty.tiles; index += 1) {
        const tile = document.createElement('button');
        tile.className = 'tile';
        tile.type = 'button';
        tile.dataset.floor = floor;
        tile.dataset.index = index;
        tile.setAttribute('aria-label', `Floor ${floor}, tile ${index + 1}`);
        tiles.appendChild(tile);
      }
      const multiplierLabel = document.createElement('div');
      multiplierLabel.className = 'floor-mult';
      multiplierLabel.textContent = multiplier.toFixed(2) + '×';
      row.append(badge, tiles, multiplierLabel);
      el.tower.appendChild(row);
    }
    refreshFloors();
  }

  function refreshFloors() {
    el.tower.querySelectorAll('.floor').forEach(row => {
      const floor = Number(row.dataset.floor);
      const status = !state.active ? 'locked' : floor <= state.currentFloor ? 'cleared' : floor === state.currentFloor + 1 ? 'current' : 'locked';
      row.className = `floor ${status}`;
    });
  }

  function update() {
    const payout = state.currentFloor ? state.bet * state.multiplier : 0;
    el.balance.textContent = money(state.balance);
    el.mini.textContent = money(state.balance) + ' available';
    el.liveBet.textContent = money(state.bet);
    el.floor.textContent = `${state.currentFloor} / ${FLOORS}`;
    el.readout.innerHTML = `${String(Math.min(state.currentFloor + 1, FLOORS)).padStart(2, '0')} <small>/ 08</small>`;
    el.mult.textContent = state.multiplier.toFixed(2) + '×';
    el.payout.textContent = money(payout);
    el.cashVal.textContent = money(payout);
    el.cashMult.textContent = state.multiplier.toFixed(2) + '×';
    el.cash.disabled = !state.active || state.currentFloor === 0;
    el.rounds.textContent = session.rounds;
    el.wins.textContent = session.wins;
    el.losses.textContent = session.losses;
    const net = session.returned - session.wagered;
    el.net.textContent = (net >= 0 ? '+' : '−') + money(Math.abs(net));
  }

  function setHint(text, type = '') { el.hint.textContent = text; el.hint.className = `hint ${type}`; }
  function playSound(type) {
    if (!audio.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audio.context ||= new AudioContext();
    const context = audio.context;
    if (context.state === 'suspended') {
      context.resume().then(() => playSound(type));
      return;
    }
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    if (type === 'click') {
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(180, now);
      gain.gain.setValueAtTime(0.08 * audio.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      oscillator.start(now);
      oscillator.stop(now + 0.06);
      return;
    }
    if (type === 'bomb') {
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(110, now);
      oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.45);
      gain.gain.setValueAtTime(0.28 * audio.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      oscillator.start(now);
      oscillator.stop(now + 0.45);
      return;
    }
    if (type === 'cashout' || type === 'summit') {
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(type === 'summit' ? 520 : 380, now);
      oscillator.frequency.exponentialRampToValueAtTime(type === 'summit' ? 1040 : 760, now + 0.24);
      gain.gain.setValueAtTime(0.2 * audio.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      oscillator.start(now);
      oscillator.stop(now + 0.24);
      return;
    }
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, now);
    oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.16);
    gain.gain.setValueAtTime(0.2 * audio.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
  }
  function setLocked(locked) {
    [...el.diff.querySelectorAll('button'), ...document.querySelectorAll('.quick-bets button'), $('betStepUp'), $('betStepDown')].forEach(button => { button.disabled = locked; });
    el.bet.disabled = locked;
  }
  function reveal(row, bomb, hit) {
    row.querySelectorAll('.tile').forEach(tile => {
      const index = Number(tile.dataset.index);
      if (tile.classList.contains('flipped')) return;
      tile.classList.add('flipped', 'revealed', index === bomb ? 'bomb' : 'safe');
      if (index === hit) tile.classList.add('hit');
    });
  }

  function startRound() {
    if (state.active || state.busy) return;
    const bet = Number.parseFloat(el.bet.value);
    if (!Number.isFinite(bet) || bet <= 0) return setHint('Enter a valid bet amount first.', 'lose');
    if (bet > state.balance) return setHint('That bet is more than your available balance.', 'lose');
    playSound('click');
    state.bet = Math.round(bet * 100) / 100;
    state.balance -= state.bet;
    state.active = true;
    state.currentFloor = 0;
    state.multiplier = 1;
    state.bombs = [];
    session.wagered += state.bet;
    el.status.textContent = 'LIVE';
    el.primary.disabled = true;
    el.primary.querySelector('span').textContent = 'Climbing…';
    setLocked(true);
    buildTower();
    update();
    setHint('Floor 1 is live. Find a safe tile to climb.');
  }

  function chooseTile(event) {
    if (!state.active || state.busy) return;
    const tile = event.target.closest('.tile');
    if (!tile || Number(tile.dataset.floor) !== state.currentFloor + 1) return;
    state.busy = true;
    const floor = Number(tile.dataset.floor);
    const index = Number(tile.dataset.index);
    const bomb = state.bombs[floor - 1];
    if (typeof bomb !== 'number') {
      const difficulty = DIFFICULTIES[state.difficulty];
      state.bombs[floor - 1] = Math.floor(Math.random() * difficulty.tiles);
    }
    const floorBomb = state.bombs[floor - 1];
    const row = tile.closest('.floor');
    playSound('click');
    tile.classList.add('flipped');
    if (index === floorBomb) {
      playSound('bomb');
      tile.classList.add('bomb', 'hit');
      row.classList.add('exploded');
      reveal(row, floorBomb, index);
      finish(false, floor);
      return;
    }
    tile.classList.add('safe');
    playSound('hit');
    state.currentFloor += 1;
    state.multiplier *= factor();
    refreshFloors();
    update();
    if (state.currentFloor === FLOORS) return finish(true, FLOORS, true);
    setHint(`Floor ${state.currentFloor + 1} is ready. Climb or cash out.`, 'win');
    state.busy = false;
  }

  function finish(won, floor, summit = false) {
    state.active = false;
    if (summit) playSound('summit');
    const payout = won ? state.bet * state.multiplier : 0;
    if (won) { state.balance += payout; session.wins += 1; session.returned += payout; } else session.losses += 1;
    session.rounds += 1;
    session.history.unshift({ bet: state.bet, multiplier: won ? state.multiplier : 0, payout, result: won ? 'WIN' : 'LOSS' });
    session.history = session.history.slice(0, 10);
    el.tower.querySelectorAll('.floor').forEach((row, index) => {
      const floorNumber = index + 1;
      if (!won || floorNumber <= state.currentFloor) {
        if (typeof state.bombs[index] !== 'number') {
          const difficulty = DIFFICULTIES[state.difficulty];
          state.bombs[index] = Math.floor(Math.random() * difficulty.tiles);
        }
        reveal(row, state.bombs[index], floorNumber === floor ? state.bombs[index] : -1);
      }
    });
    el.primary.disabled = false;
    el.primary.querySelector('span').textContent = 'New round';
    el.status.textContent = won ? 'COMPLETE' : 'BUSTED';
    setLocked(false);
    state.busy = false;
    setHint(won ? `You locked ${money(payout)} at ${state.multiplier.toFixed(2)}×.` : `Floor ${floor} was dangerous. The bet is gone.`, won ? 'win' : 'lose');
    renderHistory();
    update();
    showResult(won, payout, summit);
  }

  function cashOut() { if (state.active && state.currentFloor && !state.busy) { state.busy = true; playSound('cashout'); finish(true, state.currentFloor); } }
  function renderHistory() {
    el.count.textContent = `${session.history.length} / 10`;
    el.history.innerHTML = session.history.length ? '<div class="history-row"><span>Bet</span><span>Result</span><span>Multiplier</span><span>Payout</span></div>' + session.history.map(item => `<div class="history-row"><strong>${money(item.bet)}</strong><span class="${item.result === 'WIN' ? 'win' : 'loss'}">${item.result}</span><span>${item.multiplier ? item.multiplier.toFixed(2) + '×' : '—'}</span><strong class="${item.result === 'WIN' ? 'win' : 'loss'}">${item.payout ? '+' + money(item.payout) : '−' + money(item.bet)}</strong></div>`).join('') : '<div class="empty-history">Your completed runs will appear here.</div>';
  }
  function showResult(won, payout, summit) {
    $('resultIcon').textContent = won ? '$' : '💣';
    $('resultKicker').textContent = summit ? 'SUMMIT REACHED' : won ? 'CASHED OUT' : 'ROUND OVER';
    $('resultTitle').textContent = won ? 'You won' : 'Round lost';
    $('resultAmount').textContent = won ? '+' + money(payout) : '−' + money(state.bet);
    $('resultAmount').style.color = won ? 'var(--green)' : 'var(--red)';
    $('resultBody').textContent = won ? (summit ? 'Perfect run. You reached the summit.' : 'Good read. The payout is locked in.') : 'The next floor was not yours this time.';
    $('resultDetail').textContent = `${money(state.bet)} bet · ${won ? state.multiplier.toFixed(2) + '× payout' : 'No return'}`;
    el.modal.classList.remove('hidden');
  }

  el.tower.addEventListener('click', chooseTile);
  el.primary.addEventListener('click', startRound);
  el.cash.addEventListener('click', cashOut);
  const soundButton = $('soundBtn');
  const settingsModal = $('settingsModal');
  const syncSoundButton = () => {
    soundButton.setAttribute('aria-pressed', audio.enabled);
    soundButton.textContent = audio.enabled ? '◉' : '◖';
    soundButton.setAttribute('aria-label', audio.enabled ? 'Turn sound off' : 'Turn sound on');
  };
  syncSoundButton();
  $('settingsBtn').addEventListener('click', () => { settingsModal.classList.remove('hidden'); $('volumeInput').value = audio.volume; });
  $('settingsClose').addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.addEventListener('click', event => { if (event.target === settingsModal) settingsModal.classList.add('hidden'); });
  $('volumeInput').addEventListener('input', event => { audio.volume = Number(event.target.value); localStorage.setItem('nexbe-volume', audio.volume); if (audio.enabled) playSound('click'); });
  $('resetBalance').addEventListener('click', () => { if (state.active) return; state.balance = 1000; update(); playSound('cashout'); });
  $('playAgain').addEventListener('click', () => { playSound('click'); el.modal.classList.add('hidden'); buildTower(); update(); el.primary.focus(); });
  $('modalClose').addEventListener('click', () => el.modal.classList.add('hidden'));
  el.modal.addEventListener('click', event => { if (event.target === el.modal) el.modal.classList.add('hidden'); });
  el.diff.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || state.active) return;
    state.difficulty = button.dataset.diff;
    el.diff.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    const difficulty = DIFFICULTIES[state.difficulty];
    el.odds.textContent = `${difficulty.tiles - difficulty.bombs} safe · ${difficulty.bombs} danger`;
    buildTower();
  });
  $('betQuick').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || state.active) return;
    playSound('click');
    const currentBet = Number.parseFloat(el.bet.value) || state.bet;
    const value = button.dataset.action === 'max' ? state.balance : button.dataset.action === 'double' ? currentBet * 2 : currentBet / 2;
    el.bet.value = Math.min(state.balance, Math.max(0.01, value)).toFixed(2);
  });
  $('betStepUp').addEventListener('click', () => { if (!state.active) { playSound('click'); el.bet.value = (Number(el.bet.value) + 1).toFixed(2); } });
  $('betStepDown').addEventListener('click', () => { if (!state.active) { playSound('click'); el.bet.value = Math.max(0.01, Number(el.bet.value) - 1).toFixed(2); } });
  el.bet.addEventListener('input', () => { el.bet.value = el.bet.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); });
  soundButton.addEventListener('click', event => { const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true'; audio.enabled = enabled; localStorage.setItem('nexbe-sound', enabled ? 'on' : 'off'); syncSoundButton(); if (enabled) playSound('hit'); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { el.modal.classList.add('hidden'); settingsModal.classList.add('hidden'); } });

  buildTower();
  update();
  renderHistory();
  requestAnimationFrame(() => $('loadingScreen').classList.add('loaded'));
})();
