

// Load configuration
const config = window.CONFIG || {
  APPWRITE_ENDPOINT: 'https://nyc.cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID: 'jest',
  DATABASE_ID: 'jestblank_db',
  COLLECTIONS: {
    GAMES: 'games',
    PROMPTS: 'prompts',
    ANSWERS: 'answers'
  },
  GAME_SETTINGS: {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 8,
    PROMPT_TIMER_SECONDS: 30,
    VOTING_TIMER_SECONDS: 20,
    ROUNDS_PER_GAME: 5
  },
  DEBUG_MODE: false,
  SHOW_DEBUG_BUTTON: false
};

const client = new Appwrite.Client();
client.setEndpoint(config.APPWRITE_ENDPOINT);
client.setProject(config.APPWRITE_PROJECT_ID);

const account = new Appwrite.Account(client);
const database = new Appwrite.Databases(client);

let currentUser = null;
let currentGame = null;
let currentPrompt = null;
let currentAnswers = [];
let round = 1;
let activeSubscriptions = [];  // Track all active subscriptions for cleanup
let hasVoted = false;  // Track if current user has voted this round
let isVotingPhase = false;  // Prevent race conditions in voting phase

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
    // Register the user
    await registerUser(email, password, name);
    
    // Attempt login with retry logic
    let loginAttempts = 0;
    const maxAttempts = 3;
    
    const attemptLogin = async () => {
      try {
        await loginUser(email, password);
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('gameOptions').style.display = 'block';
        document.getElementById('globalPrompt').style.display = 'block';
        return true;
      } catch (err) {
        loginAttempts++;
        if (loginAttempts < maxAttempts) {
          // Wait and retry
          await new Promise(resolve => setTimeout(resolve, 1000));
          return attemptLogin();
        }
        return false;
      }
    };
    
    const success = await attemptLogin();
    if (!success) {
      alert('Registration successful! Please log in manually.');
      document.getElementById('registerForm').style.display = 'none';
      document.getElementById('loginForm').style.display = 'block';
      // Pre-fill the email for convenience
      document.getElementById('loginEmail').value = email;
    }
  } catch (err) {
    console.error('Registration error:', err);
    alert(err.message || 'Registration failed.');
  }
});

// --- Login Button ---
document.getElementById('loginBtn').addEventListener('click', async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return alert('Please fill all fields.');
  
  // Disable button during login
  const loginBtn = document.getElementById('loginBtn');
  const originalText = loginBtn.innerText;
  loginBtn.innerText = 'Logging in...';
  loginBtn.disabled = true;
  
  try {
    await loginUser(email, password);
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('gameOptions').style.display = 'block';
    document.getElementById('globalPrompt').style.display = 'block';
  } catch (err) {
    alert(err.message || 'Login failed.');
  } finally {
    loginBtn.innerText = originalText;
    loginBtn.disabled = false;
  }
});
async function registerUser(email, password, name) {
  try {
    const result = await account.create('unique()', email, password, name);
    return result;
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 409) {
      throw new Error('User with this email already exists.');
    }
    throw error;
  }
}

async function loginUser(email, password) {
  try {
    // First, try to delete any existing session
    try {
      await account.deleteSession('current');
    } catch (err) {
      // Ignore if no session exists
    }
    
    // Create new session
    await account.createEmailPasswordSession(email, password);
    const user = await account.get();
    currentUser = { name: user.name || user.email, id: user.$id };
    
    // Clean up orphaned games after successful login
    cleanupOrphanedGames();
  } catch (err) {
    console.error('Login error:', err);
    throw new Error('Login failed. Please check your credentials.');
  }
}

async function cleanupOrphanedGames() {
  try {
    // Clean up games with no players and status 'waiting' so codes can be reused
    const waitingGames = await database.listDocuments(config.DATABASE_ID, config.COLLECTIONS.GAMES, 
      [Appwrite.Query.equal('status', 'waiting')]);
    for (const game of waitingGames.documents) {
      if (!game.players || game.players.length === 0) {
        await database.deleteDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, game.$id);
      }
    }
    
    // Update in-progress games with no players
    const activeGames = await database.listDocuments(config.DATABASE_ID, config.COLLECTIONS.GAMES, 
      [Appwrite.Query.equal('status', 'in-progress')]);
    for (const game of activeGames.documents) {
      if (!game.players || game.players.length === 0) {
        await safeUpdateDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, game.$id, { status: 'waiting' });
      }
      // Backfill hostId for legacy games
      if (game.players && game.players.length > 0 && !game.hostId) {
        const hostId = game.players[0].split(":")[0];
        try {
          await safeUpdateDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, game.$id, { hostId });
        } catch (e) {
          // ignore
        }
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err);
    // Don't throw - this is just cleanup
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
    config.DATABASE_ID,    // databaseId
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
    config.DATABASE_ID, 
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
      config.DATABASE_ID,
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
  // Clean up any existing subscriptions before creating new ones
  cleanupSubscriptions();
  
  const playerList = document.getElementById('playerList');
  // Ensure a debug button exists in lobby for quick inspection
  if (config.SHOW_DEBUG_BUTTON || config.DEBUG_MODE) {
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
  }

  const subscription = client.subscribe(`databases.jestblank_db.documents.${currentGame.$id}`, response => {
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
            safeUpdateDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, currentGame.$id, { status: 'waiting' }).catch(()=>{});
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
  activeSubscriptions.push(subscription);
}

