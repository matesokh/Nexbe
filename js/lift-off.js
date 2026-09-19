(() => {
  'use strict';

  const state = { balance: 1000, bet: 10, active: false, busy: false, multiplier: 1, peak: 1, crashAt: 0, timer: null };
  const session = { rounds: 0, wins: 0, losses: 0, wagered: 0, returned: 0, history: [], peaks: [] };
  const audio = { context: null, enabled: localStorage.getItem('nexbe-sound') !== 'off', volume: 0.65, trackTimer: null, trackStep: 0 };
  const $ = id => document.getElementById(id);
  const money = value => '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const el = { balance: $('balanceValue'), mini: $('miniBalance'), bet: $('betInput'), liveBet: $('liveBet'), payout: $('livePayout'), net: $('sessionNet'), status: $('panelStatus'), primary: $('primaryBtn'), cash: $('cashoutBtn'), cashVal: $('cashoutValue'), cashMult: $('cashoutMult'), flightStatus: $('flightStatus'), multiplier: $('multiplierValue'), peak: $('peakValue'), peakList: $('peakList'), value: $('flightValue'), vehicle: $('flightVehicle'), path: $('flightPath'), stage: $('flightStage'), hint: $('hintText'), rounds: $('sessionRounds'), wins: $('sessionWins'), losses: $('sessionLosses'), history: $('history'), count: $('historyCount'), modal: $('resultModal') };

  function update() {
    const payout = state.active ? state.bet * state.multiplier : 0;
    el.balance.textContent = money(state.balance); el.mini.textContent = money(state.balance) + ' available'; el.liveBet.textContent = money(state.bet); el.payout.textContent = money(payout); el.multiplier.textContent = state.multiplier.toFixed(2) + '×'; el.value.textContent = state.multiplier.toFixed(2) + '×'; el.cashVal.textContent = money(payout); el.cashMult.textContent = state.multiplier.toFixed(2) + '×'; el.peak.textContent = state.peak.toFixed(2) + '×'; el.cash.disabled = !state.active; el.rounds.textContent = session.rounds; el.wins.textContent = session.wins; el.losses.textContent = session.losses;
    const net = session.returned - session.wagered; el.net.textContent = (net >= 0 ? '+' : '−') + money(Math.abs(net));
  }

  function setHint(text, type = '') { el.hint.textContent = text; el.hint.className = `hint ${type}`; }

  function playSound(type) {
    if (!audio.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext; if (!AudioContext) return;
    audio.context ||= new AudioContext(); const now = audio.context.currentTime; const oscillator = audio.context.createOscillator(); const gain = audio.context.createGain(); oscillator.connect(gain); gain.connect(audio.context.destination); oscillator.type = type === 'crash' ? 'sawtooth' : 'triangle'; oscillator.frequency.setValueAtTime(type === 'crash' ? 110 : 340, now); oscillator.frequency.exponentialRampToValueAtTime(type === 'crash' ? 38 : 760, now + .25); gain.gain.setValueAtTime(.15 * audio.volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + .25); oscillator.start(now); oscillator.stop(now + .25);
  }

  function playTrackNote() {
    if (!audio.enabled || !audio.context) return;
    const notes = [220, 261.63, 329.63, 392, 523.25, 392, 329.63, 261.63];
    const now = audio.context.currentTime;
    const lead = audio.context.createOscillator();
    const leadGain = audio.context.createGain();
    const bass = audio.context.createOscillator();
    const bassGain = audio.context.createGain();
    const lift = Math.min(1.8, 1 + Math.max(0, state.multiplier - 1) * 0.12);
    lead.connect(leadGain); leadGain.connect(audio.context.destination);
    bass.connect(bassGain); bassGain.connect(audio.context.destination);
    lead.type = 'triangle';
    bass.type = 'sine';
    lead.frequency.setValueAtTime(notes[audio.trackStep % notes.length] * lift, now);
    bass.frequency.setValueAtTime(notes[audio.trackStep % 4] / 2, now);
    leadGain.gain.setValueAtTime(0.001, now);
    leadGain.gain.linearRampToValueAtTime(0.045 * audio.volume, now + 0.03);
    leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    bassGain.gain.setValueAtTime(0.001, now);
    bassGain.gain.linearRampToValueAtTime(0.04 * audio.volume, now + 0.02);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    lead.start(now); lead.stop(now + 0.3);
    bass.start(now); bass.stop(now + 0.4);
    audio.trackStep += 1;
  }

  function startTrack() {
    if (!audio.enabled || audio.trackTimer) return;
    audio.trackStep = 0;
    playTrackNote();
    audio.trackTimer = window.setInterval(playTrackNote, 360);
  }

  function stopTrack() {
    if (audio.trackTimer) window.clearInterval(audio.trackTimer);
    audio.trackTimer = null;
    el.stage.classList.remove('flight-active');
  }

  function randomCrashPoint() { return Math.max(1.05, 1 + (-Math.log(1 - Math.random()) * 2.2)); }
  function setFlightVisual() { const progress = Math.min(92, Math.max(4, (Math.log(state.multiplier) / Math.log(8)) * 92 + 4)); el.vehicle.style.left = `${progress}%`; el.vehicle.style.bottom = `${Math.min(86, 9 + progress * .72)}%`; el.value.style.left = `${Math.min(82, progress)}%`; el.value.style.bottom = `${Math.min(88, 15 + progress * .72)}%`; el.path.style.width = `${progress}%`; el.path.style.height = `${Math.min(80, progress * .72)}%`; }

  function startRound() {
    if (state.active || state.busy) return;
    const bet = Number.parseFloat(el.bet.value); if (!Number.isFinite(bet) || bet <= 0) return setHint('Enter a valid bet amount first.', 'lose'); if (bet > state.balance) return setHint('That bet is more than your available balance.', 'lose');
    state.bet = Math.round(bet * 100) / 100; state.balance -= state.bet; state.active = true; state.multiplier = 1; state.peak = 1; state.crashAt = randomCrashPoint(); session.wagered += state.bet; el.status.textContent = 'FLYING'; el.flightStatus.textContent = 'In flight'; el.primary.disabled = true; el.primary.querySelector('span').textContent = 'In flight…'; el.stage.classList.add('flight-active'); setHint('Watch the multiplier. Cash out before the flight ends.'); playSound('launch'); startTrack(); update();
    state.timer = window.setInterval(() => { state.multiplier = Math.min(state.crashAt, state.multiplier + .015 + state.multiplier * .012); state.peak = Math.max(state.peak, state.multiplier); setFlightVisual(); update(); if (state.multiplier >= state.crashAt) crash(); }, 80);
  }

  function recordPeak() { session.peaks.unshift(state.peak); session.peaks = session.peaks.slice(0, 8); renderPeaks(); }
  function renderPeaks() { el.peakList.innerHTML = session.peaks.length ? session.peaks.map((peak, index) => `<span class="peak-chip ${index === 0 ? 'latest' : ''}">${peak.toFixed(2)}×</span>`).join('') : '<span class="peak-empty">Completed flights will appear here.</span>'; }
  function crash() { if (!state.active) return; window.clearInterval(state.timer); state.timer = null; stopTrack(); state.active = false; state.busy = false; session.losses += 1; session.rounds += 1; recordPeak(); session.history.unshift({ bet: state.bet, multiplier: 0, payout: 0, result: 'LOSS' }); session.history = session.history.slice(0, 10); el.status.textContent = 'CRASHED'; el.flightStatus.textContent = 'Flight ended'; el.primary.disabled = false; el.primary.querySelector('span').textContent = 'New flight'; setHint(`The flight ended at ${state.crashAt.toFixed(2)}×.`, 'lose'); playSound('crash'); renderHistory(); update(); showResult(false, 0); }

  function cashOut() { if (!state.active || state.busy) return; state.busy = true; window.clearInterval(state.timer); state.timer = null; stopTrack(); const payout = state.bet * state.multiplier; state.balance += payout; session.wins += 1; session.rounds += 1; session.returned += payout; recordPeak(); session.history.unshift({ bet: state.bet, multiplier: state.multiplier, payout, result: 'WIN' }); session.history = session.history.slice(0, 10); state.active = false; state.busy = false; el.status.textContent = 'LANDED'; el.flightStatus.textContent = 'Landed safely'; el.primary.disabled = false; el.primary.querySelector('span').textContent = 'New flight'; setHint(`You landed with ${money(payout)} at ${state.multiplier.toFixed(2)}×.`, 'win'); playSound('cashout'); renderHistory(); update(); showResult(true, payout); }

  function resetRound() { window.clearInterval(state.timer); state.timer = null; stopTrack(); state.active = false; state.busy = false; state.multiplier = 1; state.peak = 1; el.status.textContent = 'READY'; el.flightStatus.textContent = 'Grounded'; el.primary.disabled = false; el.primary.querySelector('span').textContent = 'Launch'; el.path.style.width = '4%'; el.path.style.height = '0'; setFlightVisual(); setHint('Place your bet, then cash out before the flight ends.'); update(); }
  function renderHistory() { el.count.textContent = `${session.history.length} / 10`; el.history.innerHTML = session.history.length ? '<div class="history-row"><span>Bet</span><span>Result</span><span>Multiplier</span><span>Payout</span></div>' + session.history.map(item => `<div class="history-row"><strong>${money(item.bet)}</strong><span class="${item.result === 'WIN' ? 'win' : 'loss'}">${item.result}</span><span>${item.multiplier ? item.multiplier.toFixed(2) + '×' : '—'}</span><strong class="${item.result === 'WIN' ? 'win' : 'loss'}">${item.payout ? '+' + money(item.payout) : '−' + money(item.bet)}</strong></div>`).join('') : '<div class="empty-history">Your completed flights will appear here.</div>'; }
  function showResult(won, payout) { $('resultIcon').textContent = won ? '$' : '×'; $('resultKicker').textContent = won ? 'LANDED SAFELY' : 'FLIGHT ENDED'; $('resultTitle').textContent = won ? 'You won' : 'Flight crashed'; $('resultAmount').textContent = won ? '+' + money(payout) : '−' + money(state.bet); $('resultAmount').style.color = won ? 'var(--green)' : 'var(--red)'; $('resultBody').textContent = won ? 'Good timing. Your payout is locked in.' : 'The multiplier moved past your exit point.'; $('resultDetail').textContent = `${money(state.bet)} bet · ${won ? state.multiplier.toFixed(2) + '× payout' : state.crashAt.toFixed(2) + '× crash point'}`; el.modal.classList.remove('hidden'); }

  el.primary.addEventListener('click', startRound); el.cash.addEventListener('click', cashOut); $('playAgain').addEventListener('click', () => { el.modal.classList.add('hidden'); resetRound(); el.primary.focus(); }); $('modalClose').addEventListener('click', () => { el.modal.classList.add('hidden'); resetRound(); }); el.modal.addEventListener('click', event => { if (event.target === el.modal) { el.modal.classList.add('hidden'); resetRound(); } });
  $('betQuick').addEventListener('click', event => { const button = event.target.closest('button'); if (!button || state.active) return; const current = Number.parseFloat(el.bet.value) || state.bet; const value = button.dataset.action === 'max' ? state.balance : button.dataset.action === 'double' ? current * 2 : current / 2; el.bet.value = Math.min(state.balance, Math.max(.01, value)).toFixed(2); playSound('click'); }); $('betStepUp').addEventListener('click', () => { if (!state.active) el.bet.value = (Number(el.bet.value) + 1).toFixed(2); }); $('betStepDown').addEventListener('click', () => { if (!state.active) el.bet.value = Math.max(.01, Number(el.bet.value) - 1).toFixed(2); }); el.bet.addEventListener('input', () => { el.bet.value = el.bet.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); });
  const soundButton = $('soundBtn'); const settingsModal = $('settingsModal'); const syncSound = () => { soundButton.setAttribute('aria-pressed', audio.enabled); soundButton.textContent = audio.enabled ? '◉' : '◖'; }; syncSound(); soundButton.addEventListener('click', () => { audio.enabled = !audio.enabled; localStorage.setItem('nexbe-sound', audio.enabled ? 'on' : 'off'); if (!audio.enabled) stopTrack(); else if (state.active) startTrack(); syncSound(); }); $('settingsBtn').addEventListener('click', () => settingsModal.classList.remove('hidden')); $('settingsClose').addEventListener('click', () => settingsModal.classList.add('hidden')); settingsModal.addEventListener('click', event => { if (event.target === settingsModal) settingsModal.classList.add('hidden'); }); $('volumeInput').addEventListener('input', event => { audio.volume = Number(event.target.value); }); $('resetBalance').addEventListener('click', () => { if (!state.active) { state.balance = 1000; update(); } }); document.addEventListener('keydown', event => { if (event.key === 'Escape') { el.modal.classList.add('hidden'); settingsModal.classList.add('hidden'); } }); window.addEventListener('pagehide', stopTrack);
  setFlightVisual(); update(); renderHistory(); renderPeaks(); requestAnimationFrame(() => $('loadingScreen').classList.add('loaded'));
})();
