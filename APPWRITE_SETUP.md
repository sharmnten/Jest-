# Appwrite Setup Guide for Jest Quiplash Game

This guide will help you set up Appwrite backend for the Jest Quiplash game.

## Prerequisites

1. An Appwrite instance (cloud or self-hosted)
2. Admin access to create projects and configure databases

## Step 1: Create Appwrite Project

1. Log in to your Appwrite console
2. Create a new project with ID: `jest` (or update `config.js` with your project ID)
3. Note your project endpoint URL

## Step 2: Configure Authentication

1. Navigate to **Auth** → **Settings**
2. Enable **Email/Password** authentication
3. Optional: Configure email verification settings
4. Set session length as needed (default: 365 days)

## Step 3: Create Database

1. Navigate to **Databases**
2. Create a new database with ID: `jestblank_db`
3. Name it "Jest Game Database"

## Step 4: Create Collections

### Collection 1: Games

**Collection ID:** `games`

**Attributes:**
| Attribute | Type | Size | Required | Default | Array |
|-----------|------|------|----------|---------|-------|
| code | String | 10 | Yes | - | No |
| players | String | 2000 | No | - | Yes |
| hostId | String | 100 | No | - | No |
| status | String | 20 | Yes | waiting | No |
| currentPrompt | String | 500 | No | - | No |
| submittedPrompts | String | 100 | No | - | Yes |

**Indexes:**
- `code_idx` on `code` field (for quick game lookup)
- `status_idx` on `status` field (for filtering)

### Collection 2: Prompts

**Collection ID:** `prompts`

**Attributes:**
| Attribute | Type | Size | Required | Default | Array |
|-----------|------|------|----------|---------|-------|
| text | String | 500 | Yes | - | No |
| submittedBy | String | 100 | Yes | - | No |
| gameId | String | 100 | No | - | No |

**Indexes:**
- `gameId_idx` on `gameId` field (for game-specific prompts)

### Collection 3: Answers

**Collection ID:** `answers`

**Attributes:**
| Attribute | Type | Size | Required | Default | Array |
|-----------|------|------|----------|---------|-------|
| gameId | String | 100 | Yes | - | No |
| playerId | String | 100 | Yes | - | No |
| promptText | String | 500 | Yes | - | No |
| votes | Integer | - | Yes | 0 | No |

**Indexes:**
- `gameId_idx` on `gameId` field (for retrieving game answers)
- `playerId_idx` on `playerId` field (for player lookups)

## Step 5: Configure Permissions

For each collection, set the following permissions:

### Document Security
- **Create:** Role: Users
- **Read:** Role: Users
- **Update:** Role: Users
- **Delete:** Role: Users

### Collection Security
Enable the same permissions at collection level.

## Step 6: Enable Realtime

1. Navigate to **Settings** → **Realtime**
2. Ensure realtime is enabled for your project
3. Verify that document-level subscriptions are allowed

## Step 7: Update Configuration

Edit `config.js` with your Appwrite settings:

```javascript
const CONFIG = {
  APPWRITE_ENDPOINT: 'YOUR_APPWRITE_ENDPOINT', // e.g., 'https://cloud.appwrite.io/v1'
  APPWRITE_PROJECT_ID: 'YOUR_PROJECT_ID',
  DATABASE_ID: 'jestblank_db',
  // ... rest of config
};
```

## Step 8: Test the Setup

1. Open the game in a browser
2. Try registering a new account
3. Create a test game
4. Join from another browser/incognito window
5. Submit prompts and start the game

## Troubleshooting

### "Unknown attribute" errors
- Check that all collection attributes match the schema above
- Ensure attribute names are spelled correctly

### Authentication issues
- Verify Email/Password auth is enabled
- Check that the project ID matches
- Clear browser cookies and try again

### Realtime not working
- Ensure realtime is enabled in Appwrite settings
- Check browser console for WebSocket errors
- Verify collection permissions allow subscriptions

### Database not found
- Ensure database ID is exactly `jestblank_db`
- Check that collections are created with correct IDs

## Performance Optimization

1. **Add Indexes:** Create indexes on frequently queried fields
2. **Set Rate Limits:** Configure rate limiting in Appwrite to prevent abuse
3. **Enable Caching:** Use Appwrite's built-in caching where available
4. **Monitor Usage:** Check Appwrite dashboard for performance metrics

## Security Best Practices

1. **API Keys:** Never expose admin API keys in client code
2. **Permissions:** Use role-based permissions appropriately
3. **Validation:** Appwrite handles basic validation, but add client-side checks
4. **SSL:** Always use HTTPS endpoints
5. **Session Management:** Configure appropriate session timeouts

## Backup and Recovery

1. Regular backups of your Appwrite database
2. Export collection schemas for disaster recovery
3. Test restore procedures periodically

## Support

For Appwrite-specific issues:
- [Appwrite Documentation](https://appwrite.io/docs)
- [Appwrite Discord](https://appwrite.io/discord)
- [Appwrite GitHub](https://github.com/appwrite/appwrite)

For game-specific issues:
- Check the browser console for errors
- Verify all collections and attributes are created correctly
- Ensure permissions are set properly