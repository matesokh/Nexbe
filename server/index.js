'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

let tunnelProcess = null;
let tunnelUrl = null;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function startTunnel(port) {
  if (tunnelUrl) return Promise.resolve(tunnelUrl);
  return new Promise((resolve) => {
    try {
      const { bin } = require('cloudflared');
      const { spawn } = require('child_process');
      tunnelProcess = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let resolved = false;
      const tryParse = (chunk) => {
        const str = chunk.toString();
        const m = str.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m && !resolved) {
          resolved = true;
          tunnelUrl = m[0];
          console.log(`\n🌐 Public Tunnel (Cloudflare): ${tunnelUrl}/poker\n`);
          resolve(tunnelUrl);
        }
      };
      tunnelProcess.stdout.on('data', tryParse);
      tunnelProcess.stderr.on('data', tryParse);
      tunnelProcess.on('exit', () => {
        tunnelUrl = null;
        tunnelProcess = null;
      });

      // Timeout after 20s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[Tunnel] Cloudflare tunnel did not start in time');
          resolve(null);
        }
      }, 20000);
    } catch (err) {
      console.warn(`[Tunnel] Failed: ${err.message}`);
      resolve(null);
    }
  });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Allow cross-origin requests from Live Server / any local dev port
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve static files from the parent Nexbe directory
app.use(express.static(path.join(__dirname, '..')));
app.get('/poker', (req, res) => res.sendFile(path.join(__dirname, '../html/poker-online.html')));

// Returns the public-facing or LAN origin so clients can build shareable invite links
app.get('/api/host', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const reqHost = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const localIp = getLocalIp();
  const localOrigin = `http://${localIp}:${PORT}`;

  const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
  let origin = `${proto}://${reqHost}`;
  if (isLocal) {
    origin = tunnelUrl || localOrigin;
  }

  res.json({
    origin,
    localOrigin,
    tunnelOrigin: tunnelUrl,
    isLocal
  });
});

// On-demand tunnel creation from the frontend
app.post('/api/tunnel', async (req, res) => {
  try {
    const url = await startTunnel(PORT);
    if (!url) return res.status(500).json({ error: 'Failed to create tunnel' });
    res.json({ tunnelUrl: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Game constants ──────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BOT_NAMES = ['Axel', 'Blaze', 'Cora'];
const BOT_AVATARS = ['AX', 'BZ', 'CO'];
const STARTING_CHIPS = 1000;
const MAX_SEATS = 4;
const BOT_THINK_MS = 1100;
const ACTION_TIMEOUT = 40; // seconds before auto-fold

function rankValue(rank) { return RANKS.indexOf(rank) + 2; }

function makeDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank }))).sort(() => Math.random() - 0.5);
}

// ─── Hand evaluator ──────────────────────────────────────────────────────────
function evaluateFive(cards) {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a);
  const counts = new Map();
  cards.forEach(c => counts.set(rankValue(c.rank), (counts.get(rankValue(c.rank)) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const unique = [...new Set(values)];
  let straightHigh = 0;
  if (unique.length === 5 && unique[0] - unique[4] === 4) straightHigh = unique[0];
  if (unique.join(',') === '14,5,4,3,2') straightHigh = 5;
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(g => g[0]).sort((a, b) => b - a)];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]];
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map(g => g[0]).sort((a, b) => b - a)];
  return [0, ...values];
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

function combos(cards) {
  const res = [];
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++)
            res.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return res;
}

function evaluateHand(cards) {
  return combos(cards).reduce((best, combo) => {
    const score = evaluateFive(combo);
    return !best || compareScores(score, best) > 0 ? score : best;
  }, null);
}

const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
function handLabel(score) { return HAND_NAMES[score[0]]; }

// ─── Room store ───────────────────────────────────────────────────────────────
// rooms: Map<roomCode, RoomState>
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom(hostSocket, hostName) {
  const code = generateCode();
  const host = {
    id: hostSocket.id,
    name: hostName || 'Player',
    avatar: hostName ? hostName.slice(0, 2).toUpperCase() : 'PL',
    chips: STARTING_CHIPS,
    isBot: false,
    isHost: true,
  };
  const room = {
    code,
    phase: 'lobby',      // lobby | playing
    seats: [host],       // up to 4 human seats
    game: null,
  };
  rooms.set(code, room);
  return room;
}

function publicSeats(room) {
  return room.seats.map(s => ({
    id: s.id,
    name: s.name,
    avatar: s.avatar,
    chips: s.chips,
    isBot: s.isBot,
    isHost: s.isHost,
    ready: true,
  }));
}

