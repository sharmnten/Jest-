# Jest Quiplash Game 🎮

A multiplayer party game similar to Quiplash, built with vanilla JavaScript and Appwrite backend.

## ✅ What's Been Fixed

### Critical Bug Fixes
- ✅ **Implemented missing `subscribeVotes()` function** - Real-time vote tracking now works
- ✅ **Fixed authentication flow** - Improved registration/login with retry logic
- ✅ **Fixed memory leaks** - Added proper subscription cleanup
- ✅ **Fixed voting system** - Prevents self-voting and multiple votes
- ✅ **Fixed race conditions** - Synchronized game state transitions
- ✅ **Fixed timer conflicts** - Proper timer cleanup between phases

### New Features Added
- ✅ **Environment configuration** - Centralized config in `config.js`
- ✅ **Package.json** - Proper project setup with npm scripts
- ✅ **Minimum/maximum player validation** - 2-8 players required
- ✅ **Better error handling** - Try-catch blocks and user feedback
- ✅ **Input validation** - Null checks and length limits
- ✅ **Auto-session detection** - Remembers logged-in users
- ✅ **Cleanup on page unload** - Prevents resource leaks
- ✅ **Game rounds limit** - 5 rounds per game with final results
- ✅ **Separated prompt pools** - Game-specific vs global prompts

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Appwrite
Follow the detailed setup in `APPWRITE_SETUP.md` to:
- Create your Appwrite project
- Set up the database and collections
- Configure permissions

### 3. Update Configuration
Edit `config.js` with your Appwrite settings:
```javascript
APPWRITE_ENDPOINT: 'YOUR_ENDPOINT',
APPWRITE_PROJECT_ID: 'YOUR_PROJECT_ID',
```

### 4. Start the Game
```bash
npm start
# Or for development with auto-open:
npm run dev
```

Then open http://localhost:8080 in your browser.

## 🎮 How to Play

1. **Register/Login** - Create an account or login
2. **Create or Join Game** - Host creates a 4-letter code, others join
3. **Submit Prompts** - Each player submits a funny prompt
4. **Answer Prompts** - Write funny answers to random prompts (30 seconds)
5. **Vote** - Vote for the funniest answers (20 seconds)
6. **Score** - Points awarded based on votes received
7. **Repeat** - Play up to 5 rounds

## 📁 Project Structure

```
Jest-/
├── index.html          # Main HTML structure
├── app.js             # Game logic (fixed)
├── style.css          # Styles and animations
├── config.js          # Configuration settings
├── package.json       # Project dependencies
├── APPWRITE_SETUP.md  # Backend setup guide
└── README.md          # This file
```

## 🔧 Configuration Options

In `config.js` you can adjust:
- Timer durations (prompt/voting)
- Min/max players (2-8)
- Rounds per game (5)
- Debug mode settings

## 🐛 Troubleshooting

### Game won't start?
- Ensure all players have submitted prompts
- Need minimum 2 players
- Only host can start the game

### Authentication issues?
- Check Appwrite project ID matches config
- Verify email/password auth is enabled
- Clear browser cookies and retry

### Real-time not working?
- Verify Appwrite realtime is enabled
- Check browser console for WebSocket errors
- Ensure proper collection permissions

### Database errors?
- Follow `APPWRITE_SETUP.md` exactly
- Verify all collections exist with correct attributes
- Check collection permissions allow user access

## 🎯 Game Features

- **Real-time multiplayer** - Live updates for all players
- **Voting system** - Democratic humor detection
- **Score tracking** - Competitive leaderboard
- **Custom prompts** - Player-submitted content
- **Responsive design** - Works on mobile and desktop
- **Session persistence** - Stay logged in
- **Auto-cleanup** - Orphaned games removed

## 📝 Development

### Running Locally
```bash
# Using Node.js http-server
npm run dev

# Using Python (alternative)
npm run serve
```

### Debug Mode
Set `DEBUG_MODE: true` in `config.js` to:
- Show debug button in lobby
- Enable console logging
- Display game state info

## 🚦 Game Status

The game is now **fully functional** with all critical bugs fixed:
- ✅ User registration and login
- ✅ Game creation and joining
- ✅ Prompt submission
- ✅ Answer submission with timer
- ✅ Voting phase with real-time updates
- ✅ Score tracking and leaderboard
- ✅ Multiple rounds support
- ✅ Clean game ending

## 📚 Technologies Used

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Appwrite (BaaS)
- **Real-time**: Appwrite Subscriptions
- **Database**: Appwrite Database
- **Authentication**: Appwrite Auth

## 🤝 Contributing

Feel free to submit issues or pull requests to improve the game!

## 📄 License

MIT License - feel free to use this code for your own projects!

---

**Enjoy playing Jest Quiplash! 🎉**