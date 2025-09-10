

const client = new Appwrite.Client();
client.setEndpoint('https://nyc.cloud.appwrite.io/v1');
client.setProject('jest');

const account = new Appwrite.Account(client);
const database = new Appwrite.Databases(client);

let currentUser = null;
let currentGame = null;
let currentPrompt = null;
let currentAnswers = [];
let round = 1;

// Utility: dedupe players array by player id (prefix before ':')
function dedupePlayers(players) {
  const seen = new Set();
  const out = [];
  for (const p of (players || [])) {
    const id = p.split(":")[0];
    if (!seen.has(id)) { seen.add(id); out.push(p); }
  }
  return out;
}

// Timers
let promptTimerInterval, votingTimerInterval;

// Safe DB helpers: retry and strip unknown attributes reported by Appwrite
async function safeCreateDocument(databaseId, collectionId, documentId, data, retries = 3) {
  const payload = { ...data };
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await database.createDocument(databaseId, collectionId, documentId, payload);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const m = msg.match(/Unknown attribute[:\s]*\"?([^\"\s]+)\"?/i);
      if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) {
        // remove the offending attribute and retry
        delete payload[m[1]];
        continue;
      }
      throw err;
    }
  }
  throw new Error('safeCreateDocument: exceeded retries');
}

async function safeUpdateDocument(databaseId, collectionId, documentId, data, retries = 3) {
  const payload = { ...data };
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await database.updateDocument(databaseId, collectionId, documentId, payload);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const m = msg.match(/Unknown attribute[:\s]*\"?([^\"\s]+)\"?/i);
      if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) {
        delete payload[m[1]];
        continue;
      }
      throw err;
    }
  }
  throw new Error('safeUpdateDocument: exceeded retries');
}

// --- Login ---
// --- Registration & Login ---
// --- Registration Button ---
document.getElementById('registerBtn').addEventListener('click', async function() {
  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  if (!name || !email || !password) return alert('Please fill all fields.');
  if (password.length < 8) return alert('Password must be at least 8 characters.');
  try {
    await registerUser(email, password, name);
    // Wait a moment for registration to propagate
    setTimeout(async () => {
      try {
        await loginUser(email, password);
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('gameOptions').style.display = 'block';
        document.getElementById('globalPrompt').style.display = 'block';
      } catch (err) {
        alert('Registered, but login failed. Please try logging in.');
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
      }
    }, 500);
  } catch (err) {
    alert(err.message || 'Registration failed.');
  }
});

// --- Login Button ---
document.getElementById('loginBtn').addEventListener('click', async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return alert('Please fill all fields.');
  try {
    await loginUser(email, password);
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('gameOptions').style.display = 'block';
  document.getElementById('globalPrompt').style.display = 'block';
  } catch (err) {
    alert(err.message || 'Login failed.');
  }
});
async function registerUser(email, password, name) {
  try {
    await account.create('unique()', email, password, name);
  } catch (error) {
    if (error.code !== 409) throw error; // 409: user already exists
  }
}

async function loginUser(email, password) {
  // Clean up games with no players and status 'waiting' so codes can be reused
  try {
    const games = await database.listDocuments('jestblank_db', 'games', [Appwrite.Query.equal('status', 'waiting')]);
    for (const game of games.documents) {
      if (!game.players || game.players.length === 0) {
        await database.deleteDocument('jestblank_db', 'games', game.$id);
      }
    }
  } catch (err) {
    // Ignore errors, just a cleanup
  }
  try {
    // Try to get existing session
    const user = await account.get();
    currentUser = { name: user.name || user.email, id: user.$id };
  } catch (err) {
    // If no session, create one
    await account.createEmailPasswordSession(email, password);
    const user = await account.get();
    currentUser = { name: user.name || user.email, id: user.$id };
  }

  // After login, clean up orphaned games
  try {
    const games = await database.listDocuments('jestblank_db', 'games', [Appwrite.Query.equal('status', 'in-progress')]);
    for (const game of games.documents) {
      if (!game.players || game.players.length === 0) {
  await safeUpdateDocument('jestblank_db', 'games', game.$id, { status: 'waiting' });
      }
      // Backfill hostId for legacy games
      if (game.players && game.players.length > 0 && !game.hostId) {
        const hostId = game.players[0].split(":")[0];
        try {
          await safeUpdateDocument('jestblank_db', 'games', game.$id, { hostId });
        } catch (e) {
          // ignore
        }
      }
    }
  } catch (err) {
    // Ignore errors, just a cleanup
  }
}

