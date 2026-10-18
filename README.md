# NovaBroadcast v3.0

Advanced multi-client Discord broadcast system built with discord.js v14.  
Send DM broadcasts to your server members — fast, clean, and fully button-driven.

---

## Features

- **Multi-client support** — run multiple bots in parallel for maximum speed
- **Normal & Embed** message types — pick your style before sending
- **Target filtering** — broadcast to All / Online / Offline members
- **Live progress UI** — real-time updates with ETA, speed, and success rate
- **Auto report** — detailed report sent to a dedicated channel after each broadcast
- **Server thumbnail** — embed broadcasts automatically include your server icon
- **Fully button-driven** — no slash command arguments, everything runs through panels

---

## Getting Started

### Requirements

- Node.js v18+
- One or more Discord bot tokens
- A Discord server where the bots are members

### Installation

```bash
git clone https://github.com/youruser/novabroadcast.git
cd novabroadcast
npm install
```

### Configuration

Edit `config.json` before starting:

```json
{
    "bot": {
        "tokens": [
          "",
          "",
          "",
          "",
          ""
        ],
    "activity": {
        "name": "Powered By Nova Realm™",
        "type": "STREAMING",
        "url": "https://www.twitch.tv/nochannel",
        "status": "idle"
        }
    },
    "server": {
        "guildId": "1373311613465268284",
        "bcRoleId": "1378835197633626264",
        "reportChannelId": "1385068365504053310"
    },
    "colors": {
        "main": "#FFFFFF",
        "success": "#57F287",
        "warning": "#FEE75C",
        "error": "#ED4245",
        "canceled": "#5D5D5D"
    },
    "emojis": {
        "dot": "<:wdot:1524131703482876004>",
        "person": "<:personne:1547005111799390228>",
        "bot": "<:bot:1538926828201451530>",
        "time": "<:time:1538927187636264990>",
        "speed": "<a:fast:1524191150486065250>",
        "right": "<:right:1524196722056626217>",
        "less": "<:less:1524194424303783976>",
        "cancel": "<:can:1524196158958997514>",
        "msg": "<:msg:1538676123968213083>",
        "emmsg": "<:emmsg:1538676168679489619>",
        "members": "<:members:1524191804151431378>",
        "online": "<a:true_:1538681829509300274>",
        "offline": "<a:False:1538681929056911491>",
        "done": "<:done:1524196922963918858>",
        "broadcast": "<:ann:1538640733404143826>",
        "search": "<:search:1538640773690560635>"
},
    "prefix": "+"
}
```

| Field | Description |
|-------|-------------|
| `tokens` | Bot tokens — add up to 5 for faster broadcasts |
| `guildId` | Your server ID |
| `bcRoleId` | Only members with this role can use the broadcast |
| `reportChannelId` | Channel where the post-broadcast report is sent |
| `emojis` | Your emojis ID |

### Environment variables (recommended — Railway)

Do NOT commit tokens to `config.json`. Set these variables instead:

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Main bot token (handles commands, panels, reports) |
| `BOT_TOKEN_2` … `BOT_TOKEN_5` | Optional extra bots for faster broadcasts |
| `BOT_TOKENS` | Alternative: all tokens, comma separated |
| `GUILD_ID`, `BC_ROLE_ID`, `REPORT_CHANNEL_ID` | Optional overrides for `config.json` |
| `BOT_SETTINGS_FILE` | Optional path for the persisted activity and prefix settings file |
| `OWNER_IDS` | Comma- or space-separated Discord user IDs; these environment owners receive bot failure and removal alerts by DM |

Health alerts are sent only to IDs in `OWNER_IDS`, not to users added through the `owners` command. A connected bot sends the DM; if no bot is connected at that moment, the alert is queued until one reconnects. If every bot is offline, no bot is available to deliver a DM.

Activity changes made with the status command and the current prefix are saved in `data/bot-settings.json` by default. For Railway redeploys (not just process restarts), attach a persistent volume mounted at `/data` and set `BOT_SETTINGS_FILE=/data/bot-settings.json`; without a mounted volume, the platform may replace the container's local files during redeploy.

Enable **Server Members**, **Presence** and **Message Content** privileged intents for every bot in the Discord Developer Portal.

### Running

```bash
npm start
```

---

## Usage

### `/bc` or `%bc`
Opens the main control panel with all commands as buttons.

### `/help` or `+help`
Shows available commands and system info.

### `%prefix !`
Changes the command prefix to `!`. Mention the bot to see its current prefix.

### `/add` or `+add`
Add your bot in one click.

### `/left` or `+left`
Remove your bot in one click.

### How to broadcast

1. Use `/bc` or `%bc` to open the control panel
2. Click **Broadcast**
3. Type your message in the modal
4. Choose message type: **Normal** or **Embed**
5. Select your target: **All Members**, **Online**, or **Offline**
6. Confirm — the broadcast starts immediately

---

## Project Structure

```
novabroadcast/
├── src/
│   ├── commands/
│   │   ├── prefix/       # %bc, %help
│   │   └── slash/        # /bc, /help
│   ├── core/
│   │   ├── BroadcastEngine.js   # DM sending logic
│   │   ├── CommandRouter.js     # Button/modal handler
│   │   └── Toolkit.js           # Shared utilities
│   └── events/
│       └── ready.js # Bot Status Type
├── config.json
├── package.json
└── index.js
```

---

## Support

Join our Discord server for help, updates, and more:  
**[discord.gg/XrEGeZQFDP](https://discord.gg/XrEGeZQFDP)**
