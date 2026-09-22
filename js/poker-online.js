(() => {
  'use strict';

  // ─── Socket connection ───────────────────────────────────────────────────────
  // Auto-target port 3000 if running from Live Server (port 5500/5501) or file://
  const serverOrigin = (window.location.port === '5500' || window.location.port === '5501' || window.location.protocol === 'file:')
    ? 'http://localhost:3000'
    : undefined;

  let socket = null;
  try {
    if (typeof io !== 'undefined') {
      socket = io(serverOrigin);
    }
  } catch (err) {
    console.error('Socket init error:', err);
  }

  function emitSocket(evt, data) {
    if (!socket) {
      showLobbyError('Cannot connect — please open http://localhost:3000/poker');
      return false;
    }
    if (socket.connected) {
      socket.emit(evt, data);
      return true;
    }
    // Not yet connected — wait up to 5 seconds then retry
    const spinner = evt === 'join-room' || evt === 'create-room';
    if (spinner) setConnecting(true);
    const deadline = setTimeout(() => {
      setConnecting(false);
      showLobbyError('Could not reach the server. Check your connection and try again.');
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(deadline);
      setConnecting(false);
      socket.emit(evt, data);
    });
    return true;
  }

  function setConnecting(on) {
    const btn = $('confirmNameBtn') || $('createRoomBtn') || $('joinRoomBtn');
    if (!btn) return;
    if (on) {
      btn.disabled = true;
      btn.dataset._origText = btn.querySelector('span')?.textContent || '';
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Connecting…';
    } else {
      btn.disabled = false;
      const span = btn.querySelector('span');
      if (span && btn.dataset._origText) span.textContent = btn.dataset._origText;
    }
  }

  // ─── Local state ─────────────────────────────────────────────────────────────
  const me = { name: '', avatar: '', chips: 1000, isHost: false, roomCode: null };
  const session = { rounds: 0, wins: 0, losses: 0, wagered: 0, returned: 0, history: [] };
  let lastGameState = null;
  let raiseAmount = 20;

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const chips = v => '$' + Math.round(v).toLocaleString();
  const money = v => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const suits = ['♥', '♦'];

  function cardHtml(card) {
    if (!card || card.hidden) return `<div class="playing-card card-back"><span>?</span><b>N</b></div>`;
    const red = suits.includes(card.suit) ? 'red-card' : '';
    return `<div class="playing-card ${red}"><span>${card.rank}</span><b>${card.suit}</b></div>`;
  }

  function setHint(text, type = '') {
    $('hintText').textContent = text;
    $('hintText').className = `hint ${type}`;
  }

  function updateConnStatus(connected) {
    $('connDot').style.background = connected ? 'var(--green, #22c55e)' : '#ef4444';
    $('connLabel').textContent = connected ? 'Online' : 'Offline';
  }

  // ─── Lobby UI ────────────────────────────────────────────────────────────────
  const lobbyOverlay = $('lobbyOverlay');

  function showStep(id) {
    ['stepName', 'stepActions', 'stepWaiting'].forEach(s => {
      const el = $(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }

  function showLobbyError(msg) {
    const el = $('lobbyError');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // Name confirm
  $('confirmNameBtn').addEventListener('click', () => {
    const name = $('nameInput').value.trim();
    if (!name) return showLobbyError('Please enter your name first.');
    me.name = name;
    me.avatar = name.slice(0, 2).toUpperCase();
    $('myAvatarBtn').textContent = me.avatar;
    // Load saved chips
    const saved = localStorage.getItem(`nexbe-chips-${name}`);
    if (saved) me.chips = parseInt(saved, 10) || 1000;
    $('myChips').textContent = chips(me.chips);

    // Auto-join if arrived via invite link
    if (window._autoJoinCode) {
      showStep('stepActions');
      $('joinPanel').classList.remove('hidden');
      $('codeInput').value = window._autoJoinCode;
      // Small delay so the step renders, then auto-submit
      setTimeout(() => {
        emitSocket('join-room', { code: window._autoJoinCode, name: me.name });
        window._autoJoinCode = null;
      }, 300);
    } else {
      showStep('stepActions');
    }
  });

  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('confirmNameBtn').click(); });

  // Create room
  $('createRoomBtn').addEventListener('click', () => {
    $('createRoomBtn').disabled = true;
    $('createRoomBtn').style.opacity = '0.5';
    emitSocket('create-room', { name: me.name });
  });

  // Show join panel
  $('showJoinBtn').addEventListener('click', () => {
    $('joinPanel').classList.toggle('hidden');
    $('codeInput').focus();
  });

  $('joinRoomBtn').addEventListener('click', doJoin);
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

  function doJoin() {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return showLobbyError('Room codes are exactly 4 characters.');
    $('joinRoomBtn').disabled = true;
    emitSocket('join-room', { code, name: me.name });
  }

  function resetLobbyButtons() {
    $('createRoomBtn').disabled = false;
    $('createRoomBtn').style.opacity = '';
    $('joinRoomBtn').disabled = false;
  }

  // Copy code
  $('copyCodeBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('rcdCode').textContent).then(() => {
      $('copyCodeBtn').textContent = '✓';
      setTimeout(() => ($('copyCodeBtn').textContent = '⧉'), 1500);
    });
  });

  // Copy invite link
  $('copyLinkBtn').addEventListener('click', () => {
    const url = $('inviteUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
      $('copyLinkBtn').textContent = '✓';
      $('copyLinkBtn').style.color = '#4ade80';
      setTimeout(() => {
        $('copyLinkBtn').textContent = '⧉';
        $('copyLinkBtn').style.color = '';
      }, 1800);
    });
  });

  let cachedHostInfo = null;
  let activeInviteMode = 'wifi'; // 'wifi' or 'internet'

  function updateInviteDisplay() {
    if (!me.roomCode || !cachedHostInfo) return;
    const isInternet = activeInviteMode === 'internet';
    $('tabWifi')?.classList.toggle('active', !isInternet);
    $('tabInternet')?.classList.toggle('active', isInternet);

    const genBtn = $('generateTunnelBtn');
    const desc = $('inviteDesc');

    if (isInternet) {
      if (cachedHostInfo.tunnelOrigin) {
        $('inviteUrl').textContent = `${cachedHostInfo.tunnelOrigin}/poker?room=${me.roomCode}`;
        if (desc) desc.textContent = 'Share with anyone, anywhere in the world!';
        if (genBtn) genBtn.classList.add('hidden');
      } else {
        $('inviteUrl').textContent = 'Public link not active yet';
        if (desc) desc.textContent = 'Need to play over internet? Click below:';
        if (genBtn) {
          genBtn.classList.remove('hidden');
          genBtn.textContent = '⚡ Create Online Link';
          genBtn.disabled = false;
        }
      }
    } else {
      const origin = cachedHostInfo.localOrigin || cachedHostInfo.origin || window.location.origin;
      $('inviteUrl').textContent = `${origin}/poker?room=${me.roomCode}`;
      if (desc) desc.textContent = 'Friends on your Wi-Fi network can open this link to join directly.';
      if (genBtn) genBtn.classList.add('hidden');
    }
  }

  function triggerTunnelCreation() {
    const genBtn = $('generateTunnelBtn');
    if (genBtn) {
      genBtn.classList.remove('hidden');
      genBtn.textContent = 'Creating link…';
      genBtn.disabled = true;
    }
    const tunnelApi = (window.location.port === '5500' || window.location.port === '5501')
      ? 'http://localhost:3000/api/tunnel'
      : '/api/tunnel';

    fetch(tunnelApi, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.tunnelUrl) {
          if (!cachedHostInfo) cachedHostInfo = {};
          cachedHostInfo.tunnelOrigin = data.tunnelUrl;
          activeInviteMode = 'internet';
          updateInviteDisplay();
        } else {
          throw new Error(data.error || 'Failed to create tunnel');
        }
      })
      .catch(err => {
        console.error('Tunnel error:', err);
        if (genBtn) {
          genBtn.textContent = '⚡ Retry';
          genBtn.disabled = false;
        }
        showLobbyError('Could not generate public link: ' + err.message);
      });
  }

  $('tabWifi')?.addEventListener('click', () => {
    activeInviteMode = 'wifi';
    updateInviteDisplay();
  });

  $('tabInternet')?.addEventListener('click', () => {
    activeInviteMode = 'internet';
    updateInviteDisplay();
    if (!cachedHostInfo?.tunnelOrigin) {
      triggerTunnelCreation();
    }
  });

  $('generateTunnelBtn')?.addEventListener('click', () => {
    triggerTunnelCreation();
  });

  function setInviteLink(code) {
    const hostApi = (window.location.port === '5500' || window.location.port === '5501')
      ? 'http://localhost:3000/api/host'
      : '/api/host';

    fetch(hostApi)
      .then(r => r.json())
      .then(info => {
        cachedHostInfo = info;
        // If server has a tunnel running, always prefer it
        if (info.tunnelOrigin) {
          cachedHostInfo.tunnelOrigin = info.tunnelOrigin;
          activeInviteMode = 'internet';
        } else if (!info.isLocal && info.origin && !info.origin.includes('localhost')) {
          // Being accessed via a tunnel/proxy already
          activeInviteMode = 'internet';
          cachedHostInfo.tunnelOrigin = info.origin;
        } else {
          activeInviteMode = 'wifi';
        }
        updateInviteDisplay();
      })
      .catch(() => {
        const fallbackBase = (window.location.port === '5500' || window.location.port === '5501')
          ? 'http://localhost:3000'
          : window.location.origin;
        cachedHostInfo = {
          origin: fallbackBase,
          localOrigin: fallbackBase,
          tunnelOrigin: null,
          isLocal: true
        };
        activeInviteMode = 'wifi';
        updateInviteDisplay();
      });
  }

  // Start game (host only)
  $('startGameBtn').addEventListener('click', () => {
    emitSocket('start-game');
  });

  // ─── Socket events ───────────────────────────────────────────────────────────
  // Cache latest lobby state so we can restore it when returning from a game
  let cachedLobbyPhase = 'lobby';
  let cachedSeats = [];

  function applyLobbyButtons() {
    renderSeatList(cachedSeats);
    if (me.isHost) {
      $('startGameBtn').classList.remove('hidden');
      $('waitingHint').classList.add('hidden');
    } else {
      $('startGameBtn').classList.add('hidden');
      $('waitingHint').classList.remove('hidden');
    }
  }

  if (socket) {
    socket.on('connect', () => updateConnStatus(true));
    socket.on('disconnect', () => updateConnStatus(false));
    socket.on('connect_error', () => updateConnStatus(false));

    socket.on('room-created', ({ code }) => {
      me.roomCode = code;
      me.isHost = true;
      resetLobbyButtons();
      $('rcdCode').textContent = code;
      $('statRoom').textContent = code;
      $('footerRoom').textContent = code;
      setInviteLink(code);
      $('startGameBtn').classList.remove('hidden');
      $('waitingHint').classList.add('hidden');
      showStep('stepWaiting');
    });

    socket.on('room-joined', ({ code }) => {
      me.roomCode = code;
      me.isHost = false;
      resetLobbyButtons();
      $('rcdCode').textContent = code;
      $('statRoom').textContent = code;
      $('footerRoom').textContent = code;
      setInviteLink(code);
      showStep('stepWaiting');
    });

    socket.on('lobby-update', ({ seats, phase }) => {
      cachedLobbyPhase = phase || 'lobby';
      cachedSeats = seats || [];
      $('statPlayers').textContent = `${cachedSeats.length} / 4`;
      // Only update UI if the lobby overlay is already visible — don't pop it open mid-game
      if (!lobbyOverlay.classList.contains('hidden')) {
        applyLobbyButtons();
      }
    });

    socket.on('game-started', () => {
      hideTimer();
      lobbyOverlay.classList.add('hidden');
      $('resultModal').classList.add('hidden');
      setHint('Game started! Waiting for your turn…');
      $('roundStatus').textContent = 'FLOP';
      $('pokerTable').innerHTML = '';
    });

    socket.on('game-state', state => {
      lastGameState = state;
      renderTable(state);
      renderControls(state);
      renderMyHand(state);
    });

    socket.on('hand-result', result => {
      showResult(result);
    });

    socket.on('player-left', ({ name }) => {
      setHint(`${name} disconnected — their hand was folded.`, 'lose');
    });

    socket.on('error', ({ message }) => {
      resetLobbyButtons();
      showLobbyError(message);
    });
  } else {
    updateConnStatus(false);
  }

  // ─── Lobby seat list ─────────────────────────────────────────────────────────
  function renderSeatList(seats) {
    const list = $('seatList');
    // Fill up to 4 slots
    const allSlots = [...seats];
    while (allSlots.length < 4) allSlots.push(null);

    list.innerHTML = allSlots.map((seat, i) => {
      if (!seat) {
        return `<div class="seat-slot empty">
          <span class="ss-avatar empty-avatar">?</span>
          <span class="ss-name">Open seat</span>
          <span class="ss-status">Waiting…</span>
        </div>`;
      }
      const isMe = socket ? (seat.id === socket.id) : false;
      return `<div class="seat-slot ${isMe ? 'mine' : ''}">
        <span class="ss-avatar">${seat.avatar}</span>
        <span class="ss-name">${seat.name}${seat.isHost ? ' 👑' : ''}${isMe ? ' (You)' : ''}</span>
        <span class="ss-status connected">● Ready</span>
      </div>`;
    }).join('');
  }

  // ─── Table rendering ─────────────────────────────────────────────────────────
  function renderTable(state) {
    const table = $('pokerTable');
    const players = state.players;

    // Split into opponents (not me) and my seat
    const others = players.filter(p => !p.isMe);
    const me_player = players.find(p => p.isMe);

    // Position classes — supports up to 3 opponents
    const posClasses = ['bot-one', 'bot-two', 'bot-three'];

    let html = '';

    others.forEach((player, i) => {
      const pos = posClasses[i] || `bot-${i + 1}`;
      const isCurrentTurn = state.currentPlayerIndex === players.indexOf(player);
      const statusText = player.folded ? 'Folded' : isCurrentTurn ? '🎯 Acting…' : player.action || '—';
      html += `<div class="bot-seat ${pos} ${player.folded ? 'folded-seat' : ''} ${isCurrentTurn ? 'active-turn' : ''}">
        <span class="bot-avatar">${player.avatar}</span>
        <strong>${player.name}${player.isBot ? '' : ' 👤'}</strong>
        <small>${statusText}</small>
        <span class="seat-metrics">
          <b>${chips(player.chips)}</b>
          <em>${chips(player.currentBet || 0)} in</em>
        </span>
        <div class="mini-hand">
          ${(player.hand || []).map(c => cardHtml(c)).join('')}
        </div>
      </div>`;
    });

    // Community area
    const community = state.community || [];
    const streetLabel = { flop: 'FLOP', turn: 'TURN', river: 'RIVER' }[state.street] || 'PRE-FLOP';
    html += `<div class="community-area">
      <span class="hand-label">COMMUNITY <b>${streetLabel}</b></span>
      <div class="community-cards" id="communityCardsLive">
        ${community.map(c => cardHtml(c)).join('')}
      </div>
      <div class="pot-label">POT <strong>${money(state.pot)}</strong></div>
    </div>`;

    // My seat
    if (me_player) {
      const myStatusText = me_player.folded ? 'Folded' : state.resolving ? 'Showdown' : state.isMyTurn ? 'Your turn ▶' : me_player.action || 'Waiting';
      html += `<div class="player-seat ${state.isMyTurn ? 'active-turn' : ''}">
        <span class="bot-avatar player-avatar">${me.avatar}</span>
        <div>
          <strong>${me.name} (You)</strong>
          <small id="playerStatus">${myStatusText}</small>
        </div>
        <span class="seat-metrics">
          <b id="playerStack">${chips(me_player.chips)}</b>
          <em id="playerBet">${chips(me_player.currentBet || 0)} in</em>
        </span>
        <div class="player-hand" id="playerHand">
          ${(state.myHand || []).map(c => cardHtml(c)).join('')}
        </div>
      </div>`;
    }

    table.innerHTML = html;
    $('potReadout').textContent = money(state.pot);
    $('statPlayers').textContent = `${players.filter(p => !p.isBot).length} / 4`;

    // Update my chip counter in header
    if (me_player) {
      me.chips = me_player.chips;
      $('myChips').textContent = chips(me.chips);
      localStorage.setItem(`nexbe-chips-${me.name}`, me.chips);
    }
  }

  function renderMyHand(state) {
    const myHand = state.myHand || [];
    const handReadout = myHand.length
      ? myHand.map(c => c.rank + c.suit).join(' ')
      : '—';
    $('handReadout').textContent = handReadout;
  }

  // ─── Controls ────────────────────────────────────────────────────────────────
  function renderControls(state) {
    const active = state.isMyTurn && !state.resolving;
    const canCheck = active && !state.toCall;
    const canCall = active && !!state.toCall;
    const canRaise = active && !state.raiseUsed;
    const canFold = active;

    $('checkBtn').disabled = !canCheck;
    $('callBtn').disabled = !canCall;
    $('raiseBtn').disabled = !canRaise;
    $('foldBtn').disabled = !canFold;

    if (state.toCall > 0) {
      $('callBtn').textContent = `Call $${Math.round(state.toCall)}`;
    } else {
      $('callBtn').textContent = 'Call';
    }

    // Raise panel
    const raiseWrap = $('raiseSliderWrap');
    if (canRaise) {
      raiseWrap.classList.remove('hidden');
      const slider = $('raiseSlider');
      const myPlayer = state.players?.find(p => p.isMe);
      const maxChips = myPlayer ? myPlayer.chips : 1000;
      const minBet = Math.min((state.ante || 10) * 2, maxChips);
      slider.min = minBet;
      slider.max = maxChips;
      raiseAmount = Math.max(minBet, Math.min(raiseAmount, maxChips));
      slider.value = raiseAmount;
      $('raiseSliderValue').textContent = `$${raiseAmount}`;
      $('raiseSliderLimit').textContent = `Max: $${Math.round(maxChips)}`;
      $('raiseBtn').textContent = `Raise $${raiseAmount}`;
      updateSliderFill(slider);
      // Quick-bet button data
      raiseWrap.dataset.pot = state.pot || 0;
      raiseWrap.dataset.max = maxChips;
      raiseWrap.dataset.min = minBet;
    } else {
      raiseWrap.classList.add('hidden');
      $('raiseBtn').textContent = 'Raise';
    }

    // Status badge
    const statuses = {
      resolving: 'SHOWDOWN',
      flop: 'FLOP',
      turn: 'TURN',
      river: 'RIVER',
    };
    $('roundStatus').textContent = state.resolving ? 'SHOWDOWN' : (statuses[state.street] || 'LIVE');

    if (active) {
      const raiserName = state.players?.find(p => p.action === 'Raise')?.name;
      setHint(
        state.toCall > 0
          ? `${raiserName || 'Someone'} raised — to call costs $${Math.round(state.toCall)}.`
          : 'Your turn — check, raise, or fold.',
        'win'
      );
    } else if (state.resolving) {
      hideTimer();
      setHint('Reading the table…');
    } else {
      const whose = state.players?.[state.currentPlayerIndex];
      if (whose) setHint(`Waiting for ${whose.name}…`);
    }
  }

  // ─── Action buttons ──────────────────────────────────────────────────────────
  $('checkBtn').addEventListener('click', () => { hideTimer(); emitSocket('player-action', { action: 'check' }); });
  $('callBtn').addEventListener('click', () => { hideTimer(); emitSocket('player-action', { action: 'call' }); });
  $('foldBtn').addEventListener('click', () => { hideTimer(); emitSocket('player-action', { action: 'fold' }); });
  $('raiseBtn').addEventListener('click', () => { hideTimer(); emitSocket('player-action', { action: 'raise', raiseAmount }); });

  // Slider input
  $('raiseSlider').addEventListener('input', e => {
    raiseAmount = Number(e.target.value);
    $('raiseSliderValue').textContent = `$${raiseAmount}`;
    $('raiseBtn').textContent = `Raise $${raiseAmount}`;
    updateSliderFill(e.target);
  });

  function updateSliderFill(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min || 1)) * 100;
    // Use background gradient to show fill on the track
    slider.style.background = `linear-gradient(to right, #f59e0b ${pct}%, rgba(255,255,255,.1) ${pct}%)`;
  }

  // Quick-bet buttons
  function setRaise(amount) {
    const wrap = $('raiseSliderWrap');
    const min = Number(wrap.dataset.min || 20);
    const max = Number(wrap.dataset.max || 1000);
    raiseAmount = Math.max(min, Math.min(Math.round(amount / 10) * 10, max));
    $('raiseSlider').value = raiseAmount;
    $('raiseSliderValue').textContent = `$${raiseAmount}`;
    $('raiseBtn').textContent = `Raise $${raiseAmount}`;
    updateSliderFill($('raiseSlider'));
  }

  $('quickBetHalf').addEventListener('click', () => {
    const pot = Number($('raiseSliderWrap').dataset.pot || 0);
    setRaise(Math.max(pot / 2, Number($('raiseSliderWrap').dataset.min || 20)));
  });
  $('quickBetPot').addEventListener('click', () => {
    const pot = Number($('raiseSliderWrap').dataset.pot || 0);
    setRaise(Math.max(pot, Number($('raiseSliderWrap').dataset.min || 20)));
  });
  $('quickBet2x').addEventListener('click', () => {
    setRaise(raiseAmount * 2);
  });
  $('quickBetAllin').addEventListener('click', () => {
    setRaise(Number($('raiseSliderWrap').dataset.max || 1000));
  });

  // ─── Turn Timer ───────────────────────────────────────────────────────────────
  const TIMER_TOTAL = 40;

  function updateTimer(seconds, isMyTurn) {
    const myWrap = $('turnTimerWrap');
    const oppWrap = $('oppTimerWrap');
    const pct = Math.max(0, Math.min(1, seconds / TIMER_TOTAL));
    const urgent = seconds <= 10;

    if (isMyTurn) {
      myWrap.classList.remove('hidden');
      oppWrap.classList.add('hidden');
      myWrap.classList.toggle('urgent', urgent);
      $('timerCount').textContent = seconds;
      $('timerSecs').textContent = seconds;
      // Ring: circumference ≈ 113
      $('timerRingFill').style.strokeDashoffset = (1 - pct) * 113;
      // Bar
      $('timerBarFill').style.width = (pct * 100) + '%';
    } else {
      myWrap.classList.add('hidden');
      oppWrap.classList.remove('hidden');
      const whose = lastGameState?.players?.[lastGameState?.currentPlayerIndex]?.name || '';
      $('oppTimerLabel').textContent = whose ? `${whose} thinking…` : 'Waiting…';
      $('oppTimerBarFill').style.width = (pct * 100) + '%';
    }
  }

  function hideTimer() {
    $('turnTimerWrap').classList.add('hidden');
    $('oppTimerWrap').classList.add('hidden');
  }

  if (socket) {
    socket.on('turn-timer', ({ seconds }) => {
      if (!lastGameState || lastGameState.resolving) { hideTimer(); return; }
      const isMyTurn = lastGameState?.isMyTurn || false;
      updateTimer(seconds, isMyTurn);
    });

    socket.on('player-timeout', ({ name }) => {
      hideTimer();
      setHint(`⏱ ${name} took too long and was auto-folded.`, 'lose');
    });
  }

  // ─── Result modal ─────────────────────────────────────────────────────────────
  function showResult(result) {
    hideTimer();
    const myPlayer = lastGameState?.players?.find(p => p.isMe);
    const iWon = result.winnerName === me.name;
    const isTie = result.tie && myPlayer && !myPlayer.folded;

    session.rounds++;
    if (iWon && !isTie) session.wins++;
    else if (!iWon) session.losses++;

    const net = iWon ? result.payout - (result.pot / (result.players || 4)) : -(result.ante || 10);
    session.history.unshift({
      result: iWon && !isTie ? 'WIN' : isTie ? 'PUSH' : 'LOSS',
      winner: result.winnerName,
      handLabel: result.winnerHandLabel,
      payout: result.payout,
    });
    session.history = session.history.slice(0, 10);

    $('resultIcon').textContent = iWon ? '♠' : isTie ? '—' : '×';
    $('resultTitle').textContent = `${result.winnerName} wins!`;
    $('resultAmount').textContent = iWon
      ? `+${money(result.payout)}`
      : result.folded ? 'Folded' : `${result.winnerName} took the pot`;
    $('resultAmount').style.color = iWon ? 'var(--green)' : isTie ? 'var(--gold)' : 'var(--red)';
    $('resultBody').textContent = result.folded
      ? `${result.winnerName} was the last one standing.`
      : `${result.winnerName} won with ${result.winnerHandLabel}.`;
    $('resultDetail').textContent = `Pot: ${money(result.pot)} · Winner: ${result.winnerName}`;

    // Showdown hands
    if (result.scores && result.scores.length) {
      $('showdownHands').innerHTML = result.scores
        .filter(s => !s.folded && s.hand)
        .map(s => `<div class="showdown-player">
          <span>${s.name}</span>
          <div class="mini-hand showdown-mini">${s.hand.map(c => cardHtml(c)).join('')}</div>
          <small>${s.label || ''}</small>
        </div>`).join('');
    } else {
      $('showdownHands').innerHTML = '';
    }

    $('resultModal').classList.remove('hidden');
    $('sessionRounds').textContent = session.rounds;
    $('sessionWins').textContent = session.wins;
    $('sessionLosses').textContent = session.losses;

    renderHistory();
    updateSessionNet();
  }

  function updateSessionNet() {
    const won = session.history.filter(h => h.result === 'WIN').length;
    const lost = session.history.filter(h => h.result === 'LOSS').length;
    const net = (won - lost) * 10;
    $('sessionNet').textContent = (net >= 0 ? '+' : '−') + '$' + Math.abs(net);
    $('sessionNet').style.color = net >= 0 ? 'var(--green)' : 'var(--red)';
  }

  function renderHistory() {
    const el = $('history');
    $('historyCount').textContent = `${session.history.length} / 10`;
    el.innerHTML = session.history.length
      ? `<div class="history-row"><span>Winner</span><span>Hand</span><span>Result</span></div>` +
        session.history.map(h => `<div class="history-row">
          <strong>${h.winner}</strong>
          <span>${h.handLabel || '—'}</span>
          <span class="${h.result === 'LOSS' ? 'loss' : 'win'}">${h.result}</span>
        </div>`).join('')
      : `<div class="empty-history">Your completed hands will appear here.</div>`;
  }

  // Back to lobby after result
  function closeResultModal() {
    hideTimer();
    $('resultModal').classList.add('hidden');
    $('pokerTable').innerHTML = '';
    lobbyOverlay.classList.remove('hidden');
    showStep('stepWaiting');
    $('roundStatus').textContent = 'LOBBY';
    setHint(me.isHost ? 'Start the next round!' : 'Waiting for host to start next round…');
    applyLobbyButtons();
  }
  $('playAgain').addEventListener('click', closeResultModal);
  $('modalClose').addEventListener('click', closeResultModal);
  $('resultModal').addEventListener('click', e => {
    if (e.target === $('resultModal')) closeResultModal();
  });

  // ─── Settings ────────────────────────────────────────────────────────────────
  const settingsModal = $('settingsModal');
  $('settingsBtn').addEventListener('click', () => settingsModal.classList.remove('hidden'));
  $('settingsClose').addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
  $('resetBalance').addEventListener('click', () => {
    me.chips = 1000;
    localStorage.setItem(`nexbe-chips-${me.name}`, 1000);
    $('myChips').textContent = chips(me.chips);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('resultModal').classList.add('hidden');
      settingsModal.classList.add('hidden');
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────────
  // Check for ?room=CODE in the URL — friends who click the invite link get auto-joined
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room')?.toUpperCase();
  if (roomFromUrl && roomFromUrl.length === 4) {
    window._autoJoinCode = roomFromUrl;
  }

  showStep('stepName');
  requestAnimationFrame(() => $('loadingScreen').classList.add('loaded'));
  renderHistory();
})();