// Render player list helper (global)
function renderPlayerList(game) {
  const ul = document.getElementById('playerList');
  const count = document.getElementById('playerCount');
  if (!game || !ul) return;
  const players = game.players || [];
  count.innerText = `Players in lobby: ${players.length}`;
  ul.innerHTML = '';
  for (const entry of players) {
    const parts = entry.split(":");
    const name = parts[1] || parts[0];
    const li = document.createElement('li');
    li.innerText = name;
    li.classList.add('fade-in');
    ul.appendChild(li);
  }
}

// --- Create Game ---
async function createGame() {
  const gameCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  currentGame = await safeCreateDocument(
    'jestblank_db',    // databaseId
    'games',           // collectionId
    'unique()',        // documentId
    {
  code: gameCode,
  players: [`${currentUser.id}:${currentUser.name}`],
  hostId: currentUser.id,
  status: 'waiting'
    }
  );

  document.getElementById('gameOptions').style.display = 'none';
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('lobbyCode').innerText = gameCode;
  document.getElementById('hostLabel').innerText = `Host: ${currentUser.name}`;
  renderPlayerList(currentGame);
  subscribeLobby();
}

// --- Join Game ---
async function joinGame() {
  const code = document.getElementById('gameCode').value.toUpperCase();
  const gameList = await database.listDocuments(
    'jestblank_db', 
    'games',
    [Appwrite.Query.equal('code', code)]
  );

  if (!gameList.documents.length) return alert("Game not found!");
  currentGame = gameList.documents[0];

  const entry = `${currentUser.id}:${currentUser.name}`;
  // Avoid duplicates: only add if player id not already present
  const hasId = (currentGame.players || []).some(p => p.split(":")[0] === currentUser.id);
  if (!hasId) {
    currentGame.players.push(entry);
    const deduped = dedupePlayers(currentGame.players);
    await safeUpdateDocument(
      'jestblank_db',
      'games',
      currentGame.$id,
      { players: deduped }
    );
    // update local copy to reflect server state
    currentGame.players = deduped;
  }

  document.getElementById('gameOptions').style.display = 'none';
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('lobbyCode').innerText = code;
  renderPlayerList(currentGame);
  subscribeLobby();
}

// --- Lobby Subscription ---
function subscribeLobby() {
  const playerList = document.getElementById('playerList');
  // Ensure a debug button exists in lobby for quick inspection
  const lobbyEl = document.getElementById('lobby');
  if (lobbyEl && !document.getElementById('debugShowState')) {
    const dbg = document.createElement('button');
    dbg.id = 'debugShowState';
    dbg.innerText = 'DEBUG: Show Game State';
    dbg.style.background = '#f39c12';
    dbg.style.marginTop = '1rem';
    dbg.onclick = () => {
      console.log('DEBUG currentGame', currentGame);
      alert('currentGame:\n' + JSON.stringify(currentGame, null, 2));
    };
    lobbyEl.appendChild(dbg);
  }

  client.subscribe(`databases.jestblank_db.documents.${currentGame.$id}`, response => {
    if (response.events.includes('database.documents.update')) {
      currentGame = response.payload;
      // Update host label
      const hostId = currentGame.hostId || (currentGame.players && currentGame.players[0] && currentGame.players[0].split(":")[0]);
      let hostDisplay = hostId;
      if (currentGame.players) {
        for (const entry of currentGame.players) {
          const parts = entry.split(":");
          if (parts[0] === hostId) { hostDisplay = parts[1] || parts[0]; break; }
        }
      }
      document.getElementById('hostLabel').innerText = `Host: ${hostDisplay}`;
      // Render player list and count
      renderPlayerList(currentGame);
      // If no players, set game status to 'waiting'
      if (!currentGame.players || currentGame.players.length === 0) {
        if (currentGame.status !== 'waiting') {
            safeUpdateDocument('jestblank_db', 'games', currentGame.$id, { status: 'waiting' }).catch(()=>{});
        }
        return;
      }
      // If game status is in-progress, show prompt for all users
      if (currentGame.status === 'in-progress') {
        console.log('subscribeLobby: game in-progress, showing prompt');
        showPrompt();
      } else if (currentGame.submittedPrompts && currentGame.submittedPrompts.length === currentGame.players.length) {
        // Enable start button only for host when all prompts are submitted
  const hostCandidate = currentGame.hostId || (currentGame.players && currentGame.players[0] && currentGame.players[0].split(":")[0]);
  const isHost = currentUser && hostCandidate && currentUser.id === hostCandidate;
        console.log('subscribeLobby: all prompts submitted', { submittedCount: currentGame.submittedPrompts.length, playersCount: currentGame.players.length, isHost });
        document.getElementById('startGame').disabled = !isHost;
        document.getElementById('startGame').innerText = isHost ? "Start Game" : "Waiting for host...";
      } else {
        console.log('subscribeLobby: waiting for prompts', { submitted: currentGame.submittedPrompts, players: currentGame.players });
        document.getElementById('startGame').disabled = true;
        document.getElementById('startGame').innerText = "Waiting for prompts...";
      }
    }
  });
}

