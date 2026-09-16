(function(){
  const FLOORS = 8;
  const DIFFICULTIES = {
    easy:   { tiles: 4, bombs: 1, label: "Easy" },
    medium: { tiles: 3, bombs: 1, label: "Medium" },
    hard:   { tiles: 2, bombs: 1, label: "Hard" }
  };
  const HOUSE_EDGE = 0.98;

  let state = {
    balance: 1000,
    bet: 10,
    difficulty: "easy",
    active: false,
    currentFloor: 0,
    bombIndex: [],
    floorMultiplier: 1,
    cumulativeMult: 1
  };

  let session = {
    rounds: 0,
    wins: 0,
    losses: 0,
    wagered: 0,
    returned: 0
  };

  const el = {
    balance: document.getElementById('balanceValue'),
    tower: document.getElementById('tower'),
    floorValue: document.getElementById('floorValue'),
    multValue: document.getElementById('multValue'),
    payoutValue: document.getElementById('payoutValue'),
    primaryBtn: document.getElementById('primaryBtn'),
    cashoutBtn: document.getElementById('cashoutBtn'),
    hintText: document.getElementById('hintText'),
    betInput: document.getElementById('betInput'),
    diffToggle: document.getElementById('diffToggle'),
    betQuick: document.getElementById('betQuick'),
    betStepUp: document.getElementById('betStepUp'),
    betStepDown: document.getElementById('betStepDown')
  };

  function fmt(n){
    return "$" + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function floorFactor(){
    const d = DIFFICULTIES[state.difficulty];
    return (d.tiles / (d.tiles - d.bombs)) * HOUSE_EDGE;
  }

  function svgGem(){
    return '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2 L20 9 L12 22 L4 9 Z" fill="#E8C46B" stroke="#C9A227" stroke-width="1"/></svg>';
  }
  function svgMine(){
    return '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="5.5" fill="#C24A32"/><g stroke="#C24A32" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7.5" y2="7.5"/><line x1="16.5" y1="16.5" x2="19.1" y2="19.1"/><line x1="19.1" y1="4.9" x2="16.5" y2="7.5"/><line x1="7.5" y1="16.5" x2="4.9" y2="19.1"/></g></svg>';
  }

  function buildTower(){
    el.tower.innerHTML = "";
    const d = DIFFICULTIES[state.difficulty];
    let cumulative = 1;
    const mults = [];
    for(let f=1; f<=FLOORS; f++){
      cumulative *= floorFactor();
      mults.push(cumulative);
    }

    for(let f=1; f<=FLOORS; f++){
      const floorDiv = document.createElement('div');
      floorDiv.className = 'floor locked';
      floorDiv.dataset.floor = f;

      const badge = document.createElement('div');
      badge.className = 'floor-badge';
      badge.textContent = String(f).padStart(2,'0');

      const tilesWrap = document.createElement('div');
      tilesWrap.className = 'tiles';
      tilesWrap.style.gridTemplateColumns = `repeat(${d.tiles}, 1fr)`;

      for(let t=0; t<d.tiles; t++){
        const tileBtn = document.createElement('button');
        tileBtn.className = 'tile';
        tileBtn.dataset.floor = f;
        tileBtn.dataset.index = t;
        tileBtn.innerHTML = `
          <div class="tile-inner">
            <div class="tile-face back"></div>
            <div class="tile-face front"></div>
          </div>`;
        tileBtn.addEventListener('click', onTileClick);
        tilesWrap.appendChild(tileBtn);
      }

      const multDiv = document.createElement('div');
      multDiv.className = 'floor-mult';
      multDiv.textContent = mults[f-1].toFixed(2) + '×';

      floorDiv.appendChild(badge);
      floorDiv.appendChild(tilesWrap);
      floorDiv.appendChild(multDiv);
      el.tower.appendChild(floorDiv);
    }
    refreshFloorStates();
  }

  function refreshFloorStates(){
    const rows = el.tower.querySelectorAll('.floor');
    rows.forEach(row=>{
      const f = parseInt(row.dataset.floor,10);
      row.classList.remove('locked','current','cleared','exploded');
      if(!state.active){
        row.classList.add('locked');
        return;
      }
      if(f < state.currentFloor + 1) row.classList.add('cleared');
      else if(f === state.currentFloor + 1) row.classList.add('current');
      else row.classList.add('locked');
    });
  }

  function pulseValue(elem){
    elem.classList.remove('value-pulse');
    void elem.offsetWidth;
    elem.classList.add('value-pulse');
  }

  function updateStats(){
    const balStr = fmt(state.balance);
    if(el.balance.textContent !== balStr){
      el.balance.textContent = balStr;
      pulseValue(el.balance);
    }
    el.floorValue.textContent = `${state.currentFloor} / ${FLOORS}`;
    el.multValue.textContent = state.cumulativeMult.toFixed(2) + '×';
    const payout = state.currentFloor > 0 ? state.bet * state.cumulativeMult : 0;
    const payoutStr = fmt(payout);
    if(el.payoutValue.textContent !== payoutStr){
      el.payoutValue.textContent = payoutStr;
      if(payout > 0) pulseValue(el.payoutValue);
    }
    el.cashoutBtn.disabled = !(state.active && state.currentFloor > 0);
  }

  function spawnConfetti(){
    const colors = ['#E8C46B', '#C9A227', '#8fd6bd'];
    for(let i=0; i<20; i++){
      const s = document.createElement('div');
      s.className = 'spark';
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 130;
      s.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      s.style.background = colors[Math.floor(Math.random() * colors.length)];
      document.body.appendChild(s);
      setTimeout(()=> s.remove(), 900);
    }
  }

  function setDifficultyLocked(locked){
    el.diffToggle.querySelectorAll('button').forEach(b=> b.disabled = locked);
    el.betQuick.querySelectorAll('button').forEach(b=> b.disabled = locked);
    el.betStepUp.disabled = locked;
    el.betStepDown.disabled = locked;
    el.betInput.disabled = locked;
  }

  function startGame(){
    const betVal = parseFloat(el.betInput.value);
    if(isNaN(betVal) || betVal <= 0){
      el.hintText.textContent = "Enter a valid bet amount first.";
      el.hintText.className = "hint lose";
      return;
    }
    if(betVal > state.balance){
      el.hintText.textContent = "That bet is more than your balance.";
      el.hintText.className = "hint lose";
      return;
    }

    state.bet = betVal;
    state.balance -= betVal;
    state.active = true;
    state.currentFloor = 0;
    state.cumulativeMult = 1;
    session.wagered += betVal;

    const d = DIFFICULTIES[state.difficulty];
    state.bombIndex = [];
    for(let f=0; f<FLOORS; f++){
      state.bombIndex.push(Math.floor(Math.random() * d.tiles));
    }

    buildTower();
    el.primaryBtn.disabled = true;
    el.primaryBtn.textContent = "Climbing…";
    setDifficultyLocked(true);
    el.hintText.textContent = "Floor 1: pick a tile to advance.";
    el.hintText.className = "hint";
    updateStats();
  }

  function onTileClick(e){
    if(!state.active) return;
    const btn = e.currentTarget;
    const floor = parseInt(btn.dataset.floor,10);
    const index = parseInt(btn.dataset.index,10);
    if(floor !== state.currentFloor + 1) return;

    const rowEl = el.tower.querySelector(`.floor[data-floor="${floor}"]`);
    const tiles = rowEl.querySelectorAll('.tile');
    const bomb = state.bombIndex[floor-1];

    if(index === bomb){
      btn.classList.add('bomb','flipped','hit');
      btn.querySelector('.tile-face.front').innerHTML = svgMine();
      tiles.forEach(t=>{
        if(t !== btn) t.removeEventListener('click', onTileClick);
      });
      endGame(false, false, floor, index);
      return;
    }

    btn.classList.add('safe','flipped');
    btn.querySelector('.tile-face.front').innerHTML = svgGem();
    tiles.forEach(t => t.removeEventListener('click', onTileClick));

    state.currentFloor += 1;
    state.cumulativeMult *= floorFactor();
    refreshFloorStates();
    updateStats();

    if(state.currentFloor === FLOORS){
      endGame(true, true);
      return;
    }
    el.hintText.textContent = `Floor ${state.currentFloor + 1}: pick a tile to advance, or cash out.`;
    el.hintText.className = "hint";
  }

  function revealFullTower(hitFloor, hitIndex){
    for(let f=1; f<=FLOORS; f++){
      const rowEl = el.tower.querySelector(`.floor[data-floor="${f}"]`);
      rowEl.classList.remove('locked','current','cleared');
      rowEl.classList.add(f === hitFloor ? 'exploded' : 'revealed-floor');

      const bomb = state.bombIndex[f-1];
      const tiles = rowEl.querySelectorAll('.tile');
      tiles.forEach(t=>{
        t.removeEventListener('click', onTileClick);
        const idx = parseInt(t.dataset.index,10);
        if(t.classList.contains('flipped')) return;
        const isBomb = idx === bomb;
        t.classList.add('flipped', 'revealed', isBomb ? 'bomb' : 'safe');
        t.querySelector('.tile-face.front').innerHTML = isBomb ? svgMine() : svgGem();
      });
    }
  }

  function endGame(won, reachedTop, hitFloor, hitIndex){
    state.active = false;
    let payout = 0;
    session.rounds += 1;
    if(won){
      payout = state.bet * state.cumulativeMult;
      state.balance += payout;
      session.wins += 1;
      session.returned += payout;
      el.hintText.textContent = reachedTop
        ? `Summit reached. Cashed out ${fmt(payout)} at ${state.cumulativeMult.toFixed(2)}×. Past outcomes don't predict future ones — every floor is an independent draw.`
        : `Cashed out ${fmt(payout)} at ${state.cumulativeMult.toFixed(2)}×. Past outcomes don't predict future ones — every floor is an independent draw.`;
      el.hintText.className = "hint win";
    } else {
      session.losses += 1;
      el.hintText.textContent = `Floor ${state.currentFloor + 1} gave way. Lost ${fmt(state.bet)} — full tower revealed below. The house edge means the odds favor the house over time.`;
      el.hintText.className = "hint lose";
    }
    revealFullTower(hitFloor, hitIndex);
    updateStats();
    updateSessionDisplay();
    showRoundModal(won, payout, reachedTop);
    el.primaryBtn.disabled = false;
    el.primaryBtn.textContent = "Place bet & climb";
    setDifficultyLocked(false);
  }

  function updateSessionDisplay(){
    document.getElementById('sessionRounds').textContent = session.rounds;
    const net = session.returned - session.wagered;
    const netEl = document.getElementById('sessionNet');
    netEl.textContent = (net >= 0 ? '+' : '−') + fmt(Math.abs(net)).replace('$','$');
  }

  function showRoundModal(won, payout, reachedTop){
    const titleEl = document.getElementById('roundModalTitle');
    const bodyEl = document.getElementById('roundModalBody');
    const sessionEl = document.getElementById('roundModalSession');

    if(won){
      titleEl.textContent = reachedTop ? "Summit reached" : "Cashed out";
      bodyEl.textContent = `Bet ${fmt(state.bet)} at ${state.cumulativeMult.toFixed(2)}× → returned ${fmt(payout)}.`;
      spawnConfetti();
    } else {
      titleEl.textContent = "Floor gave way";
      bodyEl.textContent = `Bet ${fmt(state.bet)} on floor ${state.currentFloor + 1} → lost ${fmt(state.bet)}.`;
    }

    const net = session.returned - session.wagered;
    sessionEl.innerHTML = `
      <div><span class="stat-label">Rounds</span><span class="stat-value">${session.rounds}</span></div>
      <div><span class="stat-label">Win / Loss</span><span class="stat-value">${session.wins} / ${session.losses}</span></div>
      <div><span class="stat-label">Net</span><span class="stat-value">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span></div>
    `;

    document.getElementById('roundModal').classList.remove('hidden');
  }

  function cashOut(){
    if(!state.active || state.currentFloor === 0) return;
    endGame(true, false);
  }

  el.primaryBtn.addEventListener('click', startGame);
  el.cashoutBtn.addEventListener('click', cashOut);
  document.getElementById('rgAcknowledge').addEventListener('click', ()=>{
    document.getElementById('rgModal').classList.add('hidden');
    document.body.classList.add('motion-ready');
  });
  document.getElementById('roundModalClose').addEventListener('click', ()=>{
    document.getElementById('roundModal').classList.add('hidden');
  });
  el.diffToggle.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn || state.active) return;
    state.difficulty = btn.dataset.diff;
    el.diffToggle.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    buildTower();
    updateStats();
  });

  el.betQuick.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn || state.active) return;
    let amount;
    if(btn.dataset.frac === 'max'){
      amount = Math.floor(state.balance * 100) / 100;
    } else {
      const frac = parseFloat(btn.dataset.frac);
      amount = Math.floor(state.balance * frac * 100) / 100;
    }
    el.betInput.value = amount;
    el.betQuick.querySelectorAll('button').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    el.hintText.textContent = `Bet set to ${fmt(amount)}.`;
    el.hintText.className = 'hint';
  });

  el.betStepUp.addEventListener('click', ()=>{
    if(state.active) return;
    const current = parseFloat(el.betInput.value) || 0;
    el.betInput.value = Math.round((current + 1) * 100) / 100;
  });
  el.betStepDown.addEventListener('click', ()=>{
    if(state.active) return;
    const current = parseFloat(el.betInput.value) || 0;
    el.betInput.value = Math.max(1, Math.round((current - 1) * 100) / 100);
  });

  el.betInput.addEventListener('input', ()=>{
    let cleaned = el.betInput.value.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if(firstDot !== -1){
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    el.betInput.value = cleaned;
  });

  buildTower();
  updateStats();
  updateSessionDisplay();
})();