// --- Prompt Submission ---
let customPrompts = [];
function showPromptSubmission() {
  // No longer needed, prompt box is in lobby
}

async function addPrompt() {
  const input = document.getElementById('customPromptInput');
  if (!input) {
    console.error('customPromptInput element not found');
    return;
  }
  
  const text = input.value.trim();
  if (!text) return alert("Type a prompt!");
  
  // Validate prompt length
  if (text.length > 500) {
    return alert("Prompt is too long! Maximum 500 characters.");
  }
  const promptDoc = await safeCreateDocument(
    config.DATABASE_ID,
    config.COLLECTIONS.PROMPTS,
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
  await safeUpdateDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, currentGame.$id, { submittedPrompts: submitted });
  // Update local cache so UI immediately reflects submission
  currentGame.submittedPrompts = submitted;
  }
}

// --- Start Game ---
async function startGame() {
  console.log('startGame invoked', { currentUser, currentGame });
  
  // Input validation
  if (!currentGame) {
    try {
      const code = document.getElementById('lobbyCode').innerText;
      const list = await database.listDocuments(config.DATABASE_ID, config.COLLECTIONS.GAMES, [Appwrite.Query.equal('code', code)]);
      if (!list.documents.length) return alert('Game not found.');
      currentGame = list.documents[0];
    } catch (err) {
      console.error('Failed to fetch currentGame', err);
      return alert('Failed to fetch game. See console for details.');
    }
  }
  // Refresh currentGame from server to get up-to-date submittedPrompts/players
  try {
    const fresh = await database.getDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, currentGame.$id);
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
  
  // Check minimum players
  if (currentGame.players.length < config.GAME_SETTINGS.MIN_PLAYERS) {
    return alert(`Need at least ${config.GAME_SETTINGS.MIN_PLAYERS} players to start the game.`);
  }
  
  // Check maximum players
  if (currentGame.players.length > config.GAME_SETTINGS.MAX_PLAYERS) {
    return alert(`Too many players! Maximum is ${config.GAME_SETTINGS.MAX_PLAYERS}.`);
  }
  
  // Ensure all players have submitted prompts
  const submitted = currentGame.submittedPrompts || [];
  if (submitted.length < currentGame.players.length) {
    console.log('startGame blocked: not enough submitted prompts', { submittedLength: submitted.length, playersLength: currentGame.players.length });
    return alert("All players must submit a prompt before starting the game.");
  }
  // Only use prompts for this specific game
  const prompts = await database.listDocuments(config.DATABASE_ID, config.COLLECTIONS.PROMPTS, 
    [Appwrite.Query.equal('gameId', currentGame.$id)]);
  if (prompts.total < 1) {
    return alert("No prompts available! Each player must submit at least one prompt.");
  }
  currentPrompt = prompts.documents[Math.floor(Math.random() * prompts.total)].text;
  try {
    await safeUpdateDocument(
      config.DATABASE_ID,
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
      const fresh = await database.getDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, currentGame.$id);
      await safeUpdateDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, fresh.$id, { status: 'in-progress' });
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
  const promptDiv = document.getElementById('prompt');
  const promptText = document.getElementById('promptText');
  const answerInput = document.getElementById('answerInput');
  
  // Null checks
  if (!promptDiv || !promptText || !answerInput) {
    console.error('Required prompt elements not found');
    return;
  }
  
  promptDiv.classList.remove('fade-out');
  promptDiv.style.display = 'block';
  promptDiv.classList.add('fade-in');
  
  // Always use the prompt from the game document
  promptText.innerText = currentGame.currentPrompt || 'No prompt available';
  promptText.classList.add('slide-in');
  
  // Clear previous answer
  answerInput.value = '';
  
  startPromptTimer(config.GAME_SETTINGS.PROMPT_TIMER_SECONDS);
  subscribeAnswers();
}