// ─── Game logic ───────────────────────────────────────────────────────────────
function startGame(room) {
  const deck = makeDeck();
  const allSeats = [...room.seats]; // real players

  // Fill empty seats with bots (up to MAX_SEATS total)
  const botsNeeded = Math.max(0, MAX_SEATS - allSeats.length);
  const bots = BOT_NAMES.slice(0, botsNeeded).map((name, i) => ({
    id: `bot-${i}`,
    name,
    avatar: BOT_AVATARS[i],
    chips: STARTING_CHIPS,
    isBot: true,
    isHost: false,
  }));

  const players = [...allSeats, ...bots];

  // Deal 2 hole cards to each player
  const hands = players.map(() => [deck.pop(), deck.pop()]);

  // Community cards (all 5 pre-dealt, revealed incrementally)
  const community = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

  const ante = 10; // forced ante / buy-in per player
  players.forEach((p, i) => {
    p.chips -= ante;
    p.currentBet = ante;
    p.folded = false;
    p.action = 'Ante';
    p.hand = hands[i];
    p.actedThisStreet = false;
  });

  const pot = ante * players.length;

  room.game = {
    players,         // full player objects with hand
    community,       // all 5 community cards
    revealed: 3,     // 3 = flop, 4 = turn, 5 = river
    pot,
    highestBet: ante,
    raiseUsed: false,
    currentPlayerIndex: 0,  // index in players[] whose turn it is
    street: 'flop',
    resolving: false,
    ante,
  };

  room.phase = 'playing';

  // Start turn
  const firstPlayer = room.game.players[0];
  if (firstPlayer.isBot) {
    setTimeout(() => doBotAction(room), BOT_THINK_MS);
  } else {
    startActionTimer(room);
  }
}

function nextTurn(room) {
  const game = room.game;
  if (!game || room.phase !== 'playing' || game.resolving) return;

  // Check if hand should end early (only 1 active player left)
  const active = game.players.filter(p => !p.folded);
  if (active.length === 1) {
    resolveHand(room, true);
    return;
  }

  // Check if street is complete: every active player has acted AND bets match
  const allActed = active.every(p => p.actedThisStreet);
  const allMatched = active.every(p => p.currentBet === game.highestBet || p.chips === 0);

  if (allActed && allMatched) {
    advanceStreet(room);
    return;
  }

  // Find next active player who still needs to act
  const total = game.players.length;
  let nextIdx = (game.currentPlayerIndex + 1) % total;
  let checked = 0;
  while (checked < total) {
    const p = game.players[nextIdx];
    // Skip folded, all-in, or players who already acted with matched bet
    if (!p.folded && p.chips > 0 && !(p.actedThisStreet && p.currentBet === game.highestBet)) {
      break;
    }
    nextIdx = (nextIdx + 1) % total;
    checked++;
  }

  // Safety: if we couldn't find anyone new, advance the street
  if (checked === total) {
    advanceStreet(room);
    return;
  }

  game.currentPlayerIndex = nextIdx;
  broadcastGameState(room);

  const nextPlayer = game.players[game.currentPlayerIndex];
  if (nextPlayer.isBot) {
    clearActionTimer(room);
    setTimeout(() => doBotAction(room), BOT_THINK_MS);
  } else {
    startActionTimer(room);
  }
}

function clearActionTimer(room) {
  if (room._actionTimer) {
    clearInterval(room._actionTimer);
    room._actionTimer = null;
  }
  room._actionTimeLeft = 0;
}

function startActionTimer(room) {
  clearActionTimer(room);
  room._actionTimeLeft = ACTION_TIMEOUT;

  // Broadcast initial tick
  io.to(room.code).emit('turn-timer', { seconds: room._actionTimeLeft });

  room._actionTimer = setInterval(() => {
    if (!room.game || room.phase !== 'playing') {
      clearActionTimer(room);
      return;
    }
    room._actionTimeLeft--;
    io.to(room.code).emit('turn-timer', { seconds: room._actionTimeLeft });

    if (room._actionTimeLeft <= 0) {
      clearActionTimer(room);
      const game = room.game;
      const player = game.players[game.currentPlayerIndex];
      if (player && !player.isBot && !player.folded) {
        console.log(`[Timer] Auto-folding ${player.name} in room ${room.code}`);
        player.folded = true;
        player.action = 'Fold';
        player.actedThisStreet = true;
        io.to(room.code).emit('player-timeout', { name: player.name });
        nextTurn(room);
      }
    }
  }, 1000);
}

