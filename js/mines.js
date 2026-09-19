(() => {
  'use strict';

  const GRID_SIZE = 25;
  const HOUSE_EDGE = 0.98;
  const state = { balance: 1000, bet: 10, mines: 3, active: false, busy: false, minePositions: new Set(), revealed: new Set(), multiplier: 1 };
  const session = { rounds: 0, wins: 0, losses: 0, wagered: 0, returned: 0, history: [] };
  const audio = { context: null, enabled: localStorage.getItem('nexbe-sound') !== 'off', volume: 0.65 };
  const $ = id => document.getElementById(id);
  const money = value => '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const safeCount = () => GRID_SIZE - state.mines;
  const factor = () => (GRID_SIZE / safeCount()) * HOUSE_EDGE;
  const el = { balance: $('balanceValue'), mini: $('miniBalance'), bet: $('betInput'), grid: $('minesGrid'), safe: $('safeValue'), safeReadout: $('safeReadout'), mult: $('multValue'), payout: $('livePayout'), liveBet: $('liveBet'), cash: $('cashoutBtn'), cashVal: $('cashoutValue'), cashMult: $('cashoutMult'), primary: $('primaryBtn'), hint: $('hintText'), status: $('roundStatus'), diff: $('diffToggle'), odds: $('oddsLabel'), history: $('history'), count: $('historyCount'), rounds: $('sessionRounds'), wins: $('sessionWins'), losses: $('sessionLosses'), net: $('sessionNet'), modal: $('resultModal') };

  function buildGrid() {
    el.grid.innerHTML = '';
    for (let index = 0; index < GRID_SIZE; index += 1) {
      const tile = document.createElement('button');
      tile.className = 'mine-tile';
      tile.type = 'button';
      tile.dataset.index = index;
      tile.setAttribute('aria-label', `Tile ${index + 1}`);
      el.grid.appendChild(tile);
    }
  }

  function update() {
    const payout = state.revealed.size ? state.bet * state.multiplier : 0;
    el.balance.textContent = money(state.balance);
    el.mini.textContent = money(state.balance) + ' available';
    el.liveBet.textContent = money(state.bet);
    el.safe.textContent = state.revealed.size;
    el.safeReadout.innerHTML = `${String(state.revealed.size).padStart(2, '0')} <small>/ ${safeCount()}</small>`;
    el.mult.textContent = state.multiplier.toFixed(2) + '×';
    el.payout.textContent = money(payout);
    el.cashVal.textContent = money(payout);
    el.cashMult.textContent = state.multiplier.toFixed(2) + '×';
    el.cash.disabled = !state.active || !state.revealed.size;
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
    const now = audio.context.currentTime;
    const oscillator = audio.context.createOscillator();
    const gain = audio.context.createGain();
    oscillator.connect(gain); gain.connect(audio.context.destination);
    oscillator.type = type === 'bomb' ? 'sawtooth' : 'triangle';
    oscillator.frequency.setValueAtTime(type === 'bomb' ? 90 : 420, now);
    oscillator.frequency.exponentialRampToValueAtTime(type === 'bomb' ? 35 : 760, now + (type === 'bomb' ? .35 : .16));
    gain.gain.setValueAtTime((type === 'bomb' ? .2 : .1) * audio.volume, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + (type === 'bomb' ? .35 : .16));
    oscillator.start(now); oscillator.stop(now + (type === 'bomb' ? .35 : .16));
  }

  function setLocked(locked) {
    [...el.diff.querySelectorAll('button'), ...document.querySelectorAll('.quick-bets button'), $('betStepUp'), $('betStepDown')].forEach(button => { button.disabled = locked; });
    el.bet.disabled = locked;
  }

  function placeMines() {
    state.minePositions = new Set();
    while (state.minePositions.size < state.mines) state.minePositions.add(Math.floor(Math.random() * GRID_SIZE));
  }

  function revealAll(hit = -1) {
    el.grid.querySelectorAll('.mine-tile').forEach(tile => {
      const index = Number(tile.dataset.index);
      if (state.minePositions.has(index)) {
        tile.classList.add('revealed', 'mine');
        if (index === hit) tile.classList.add('hit');
      } else {
        tile.classList.add('revealed', 'safe');
      }
    });
  }

  function resetRound() {
    state.active = false;
    state.busy = false;
    state.minePositions = new Set();
    state.revealed = new Set();
    state.multiplier = 1;
    el.status.textContent = 'READY';
    el.primary.disabled = false;
    el.primary.querySelector('span').textContent = 'Place bet';
    setLocked(false);
    buildGrid();
    update();
    setHint('Pick a bet and mine count, then reveal a tile.');
  }

  function startRound() {
    if (state.active || state.busy) return;
    const bet = Number.parseFloat(el.bet.value);
    if (!Number.isFinite(bet) || bet <= 0) return setHint('Enter a valid bet amount first.', 'lose');
    if (bet > state.balance) return setHint('That bet is more than your available balance.', 'lose');
    state.bet = Math.round(bet * 100) / 100;
    state.balance -= state.bet; state.active = true; state.revealed = new Set(); state.multiplier = 1; placeMines();
    session.wagered += state.bet; el.status.textContent = 'LIVE'; el.primary.disabled = true; el.primary.querySelector('span').textContent = 'Finding tiles…'; setLocked(true); buildGrid(); update(); setHint('The field is live. Find a safe tile.'); playSound('click');
  }

  function chooseTile(event) {
    if (!state.active || state.busy) return;
    const tile = event.target.closest('.mine-tile');
    if (!tile || tile.classList.contains('revealed')) return;
    state.busy = true;
    const index = Number(tile.dataset.index);
    if (state.minePositions.has(index)) { tile.classList.add('revealed', 'mine', 'hit'); playSound('bomb'); finish(false); return; }
    tile.classList.add('revealed', 'safe'); state.revealed.add(index); state.multiplier *= factor(); playSound('safe');
    if (state.revealed.size === safeCount()) { finish(true, true); return; }
    state.busy = false; setHint(`${safeCount() - state.revealed.size} safe tiles remain. Cash out or keep going.`, 'win'); update();
  }

  function finish(won, summit = false) {
    state.active = false; const payout = won ? state.bet * state.multiplier : 0;
    if (won) { state.balance += payout; session.wins += 1; session.returned += payout; } else session.losses += 1;
    session.rounds += 1; session.history.unshift({ bet: state.bet, multiplier: won ? state.multiplier : 0, payout, result: won ? 'WIN' : 'LOSS' }); session.history = session.history.slice(0, 10);
    revealAll(won ? -1 : [...state.minePositions][0]); el.primary.disabled = false; el.primary.querySelector('span').textContent = 'New round'; el.status.textContent = won ? 'COMPLETE' : 'BUSTED'; setLocked(false); state.busy = false;
    setHint(won ? `You cleared the field and locked ${money(payout)}.` : 'A mine was found. The bet is gone.', won ? 'win' : 'lose'); renderHistory(); update(); showResult(won, payout, summit);
  }

  function cashOut() { if (state.active && state.revealed.size && !state.busy) { state.busy = true; playSound('cashout'); finish(true); } }

  function renderHistory() {
    el.count.textContent = `${session.history.length} / 10`;
    el.history.innerHTML = session.history.length ? '<div class="history-row"><span>Bet</span><span>Result</span><span>Multiplier</span><span>Payout</span></div>' + session.history.map(item => `<div class="history-row"><strong>${money(item.bet)}</strong><span class="${item.result === 'WIN' ? 'win' : 'loss'}">${item.result}</span><span>${item.multiplier ? item.multiplier.toFixed(2) + '×' : '—'}</span><strong class="${item.result === 'WIN' ? 'win' : 'loss'}">${item.payout ? '+' + money(item.payout) : '−' + money(item.bet)}</strong></div>`).join('') : '<div class="empty-history">Your completed runs will appear here.</div>';
  }

  function showResult(won, payout, summit) {
    $('resultIcon').textContent = won ? '$' : '◆'; $('resultKicker').textContent = summit ? 'FIELD CLEARED' : won ? 'CASHED OUT' : 'ROUND OVER'; $('resultTitle').textContent = won ? 'You won' : 'Round lost'; $('resultAmount').textContent = won ? '+' + money(payout) : '−' + money(state.bet); $('resultAmount').style.color = won ? 'var(--green)' : 'var(--red)'; $('resultBody').textContent = won ? 'Good read. The payout is locked in.' : 'The field had one more surprise.'; $('resultDetail').textContent = `${money(state.bet)} bet · ${won ? state.multiplier.toFixed(2) + '× payout' : 'No return'}`; el.modal.classList.remove('hidden');
  }

  el.grid.addEventListener('click', chooseTile); el.primary.addEventListener('click', startRound); el.cash.addEventListener('click', cashOut);
  const soundButton = $('soundBtn'); const settingsModal = $('settingsModal');
  const syncSoundButton = () => { soundButton.setAttribute('aria-pressed', audio.enabled); soundButton.textContent = audio.enabled ? '◉' : '◖'; soundButton.setAttribute('aria-label', audio.enabled ? 'Turn sound off' : 'Turn sound on'); };
  syncSoundButton();
  $('settingsBtn').addEventListener('click', () => settingsModal.classList.remove('hidden')); $('settingsClose').addEventListener('click', () => settingsModal.classList.add('hidden')); settingsModal.addEventListener('click', event => { if (event.target === settingsModal) settingsModal.classList.add('hidden'); }); $('volumeInput').addEventListener('input', event => { audio.volume = Number(event.target.value); if (audio.enabled) playSound('click'); }); $('resetBalance').addEventListener('click', () => { if (!state.active) { state.balance = 1000; update(); playSound('cashout'); } });
  $('playAgain').addEventListener('click', () => { el.modal.classList.add('hidden'); resetRound(); el.primary.focus(); }); $('modalClose').addEventListener('click', () => el.modal.classList.add('hidden')); el.modal.addEventListener('click', event => { if (event.target === el.modal) el.modal.classList.add('hidden'); });
  el.diff.addEventListener('click', event => { const button = event.target.closest('button'); if (!button || state.active) return; state.mines = Number(button.dataset.mines); el.diff.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); el.odds.textContent = `${state.mines} mines · ${safeCount()} safe`; update(); });
  $('betQuick').addEventListener('click', event => { const button = event.target.closest('button'); if (!button || state.active) return; const currentBet = Number.parseFloat(el.bet.value) || state.bet; const value = button.dataset.action === 'max' ? state.balance : button.dataset.action === 'double' ? currentBet * 2 : currentBet / 2; el.bet.value = Math.min(state.balance, Math.max(.01, value)).toFixed(2); playSound('click'); });
  $('betStepUp').addEventListener('click', () => { if (!state.active) { el.bet.value = (Number(el.bet.value) + 1).toFixed(2); playSound('click'); } }); $('betStepDown').addEventListener('click', () => { if (!state.active) { el.bet.value = Math.max(.01, Number(el.bet.value) - 1).toFixed(2); playSound('click'); } }); el.bet.addEventListener('input', () => { el.bet.value = el.bet.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); }); soundButton.addEventListener('click', () => { audio.enabled = !audio.enabled; localStorage.setItem('nexbe-sound', audio.enabled ? 'on' : 'off'); syncSoundButton(); }); document.addEventListener('keydown', event => { if (event.key === 'Escape') { el.modal.classList.add('hidden'); settingsModal.classList.add('hidden'); } });
  el.odds.textContent = `${state.mines} mines · ${safeCount()} safe`; buildGrid(); update(); renderHistory(); requestAnimationFrame(() => $('loadingScreen').classList.add('loaded'));
})();
