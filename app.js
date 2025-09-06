import { Client, Account, Database } from 'appwrite';

const client = new Client()
  .setEndpoint('https://nyc.cloud.appwrite.io/v1')
  .setProject('jest');

const account = new Account(client);
const database = new Database(client);

let currentUser = null;
let currentGame = null;
let currentPrompt = null;
let currentAnswers = [];
let round = 1;

// Timers
let promptTimerInterval, votingTimerInterval;

// --- Login ---
async function loginAnon(name) {
  await account.createAnonymousSession();
  const userId = (await account.get()).$id;
  currentUser = { name, id: userId };
}

// --- Create Game ---
async function createGame() {
  const name = document.getElementById('playerName').value || 'Player';
  await loginAnon(name);

  const gameCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  currentGame = await database.createDocument(
    'jestblank_db',    // databaseId
    'games',           // collectionId
    'unique()',        // documentId
    {
      code: gameCode,
      players: [{ id: currentUser.id, name: currentUser.name }],
      status: 'waiting'
    }
  );

  document.getElementById('login').style.display = 'none';
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('lobbyCode').innerText = gameCode;
  subscribeLobby();
}

// --- Join Game ---
async function joinGame() {
  const name = document.getElementById('playerName').value || 'Player';
  await loginAnon(name);

  const code = document.getElementById('gameCode').value.toUpperCase();
  const gameList = await database.listDocuments(
    'jestblank_db', 
    'games',
    [Appwrite.Query.equal('code', code)]
  );

  if (!gameList.documents.length) return alert("Game not found!");
  currentGame = gameList.documents[0];

  currentGame.players.push({ id: currentUser.id, name: currentUser.name });
  await database.updateDocument(
    'jestblank_db',
    'games',
    currentGame.$id,
    { players: currentGame.players }
  );

  document.getElementById('login').style.display = 'none';
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('lobbyCode').innerText = code;
  subscribeLobby();
}

// --- Lobby Subscription ---
function subscribeLobby() {
  const playerList = document.getElementById('playerList');
  client.subscribe(`databases.jestblank_db.documents.${currentGame.$id}`, response => {
    if (response.events.includes('database.documents.update')) {
      currentGame = response.payload;
      playerList.innerHTML = '';
      currentGame.players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name;
        li.classList.add('fade-in');
        playerList.appendChild(li);
      });
    }
  });
}

// --- Prompt Submission ---
let customPrompts = [];
function showPromptSubmission() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('submitPrompts').style.display = 'block';
}

async function addPrompt() {
  const text = document.getElementById('customPromptInput').value.trim();
  if (!text) return alert("Type a prompt!");
  const promptDoc = await database.createDocument(
    'jestblank_db',
    'prompts',
    'unique()',
    { text, submittedBy: currentUser.id }
  );
  customPrompts.push(promptDoc);
  const ul = document.getElementById('promptList');
  const li = document.createElement('li');
  li.innerText = text;
  li.classList.add('fade-in');
  ul.appendChild(li);
  document.getElementById('customPromptInput').value = '';
}

// --- Start Game ---
async function startGame() {
  const prompts = await database.listDocuments('jestblank_db', 'prompts');
  if (prompts.total < currentGame.players.length) return alert("Need more prompts!");
  currentPrompt = prompts.documents[Math.floor(Math.random() * prompts.total)].text;
  await database.updateDocument(
    'jestblank_db',
    'games',
    currentGame.$id,
    { status: 'in-progress', currentPrompt }
  );
  document.getElementById('submitPrompts').style.display = 'none';
  showPrompt();
}

// --- Show Prompt & Answer ---
function showPrompt() {
  document.getElementById('prompt').style.display = 'block';
  const promptText = document.getElementById('promptText');
  promptText.innerText = currentPrompt;
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
  await database.createDocument(
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
  document.getElementById('prompt').style.display = 'none';
}

// --- Answers Subscription ---
function subscribeAnswers() {
  currentAnswers = [];
  client.subscribe(`databases.jestblank_db.documents`, response => {
    if (response.events.includes('database.documents.create')) {
      const doc = response.payload;
      if (doc.gameId === currentGame.$id) currentAnswers.push(doc);
      if (currentAnswers.length + 1 === currentGame.players.length) startVoting();
    }
  });
}

// --- Start Voting ---
function startVoting() {
  document.getElementById('voting').style.display = 'block';
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
  await database.updateDocument(
    'jestblank_db',
    'answers',
    answerId,
    { votes: answer.votes + 1 }
  );
  document.getElementById('voting').style.display = 'none';
  showLeaderboard();
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
    const li = document.createElement('li');
    li.innerText = `${p.name}: ${scores[p.id] || 0} points`;
    li.classList.add('score-update');
    scoreList.appendChild(li);
  });
  document.getElementById('leaderboard').style.display = 'block';
}

// --- Next Round ---
async function nextRound() {
  round++;
  const prompts = await database.listDocuments('jestblank_db', 'prompts');
  currentPrompt = prompts.documents[Math.floor(Math.random() * prompts.total)].text;
  document.getElementById('leaderboard').style.display = 'none';
  showPrompt();
}

// --- Event Listeners ---
document.getElementById('createGame').addEventListener('click', createGame);
document.getElementById('joinGame').addEventListener('click', joinGame);
document.getElementById('submitPromptsBtn').addEventListener('click', showPromptSubmission);
document.getElementById('addPrompt').addEventListener('click', addPrompt);
document.getElementById('startGame').addEventListener('click', startGame);
document.getElementById('submitAnswer').addEventListener('click', submitAnswer);
document.getElementById('nextRoundBtn').addEventListener('click', nextRound);