function advanceStreet(room) {
  const game = room.game;

  // Reset per-street state for all players
  game.players.forEach(p => {
    p.actedThisStreet = false;
    p.currentBet = 0;
    if (p.action !== 'Fold') p.action = null;
  });
  game.highestBet = 0;
  game.raiseUsed = false;

  if (game.revealed === 3) {
    game.revealed = 4;
    game.street = 'turn';
  } else if (game.revealed === 4) {
    game.revealed = 5;
    game.street = 'river';
  } else {
    // Showdown
    game.resolving = true;
    broadcastGameState(room);
    setTimeout(() => resolveHand(room, false), 600);
    return;
  }

  // Find first active player for new street
  let firstIdx = 0;
  while (firstIdx < game.players.length && (game.players[firstIdx].folded || game.players[firstIdx].chips === 0)) {
    firstIdx++;
  }
  if (firstIdx >= game.players.length) firstIdx = 0;

  game.currentPlayerIndex = firstIdx;
  broadcastGameState(room);

  const firstPlayer = game.players[firstIdx];
  if (firstPlayer && firstPlayer.isBot) {
    clearActionTimer(room);
    setTimeout(() => doBotAction(room), BOT_THINK_MS);
  } else if (firstPlayer) {
    startActionTimer(room);
  }
}

function doBotAction(room) {
  const game = room.game;
  if (!game || room.phase !== 'playing') return;
  const bot = game.players[game.currentPlayerIndex];
  if (!bot || !bot.isBot || bot.folded) return;

  const toCall = game.highestBet - (bot.currentBet || 0);
  const rand = Math.random();

  if (toCall > 0) {
    if (rand < 0.25) {
      bot.folded = true;
      bot.action = 'Fold';
    } else {
      const callAmount = Math.min(toCall, bot.chips);
      bot.chips -= callAmount;
      bot.currentBet += callAmount;
      game.pot += callAmount;
      bot.action = 'Call';
    }
  } else {
    if (rand < 0.2 && !game.raiseUsed) {
      const raiseAmount = game.ante;
      const actualRaise = Math.min(raiseAmount, bot.chips);
      if (actualRaise > 0) {
        bot.chips -= actualRaise;
        bot.currentBet += actualRaise;
        game.pot += actualRaise;
        game.highestBet = bot.currentBet;
        game.raiseUsed = true;
        // Reset others so they can respond to the raise
        game.players.forEach(p => {
          if (p !== bot && !p.folded) p.actedThisStreet = false;
        });
        bot.action = 'Raise';
      } else {
        bot.action = 'Check';
      }
    } else {
      bot.action = 'Check';
    }
  }

  bot.actedThisStreet = true;
  nextTurn(room);
}

function playerAction(room, socketId, action, raiseAmount) {
  const game = room.game;
  if (!game || room.phase !== 'playing' || game.resolving) return;

  const playerIdx = game.currentPlayerIndex;
  const player = game.players[playerIdx];

  if (!player || player.id !== socketId) return;
  if (player.folded) return;

  // Clear auto-fold timer immediately on valid action
  clearActionTimer(room);
  const toCall = game.highestBet - (player.currentBet || 0);

  switch (action) {
    case 'check':
      if (toCall > 0) return; // can't check if there's a bet to call
      player.action = 'Check';
      player.actedThisStreet = true;
      nextTurn(room);
      return;

    case 'call':
      if (toCall <= 0) return;
      {
        const callAmount = Math.min(toCall, player.chips);
        player.chips -= callAmount;
        player.currentBet += callAmount;
        game.pot += callAmount;
        player.action = 'Call';
        player.actedThisStreet = true;
        nextTurn(room);
      }
      return;

    case 'raise':
      {
        let inc = raiseAmount || (game.ante * 2);
        inc = Math.min(inc, player.chips);

        // Need to beat the current highest bet
        if (inc <= 0 || player.currentBet + inc <= game.highestBet) return;

        player.chips -= inc;
        player.currentBet += inc;
        game.pot += inc;
        game.highestBet = player.currentBet;
        game.raiseUsed = true;
        player.action = 'Raise';
        player.actedThisStreet = true;

        // Everyone else must now respond to the raise
        game.players.forEach(p => {
          if (p !== player && !p.folded) p.actedThisStreet = false;
        });

        nextTurn(room);
      }
      return;

    case 'fold':
      player.folded = true;
      player.action = 'Fold';
      player.actedThisStreet = true;
      nextTurn(room);
      return;
  }
}