// --- Prompt Timer ---
function startPromptTimer(seconds) {
  // Clear any existing timer first
  if (promptTimerInterval) {
    clearInterval(promptTimerInterval);
    promptTimerInterval = null;
  }
  
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
  const answerInput = document.getElementById('answerInput');
  if (!answerInput) {
    console.error('answerInput element not found');
    return;
  }
  
  let answerText = answerInput.value.trim();
  if (!answerText) answerText = "(No answer)";
  
  // Validate answer length
  if (answerText.length > 500) {
    alert('Answer is too long! Maximum 500 characters.');
    return;
  }
  
  try {
    await safeCreateDocument(
      config.DATABASE_ID,
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
  } catch (err) {
    console.error('Failed to submit answer:', err);
    alert('Failed to submit answer. Please try again.');
  }
}

// --- Answers Subscription ---
function subscribeAnswers() {
  currentAnswers = [];
  const subscription = client.subscribe(`databases.jestblank_db.documents`, response => {
    if (response.events.includes('database.documents.create')) {
      const doc = response.payload;
      if (doc.gameId === currentGame.$id) currentAnswers.push(doc);
      // Only start voting when all answers are submitted and not already in voting phase
      if (!isVotingPhase && currentAnswers.length === currentGame.players.length) {
        isVotingPhase = true;
        startVoting();
      }
    }
  });
  activeSubscriptions.push(subscription);
}

// --- Start Voting ---
function startVoting() {
  // Prevent multiple calls
  if (document.getElementById('voting').style.display === 'block') return;
  
  document.getElementById('voting').classList.remove('fade-out');
  document.getElementById('voting').style.display = 'block';
  document.getElementById('voting').classList.add('fade-in');
  startVotingTimer(config.GAME_SETTINGS.VOTING_TIMER_SECONDS);
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
    if (!b) b = { playerId: 'dummy', promptText: 'Randomly skipped', $id: 'dummy' };
    const btnA = document.createElement('button');
    btnA.innerText = a.promptText;
    btnA.dataset.answerId = a.$id;
    btnA.classList.add('fade-in');
    btnA.onclick = () => vote(a.$id, a.playerId);
    const btnB = document.createElement('button');
    btnB.innerText = b.promptText;
    btnB.dataset.answerId = b.$id;
    btnB.classList.add('fade-in');
    btnB.onclick = () => vote(b.$id, b.playerId);
    container.appendChild(btnA);
    container.appendChild(btnB);
    container.appendChild(document.createElement('hr'));
  }
  hasVoted = false;
  subscribeVotes();
}