// --- Prompt Submission ---
let customPrompts = [];
function showPromptSubmission() {
  // No longer needed, prompt box is in lobby
}

async function addPrompt() {
  const text = document.getElementById('customPromptInput').value.trim();
  if (!text) return alert("Type a prompt!");
  const promptDoc = await safeCreateDocument(
    'jestblank_db',
    'prompts',
    'unique()',
    { text, submittedBy: currentUser.id, gameId: currentGame.$id }
  );
  customPrompts.push(promptDoc);
  const ul = document.getElementById('promptList');
  const li = document.createElement('li');
  li.innerText = text;
  li.classList.add('fade-in');
  ul.appendChild(li);
  document.getElementById('customPromptInput').value = '';

  // Track submitted prompts in game document
  let submitted = currentGame.submittedPrompts || [];
  if (!submitted.includes(currentUser.id)) {
    submitted.push(currentUser.id);
  await safeUpdateDocument('jestblank_db', 'games', currentGame.$id, { submittedPrompts: submitted });
  // Update local cache so UI immediately reflects submission
  currentGame.submittedPrompts = submitted;
  }
}

// --- Start Game ---
async function startGame() {
  console.log('startGame invoked', { currentUser, currentGame });
  // Ensure we have a currentGame; try to load if missing
  if (!currentGame) {
    try {
      const code = document.getElementById('lobbyCode').innerText;
      const list = await database.listDocuments('jestblank_db', 'games', [Appwrite.Query.equal('code', code)]);
      if (!list.documents.length) return alert('Game not found.');
      currentGame = list.documents[0];
    } catch (err) {
      console.error('Failed to fetch currentGame', err);
      return alert('Failed to fetch game. See console for details.');
    }
  }
  // Refresh currentGame from server to get up-to-date submittedPrompts/players
  try {
    const fresh = await database.getDocument('jestblank_db', 'games', currentGame.$id);
    currentGame = fresh;
    console.log('startGame: refreshed currentGame from server', currentGame);
  } catch (err) {
    console.warn('startGame: failed to refresh currentGame', err);
  }
  // Only host can start the game
  const hostCandidate = currentGame.hostId || (currentGame.players && currentGame.players[0] && currentGame.players[0].split(":")[0]);
  const isHost = currentUser && hostCandidate && currentUser.id === hostCandidate;
  if (!isHost) {
    console.log('startGame blocked: not host', { isHost, currentUser, currentGame });
    return alert("Only the host can start the game.");
  }
  // Ensure all players have submitted prompts
  const submitted = currentGame.submittedPrompts || [];
  if (submitted.length < currentGame.players.length) {
    console.log('startGame blocked: not enough submitted prompts', { submittedLength: submitted.length, playersLength: currentGame.players.length });
    return alert("All players must submit a prompt before starting the game.");
  }
  // Only use prompts for this game
  const prompts = await database.listDocuments('jestblank_db', 'prompts', [Appwrite.Query.equal('gameId', currentGame.$id)]);
  if (prompts.total < currentGame.players.length) return alert("Need more prompts!");
  currentPrompt = prompts.documents[Math.floor(Math.random() * prompts.total)].text;
  try {
    await safeUpdateDocument(
      'jestblank_db',
      'games',
      currentGame.$id,
      { status: 'in-progress', currentPrompt }
    );
  } catch (err) {
    console.error('Failed to start game', err);
    return alert('Failed to start game. See console for details.');
  }

  // Dev helper: expose a force-start for testing (bypasses gating) on window
  window.forceStartGame = async function() {
    try {
      const fresh = await database.getDocument('jestblank_db', 'games', currentGame.$id);
      await safeUpdateDocument('jestblank_db', 'games', fresh.$id, { status: 'in-progress' });
      alert('Force-started game.');
    } catch (e) {
      console.error('forceStartGame failed', e);
      alert('Force start failed. See console.');
    }
  };
  const submitPromptsEl = document.getElementById('submitPrompts');
  if (submitPromptsEl) submitPromptsEl.style.display = 'none';
  // Host does not call showPrompt(); all users will transition via subscription
}