function resolveHand(room, onlyOneLeft) {
  clearActionTimer(room);
  const game = room.game;
  const community = game.community;

  const activePlayers = game.players.filter(p => !p.folded);

  if (onlyOneLeft) {
    const winner = activePlayers[0];
    winner.chips += game.pot;
    updateSeatChips(room, game);
    const result = buildResult(game, winner, null, game.pot, false, true);
    room.phase = 'lobby';
    room.game = null;
    io.to(room.code).emit('hand-result', result);
    setTimeout(() => broadcastLobby(room), 200);
    return;
  }

  // Evaluate hands
  const scores = game.players.map(p =>
    p.folded ? null : evaluateHand([...p.hand, ...community])
  );

  const bestScore = scores.reduce((best, s) => {
    if (!s) return best;
    if (!best || compareScores(s, best) > 0) return s;
    return best;
  }, null);

  const winnerIndices = scores
    .map((s, i) => s && compareScores(s, bestScore) === 0 ? i : -1)
    .filter(i => i >= 0);

  const splitPot = game.pot / winnerIndices.length;
  winnerIndices.forEach(i => { game.players[i].chips += splitPot; });

  const humanWinnerIdx = winnerIndices.find(i => !game.players[i].isBot);
  const humanPlayer = game.players.find(p => !p.isBot);
  const humanScore = humanPlayer ? scores[game.players.indexOf(humanPlayer)] : null;
  const humanWon = humanWinnerIdx !== undefined;
  const tie = humanWon && winnerIndices.length > 1;
  const winnerPlayer = game.players[winnerIndices[0]];
  const winnerScore = scores[winnerIndices[0]];

  const result = buildResult(game, winnerPlayer, winnerScore, splitPot, tie, false);
  result.playerHandLabel = humanScore ? handLabel(humanScore) : null;
  result.scores = scores.map((s, i) => ({
    name: game.players[i].name,
    label: s ? handLabel(s) : null,
    folded: game.players[i].folded,
    hand: game.players[i].hand,
  }));

  updateSeatChips(room, game);
  room.phase = 'lobby';
  room.game = null;
  clearActionTimer(room);

  io.to(room.code).emit('hand-result', result);
  // Let all players know the lobby is back (so host gets Start Game button)
  setTimeout(() => broadcastLobby(room), 200);
}

function updateSeatChips(room, game) {
  game.players.forEach(gp => {
    if (gp.isBot) return;
    const seat = room.seats.find(s => s.id === gp.id);
    if (seat) seat.chips = gp.chips;
  });
}

function buildResult(game, winnerPlayer, winnerScore, payout, tie, folded) {
  return {
    winnerName: winnerPlayer.name,
    winnerAvatar: winnerPlayer.avatar,
    winnerHandLabel: winnerScore ? handLabel(winnerScore) : (folded ? 'Last standing' : 'Best hand'),
    pot: game.pot,
    payout,
    tie,
    folded,
    community: game.community,
  };
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function broadcastGameState(room) {
  if (!room.game) return;
  const game = room.game;

  // Send personalised state to each human player
  room.seats.forEach(seat => {
    const socket = io.sockets.sockets.get(seat.id);
    if (!socket) return;

    const myPlayer = game.players.find(p => p.id === seat.id);
    const myHand = myPlayer ? myPlayer.hand : [];
    const toCall = myPlayer ? game.highestBet - (myPlayer.currentBet || 0) : 0;

    const publicPlayers = game.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      chips: p.chips,
      currentBet: p.currentBet,
      folded: p.folded,
      action: p.action,
      isBot: p.isBot,
      isMe: p.id === seat.id,
      hand: p.id === seat.id ? p.hand : p.hand.map(() => ({ hidden: true })),
    }));

    socket.emit('game-state', {
      players: publicPlayers,
      community: game.community.slice(0, game.revealed),
      pot: game.pot,
      toCall: toCall,
      raiseUsed: game.raiseUsed,
      street: game.street,
      revealed: game.revealed,
      resolving: game.resolving,
      currentPlayerIndex: game.currentPlayerIndex,
      myHand,
      isMyTurn: myPlayer && game.players[game.currentPlayerIndex]?.id === seat.id && !game.resolving,
    });
  });
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby-update', {
    code: room.code,
    seats: publicSeats(room),
    phase: room.phase,
  });
}

// ─── Socket.io events ─────────────────────────────────────────────────────────