// --- Voting Timer ---
function startVotingTimer(seconds) {
  // Clear any existing timer first
  if (votingTimerInterval) {
    clearInterval(votingTimerInterval);
    votingTimerInterval = null;
  }
  
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
async function vote(answerId, playerId) {
  // Prevent self-voting and multiple votes
  if (answerId === 'self' || answerId === 'dummy') return;
  if (playerId === currentUser.id) {
    alert("You can't vote for your own answer!");
    return;
  }
  if (hasVoted) {
    alert("You've already voted this round!");
    return;
  }
  hasVoted = true;
  
  try {
    const answer = await database.getDocument(config.DATABASE_ID, config.COLLECTIONS.ANSWERS, answerId);
    await safeUpdateDocument(
      config.DATABASE_ID,
      'answers',
      answerId,
      { votes: answer.votes + 1 }
    );
  } catch (err) {
    console.error('Failed to record vote:', err);
    hasVoted = false;  // Allow retry on error
    alert('Failed to record vote. Please try again.');
    return;
  }
  
  document.getElementById('voting').classList.add('fade-out');
  setTimeout(() => {
    document.getElementById('voting').style.display = 'none';
    showLeaderboard();
  }, 300);
}

// --- Leaderboard ---
async function showLeaderboard() {
  const answers = await database.listDocuments(
    config.DATABASE_ID,
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
  isVotingPhase = false;  // Reset voting phase flag
  hasVoted = false;  // Reset vote tracking
  
  // Check if game has reached max rounds
  if (round > config.GAME_SETTINGS.ROUNDS_PER_GAME) {
    showFinalResults();
    return;
  }
  
  try {
    // Get prompts for this specific game only
    const prompts = await database.listDocuments(config.DATABASE_ID, config.COLLECTIONS.PROMPTS,
      [Appwrite.Query.equal('gameId', currentGame.$id)]);
    
    if (prompts.documents.length === 0) {
      alert('No more prompts available for this game!');
      showFinalResults();
      return;
    }
    
    // Pick a random prompt that hasn't been used yet
    const unusedPrompts = prompts.documents.filter(p => p.text !== currentGame.currentPrompt);
    if (unusedPrompts.length === 0) {
      alert('All prompts have been used!');
      showFinalResults();
      return;
    }
    
    currentPrompt = unusedPrompts[Math.floor(Math.random() * unusedPrompts.length)].text;
    
    // Update game with new prompt
    await safeUpdateDocument(config.DATABASE_ID, config.COLLECTIONS.GAMES, currentGame.$id, 
      { currentPrompt });
  } catch (err) {
    console.error('Failed to get next round prompt:', err);
    alert('Failed to start next round. Please try again.');
    return;
  }
  const leaderboardDiv = document.getElementById('leaderboard');
  if (leaderboardDiv) {
    leaderboardDiv.classList.add('fade-out');
    setTimeout(() => {
      leaderboardDiv.style.display = 'none';
      showPrompt();
    }, 300);
  }
}

// --- Show Final Results ---
function showFinalResults() {
  const leaderboardDiv = document.getElementById('leaderboard');
  const nextRoundBtn = document.getElementById('nextRoundBtn');
  
  if (leaderboardDiv) {
    const h2 = leaderboardDiv.querySelector('h2');
    if (h2) h2.innerText = 'Final Results!';
  }
  
  if (nextRoundBtn) {
    nextRoundBtn.innerText = 'New Game';
    nextRoundBtn.onclick = () => {
      // Reset game state and go back to lobby
      cleanupSubscriptions();
      currentGame = null;
      currentAnswers = [];
      round = 1;
      isVotingPhase = false;
      hasVoted = false;
      window.location.reload();
    };
  }
}

// --- Subscribe to Votes ---
function subscribeVotes() {
  // Subscribe to vote updates on answers for current game
  const subscription = client.subscribe(`databases.jestblank_db.documents`, response => {
    if (response.events.includes('databases.documents.update')) {
      const doc = response.payload;
      // Check if this is an answer document for our game
      if (doc.gameId === currentGame.$id && doc.votes !== undefined) {
        // Update the vote count in UI if voting is still active
        const voteButtons = document.querySelectorAll('#voteOptions button');
        voteButtons.forEach(btn => {
          // Update button text if it matches this answer
          if (btn.dataset && btn.dataset.answerId === doc.$id) {
            const voteCount = doc.votes > 0 ? ` (${doc.votes} votes)` : '';
            btn.innerText = doc.promptText + voteCount;
          }
        });
      }
    }
  });
  activeSubscriptions.push(subscription);
}

// --- Cleanup Subscriptions ---
function cleanupSubscriptions() {
  activeSubscriptions.forEach(sub => {
    try {
      if (sub && typeof sub === 'function') {
        sub();  // Appwrite subscriptions return an unsubscribe function
      }
    } catch (err) {
      console.error('Error cleaning up subscription:', err);
    }
  });
  activeSubscriptions = [];
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

// --- Cleanup on page unload ---
window.addEventListener('beforeunload', () => {
  cleanupSubscriptions();
  // Clear timers
  if (promptTimerInterval) clearInterval(promptTimerInterval);
  if (votingTimerInterval) clearInterval(votingTimerInterval);
});

// --- Auto-check session on load ---
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const user = await account.get();
    if (user) {
      currentUser = { name: user.name || user.email, id: user.$id };
      document.getElementById('registerForm').style.display = 'none';
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('gameOptions').style.display = 'block';
      document.getElementById('globalPrompt').style.display = 'block';
    }
  } catch (err) {
    // No session, show login/register
    console.log('No active session');
  }
});

// --- Global Prompt Submission ---
document.getElementById('globalAddPrompt').addEventListener('click', async function() {
  const input = document.getElementById('globalPromptInput');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text) return alert('Type a prompt!');
  
  // Validate length
  if (text.length > 500) {
    return alert('Prompt is too long! Maximum 500 characters.');
  }
  
  try {
    // Submit to the global pool (no gameId - this is for future games)
    await safeCreateDocument(
      config.DATABASE_ID,
      config.COLLECTIONS.PROMPTS,
      'unique()',
      { text, submittedBy: currentUser ? currentUser.id : 'anon', gameId: 'global' }
    );
    // Add to the visible list
    const ul = document.getElementById('globalPromptList');
    if (ul) {
      const li = document.createElement('li');
      li.innerText = text;
      li.classList.add('fade-in');
      ul.appendChild(li);
    }
    input.value = '';
  } catch (err) {
    alert('Failed to submit prompt.');
  }
});