// --- Show Prompt & Answer ---
function showPrompt() {
  document.getElementById('prompt').classList.remove('fade-out');
  document.getElementById('prompt').style.display = 'block';
  document.getElementById('prompt').classList.add('fade-in');
  const promptText = document.getElementById('promptText');
  // Always use the prompt from the game document
  promptText.innerText = currentGame.currentPrompt;
  promptText.classList.add('slide-in');
  startPromptTimer(30);
  subscribeAnswers();
}

// --- Prompt Timer ---
function startPromptTimer(seconds) {
  const timerDiv = document.getElementById('promptTimer');
  const progress = document.getElementById('promptProgress');
  timerDiv.style.display = 'block';
  progress.style.width = '100%';
  let remaining = seconds;
  promptTimerInterval = setInterval(() => {
    remaining--;
    progress.style.width = (remaining / seconds * 100) + '%';
    if (remaining <= 5) progress.classList.add('warning');
    if (remaining <= 0) {
      clearInterval(promptTimerInterval);
      timerDiv.style.display = 'none';
      if (document.getElementById('prompt').style.display === 'block') submitAnswer();
    }
  }, 1000);
}

// --- Submit Answer ---
async function submitAnswer() {
  let answerText = document.getElementById('answerInput').value.trim();
  if (!answerText) answerText = "(No answer)";
  await safeCreateDocument(
    'jestblank_db',
    'answers',
    'unique()',
    {
      gameId: currentGame.$id,
      playerId: currentUser.id,
      promptText: answerText,
      votes: 0
    }
  );
  document.getElementById('prompt').classList.add('fade-out');
  setTimeout(() => {
    document.getElementById('prompt').style.display = 'none';
  }, 300);
}

// --- Answers Subscription ---
function subscribeAnswers() {
  currentAnswers = [];
  client.subscribe(`databases.jestblank_db.documents`, response => {
    if (response.events.includes('database.documents.create')) {
      const doc = response.payload;
      if (doc.gameId === currentGame.$id) currentAnswers.push(doc);
      // Only start voting when all answers are submitted
      if (currentAnswers.length === currentGame.players.length) startVoting();
    }
  });
}

// --- Start Voting ---
function startVoting() {
  document.getElementById('voting').classList.remove('fade-out');
  document.getElementById('voting').style.display = 'block';
  document.getElementById('voting').classList.add('fade-in');
  startVotingTimer(20);
  const container = document.getElementById('voteOptions');
  container.innerHTML = '';
  const allAnswers = [...currentAnswers];
  allAnswers.push({
    playerId: currentUser.id,
    promptText: document.getElementById('answerInput').value,
    $id: 'self'
  });
  const shuffled = allAnswers.sort(() => Math.random() - 0.5);
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i];
    let b = shuffled[i + 1];
    if (!b) b = { playerId: 'dummy', promptText: 'Randomly skipped' };
    const btnA = document.createElement('button');
    btnA.innerText = a.promptText;
    btnA.classList.add('fade-in');
    btnA.onclick = () => vote(a.$id);
    const btnB = document.createElement('button');
    btnB.innerText = b.promptText;
    btnB.classList.add('fade-in');
    btnB.onclick = () => vote(b.$id);
    container.appendChild(btnA);
    container.appendChild(btnB);
    container.appendChild(document.createElement('hr'));
  }
  subscribeVotes();
}