// Helper: cleanly remove a socket from its current room (if any)
function leaveCurrentRoom(socket) {
  const oldCode = socket.data.roomCode;
  if (!oldCode) return;
  const oldRoom = rooms.get(oldCode);
  if (!oldRoom) { socket.data.roomCode = null; return; }

  // Remove from seats
  oldRoom.seats = oldRoom.seats.filter(s => s.id !== socket.id);
  socket.leave(oldCode);
  socket.data.roomCode = null;

  if (oldRoom.seats.length === 0) {
    clearActionTimer(oldRoom);
    rooms.delete(oldCode);
    console.log(`[Room] Deleted: ${oldCode}`);
  } else {
    // Transfer host if needed
    if (!oldRoom.seats.some(s => s.isHost)) oldRoom.seats[0].isHost = true;
    broadcastLobby(oldRoom);
  }
}

io.on('connection', socket => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('create-room', ({ name } = {}) => {
    // Leave any previous room first
    leaveCurrentRoom(socket);

    const room = createRoom(socket, name);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.name = name;
    socket.emit('room-created', { code: room.code });
    broadcastLobby(room);
    console.log(`[Room] Created: ${room.code} by ${name}`);
  });

  socket.on('join-room', ({ code, name } = {}) => {
    const normCode = code?.toUpperCase();
    const room = rooms.get(normCode);
    if (!room) return socket.emit('error', { message: 'Room not found. Check the code and try again.' });
    if (room.phase === 'playing') return socket.emit('error', { message: 'A hand is already in progress. Wait for it to finish.' });
    if (room.seats.length >= MAX_SEATS) return socket.emit('error', { message: 'This table is full (4 players max).' });
    // Already in this room?
    if (room.seats.some(s => s.id === socket.id)) return;

    // Leave any previous room first
    leaveCurrentRoom(socket);

    const player = {
      id: socket.id,
      name: name || 'Player',
      avatar: name ? name.slice(0, 2).toUpperCase() : 'PL',
      chips: STARTING_CHIPS,
      isBot: false,
      isHost: false,
    };
    room.seats.push(player);
    socket.join(normCode);
    socket.data.roomCode = normCode;
    socket.data.name = name;
    socket.emit('room-joined', { code: normCode });
    broadcastLobby(room);
    console.log(`[Room] ${name} joined ${normCode}`);
  });

  socket.on('start-game', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    // Only host can start
    if (room.seats[0].id !== socket.id) return socket.emit('error', { message: 'Only the host can start the game.' });
    if (room.seats.length < 1) return socket.emit('error', { message: 'Need at least 1 player to start.' });

    startGame(room);
    broadcastGameState(room);
    io.to(room.code).emit('game-started');
    console.log(`[Game] Started in room ${code}`);
  });

  socket.on('player-action', ({ action, raiseAmount } = {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    playerAction(room, socket.id, action, raiseAmount);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const name = socket.data.name || 'Player';
    console.log(`[-] ${socket.id} left ${code}`);

    if (room.phase === 'playing' && room.game) {
      // Auto-fold the disconnected player in the active game
      const gp = room.game.players.find(p => p.id === socket.id);
      if (gp && !gp.folded) {
        gp.folded = true;
        gp.action = 'Fold';
        gp.actedThisStreet = true;
      }
      io.to(code).emit('player-left', { name });
    }

    room.seats = room.seats.filter(s => s.id !== socket.id);

    if (room.seats.length === 0) {
      clearActionTimer(room);
      rooms.delete(code);
      console.log(`[Room] Deleted: ${code}`);
      return;
    }

    // Transfer host if needed
    if (!room.seats.some(s => s.isHost)) room.seats[0].isHost = true;

    if (room.phase === 'playing' && room.game) {
      const humansLeft = room.seats.length; // seats only has humans
      if (humansLeft === 0) {
        clearActionTimer(room);
        room.phase = 'lobby';
        room.game = null;
        broadcastLobby(room);
      } else {
        // Check if it was the disconnected player's turn — advance if so
        const cur = room.game.players[room.game.currentPlayerIndex];
        if (cur && cur.id === socket.id) {
          nextTurn(room);
        } else {
          broadcastGameState(room);
        }
      }
    } else {
      broadcastLobby(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  const localIp = getLocalIp();
  console.log(`\n🃏  Nexbe Poker server running!`);
  console.log(`    Local (You):       http://localhost:${PORT}/poker`);
  console.log(`    Same Wi-Fi:        http://${localIp}:${PORT}/poker`);
  if (process.argv.includes('--tunnel') || process.env.TUNNEL === 'true') {
    await startTunnel(PORT);
  }
  console.log('');
});
