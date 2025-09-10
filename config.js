// Configuration file for Jest Quiplash Game
// Replace these values with your own Appwrite project settings

const CONFIG = {
  // Appwrite Configuration
  APPWRITE_ENDPOINT: 'https://nyc.cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID: 'jest',
  DATABASE_ID: 'jestblank_db',
  
  // Collection Names
  COLLECTIONS: {
    GAMES: 'games',
    PROMPTS: 'prompts',
    ANSWERS: 'answers'
  },
  
  // Game Settings
  GAME_SETTINGS: {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 8,
    PROMPT_TIMER_SECONDS: 30,
    VOTING_TIMER_SECONDS: 20,
    ROUNDS_PER_GAME: 5
  },
  
  // Development Settings
  DEBUG_MODE: false,
  SHOW_DEBUG_BUTTON: false
};

// Export for use in app.js
window.CONFIG = CONFIG;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}