// --- Voting Timer ---
function startVotingTimer(seconds) {
  const timerDiv = document.getElementById('votingTimer');
  const progress = document.getElementById('votingProgress');
  timerDiv.style.display = 'block';
  progress.style.width = '100%';
  let remaining = seconds;
  votingTimerInterval = setInterval(() => {
    remaining--;
    progress.style.width = (remaining / seconds * 100) + '%';
    if (remaining <= 5) progress.classList.add('warning');
    if (remaining <= 0) {
      clearInterval(votingTimerInterval);
      timerDiv.style.display = 'none';
      document.getElementById('voting').style.display = 'none';
      showLeaderboard();
    }
  }, 1000);
}

// --- Vote ---
async function vote(answerId) {
  if (answerId === 'self' || answerId === 'dummy') return;
  const answer = await database.getDocument('jestblank_db', 'answers', answerId);
  await safeUpdateDocument(
    'jestblank_db',
    'answers',
    answerId,
    { votes: answer.votes + 1 }
  );
  document.getElementById('voting').classList.add('fade-out');
  setTimeout(() => {
    document.getElementById('voting').style.display = 'none';
    showLeaderboard();
  }, 300);
}

// --- Leaderboard ---
async function showLeaderboard() {
  const answers = await database.listDocuments(
    'jestblank_db',
    'answers',
    [Appwrite.Query.equal('gameId', currentGame.$id)]
  );
  const scores = {};
  answers.documents.forEach(a => {
    scores[a.playerId] = (scores[a.playerId] || 0) + a.votes;
  });
  const scoreList = document.getElementById('scoreList');
  scoreList.innerHTML = '';
  currentGame.players.forEach(p => {
    const parts = p.split(":");
    const id = parts[0];
    const name = parts[1] || parts[0];
    const li = document.createElement('li');
    li.innerText = `${name}: ${scores[id] || 0} points`;
    li.classList.add('score-update');
    scoreList.appendChild(li);
  });
  document.getElementById('leaderboard').classList.remove('fade-out');
  document.getElementById('leaderboard').style.display = 'block';
  document.getElementById('leaderboard').classList.add('fade-in');
}

// --- Next Round ---
async function nextRound() {
  round++;
  const prompts = await database.listDocuments('jestblank_db', 'prompts');
  currentPrompt = prompts.documents[Math.floor(Math.random() * prompts.total)].text;
  document.getElementById('leaderboard').classList.add('fade-out');
  setTimeout(() => {
    document.getElementById('leaderboard').style.display = 'none';
    showPrompt();
  }, 300);
}

// --- Event Listeners ---
// --- Registration/Login Form Switching ---
document.getElementById('showLogin').addEventListener('click', function(e) {
  e.preventDefault();
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
});

document.getElementById('showRegister').addEventListener('click', function(e) {
  e.preventDefault();
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
});
document.getElementById('createGame').addEventListener('click', createGame);
document.getElementById('joinGame').addEventListener('click', joinGame);
document.getElementById('addPrompt').addEventListener('click', addPrompt);
document.getElementById('startGame').addEventListener('click', startGame);
document.getElementById('submitAnswer').addEventListener('click', submitAnswer);
document.getElementById('nextRoundBtn').addEventListener('click', nextRound);

// --- Global Prompt Submission ---
document.getElementById('globalAddPrompt').addEventListener('click', async function() {
  const text = document.getElementById('globalPromptInput').value.trim();
  if (!text) return alert('Type a prompt!');
  try {
    // Submit to the crowd pool (no gameId)
    await safeCreateDocument(
      'jestblank_db',
      'prompts',
      'unique()',
      { text, submittedBy: currentUser ? currentUser.id : 'anon' }
    );
    // Add to the visible list
    const ul = document.getElementById('globalPromptList');
    const li = document.createElement('li');
    li.innerText = text;
    li.classList.add('fade-in');
    ul.appendChild(li);
    document.getElementById('globalPromptInput').value = '';
  } catch (err) {
    alert('Failed to submit prompt.');
  }
});
