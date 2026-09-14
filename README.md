# Hana Bot

![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg?logo=typescript)
![MongoDB](https://img.shields.io/badge/MongoDB-Required-brightgreen.svg?logo=mongodb)

A comprehensive, self-hosted WhatsApp bot for server administration, monitoring, and CI/CD automation. Hana Bot connects directly to WhatsApp and allows authorized administrators to manage their infrastructure through simple chat commands.

## Features

| Category              | Feature            | Description                                                                                                                                                                              |
| :-------------------- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server Monitoring** | System Metrics     | Fetch current CPU, RAM, disk usage, and load averages.                                                                                                                                   |
|                       | Uptime Monitoring  | Configure a list of URLs to ping at regular intervals.                                                                                                                                   |
|                       | Alert System       | Get notified immediately if a site goes down and when it recovers.                                                                                                                       |
| **Jenkins CI/CD**     | Webhook Listener   | Receive webhooks directly from Jenkins natively.                                                                                                                                         |
|                       | Build Status       | Real-time notifications for build starts, successes, failures, or aborts.                                                                                                                |
|                       | Link Previews      | Clickable URLs directing you straight to the Jenkins build console.                                                                                                                      |
| **Alert Routing**     | Multi-Channel      | Route specific alerts (`uptime` or `jenkins`) to different WhatsApp groups.                                                                                                              |
|                       | Subscriptions      | Manage group subscriptions dynamically from WhatsApp.                                                                                                                                    |
| **Media Tools**       | Conversions        | Convert HEIC, PNG, WEBP, JPEG images with custom scaling, quality, and resizing.                                                                                                         |
|                       | EXIF Stripping     | Strip privacy-sensitive EXIF metadata from photos and videos.                                                                                                                            |
| **AI Assistant**      | NLP Commands       | Ask the built-in AI (Gemini/OpenAI) to answer questions or run commands dynamically. Features parallel tool execution and intelligent user context awareness (knows your name and role). |
|                       | Smart Queuing      | Zero-delay rolling-window rate limiter with automatic model fallback protects API quotas, while a tool concurrency queue protects server RAM/CPU from heavy AI task bursts.          |
|                       | Persistent Memory  | Automatically remembers important user facts and preferences across sessions. Admins can explicitly ask it to remember or forget information.                                              |
|                       | Mention Resolution | AI seamlessly understands WhatsApp `@mentions` by automatically mapping them to your configured contact aliases.                                                                           |
| **WireGuard VPN**     | Status Monitoring  | View connected clients, IPs, handshakes, and bandwidth metrics over SSH.                                                                                                                 |
| **Access Control**    | Whitelist & Admins | Strict access control with support for storing user name aliases for convenience.                                                                                                        |
| **Persistence**       | MongoDB Database   | All configurations, subscriptions, and sessions persist across restarts.                                                                                                                 |

## Prerequisites

- Node.js (v20+ recommended)
- MongoDB instance (local or remote)
- FFmpeg (`sudo apt-get install ffmpeg` - required for HEIC/HEIF media conversions)
- A WhatsApp account (to link the bot)

## Environment Variables

Create a `.env` file in the root directory:

```env
# Bot Configuration
DEV_MODE=false
PHONE_NUMBER=91XXXXXXXXXX # Your WhatsApp number (Owner)
MONGODB_URI=mongodb://127.0.0.1:27017/hanabot

# Default Ping Sites (Optional, JSON Array)
PING_SITES_JSON='[{"name": "Nextcloud", "url": "https://nextcloud.example.com"}]'

# Jenkins Integration
JENKINS_ENABLED=true
JENKINS_PORT=3000
JENKINS_URL=http://your-jenkins-url:8080

# WireGuard SSH Settings (Optional)
WG_SSH_HOST=192.168.1.x
WG_SSH_PORT=22
WG_SSH_USER=root
WG_SSH_KEY_PATH=/path/to/private/key
WG_INTERFACE=wg0

# AI Configuration (Optional)
AI_PROVIDER=gemini # (none | gemini | openai | claude | ollama)
AI_API_KEY=your-api-key-here
AI_MODEL=gemini-2.5-flash
AI_FALLBACK_MODEL=gemini-3.1-flash-lite # Optional fallback to double your RPM limits
AI_RPM_LIMIT=15 # Hard rate limit to prevent 429 Too Many Requests errors
AI_HISTORY_EXPIRATION_DAYS=3
AI_HISTORY_MAX_MESSAGES=30
AI_MEMORY_MAX_PER_USER=50
```

## Setup & Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Build the TypeScript source:
   ```bash
   npm run build
   ```
3. Start the bot:
   ```bash
   npm start
   ```
   _(For development, you can use `npm run dev`)_
4. Scan the QR code or use the pairing code to link your WhatsApp account.

## Command Reference

The default command prefix is `!`.

| Module         | Command      | Subcommands / Args            | Description                                                                                                                                                           | Access    |
| :------------- | :----------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------- |
| **Monitoring** | `!ping`      | `[url]`                       | Ping all configured sites, or a specific URL.                                                                                                                         | Whitelist |
|                | `!sites`     |                               | List all configured sites being monitored.                                                                                                                            | Whitelist |
|                | `!addsite`   | `<name> <url>`                | Add a new site to the monitoring list.                                                                                                                                | Admin     |
|                | `!rmsite`    | `<name>`                      | Remove a site from the monitoring list.                                                                                                                               | Admin     |
| **Server**     | `!stats`     |                               | Display server CPU, RAM, Disk, and Load averages.                                                                                                                     | Whitelist |
| **VPN**        | `!wg`        |                               | Show WireGuard VPN peers, IPs, and data transfer.                                                                                                                     | Whitelist |
| **Alerts**     | `!alerts`    | `on` / `off`                  | Enable or disable the global uptime monitor.                                                                                                                          | Admin     |
|                |              | `status`                      | View monitoring status and active subscriptions.                                                                                                                      | Admin     |
|                |              | `sub <events>`                | Subscribe current chat to alerts (`uptime`, `jenkins`).                                                                                                               | Admin     |
|                |              | `unsub`                       | Unsubscribe current chat from all alerts.                                                                                                                             | Admin     |
| **Jenkins**    | `!jenkins`   | `on` / `off`                  | Enable or disable the Jenkins webhook listener.                                                                                                                       | Admin     |
|                |              | `status`                      | View Jenkins integration status and server health.                                                                                                                    | Admin     |
| **Access**     | `!whitelist` | `add <number> [name] [admin]` | Add a user to the bot's whitelist, optionally saving their name.                                                                                                      | Admin     |
|                |              | `remove <number>`             | Remove a user from the whitelist.                                                                                                                                     | Admin     |
|                |              | `list`                        | List all whitelisted users and admins.                                                                                                                                | Admin     |
| **Tools**      | `!tools`     |                               | Show all available utility tools.                                                                                                                                     | Whitelist |
|                | `!rmexif`    |                               | Strip EXIF metadata from a replied image/video.                                                                                                                       | Whitelist |
|                | `!convert`   | `<format> [args]`             | Convert image format (e.g., png, webp, jpeg, avif). Supports `width=`, `height=`, `scale=`, and `quality=` arguments. Native support for converting HEIC/HEIF images. | Whitelist |
| **AI**         | `!hana`      | `<query>`                     | Ask the AI a question or issue a command. The AI has direct access to run bot commands (like converting images, managing alerts) on your behalf!                      | Whitelist |
|                |              | `clear`                       | Wipe your personal AI conversation history to start fresh.                                                                                                            | Whitelist |
|                |              | `clear memories`              | Wipe your saved personal AI memories.                                                                                                                                 | Whitelist |
|                |              | `clear all`                   | Wipe both conversation history and personal AI memories.                                                                                                              | Whitelist |
| **System**     | `!help`      |                               | Display the main help menu.                                                                                                                                           | Whitelist |

## Acknowledgements

A massive thank you to the developers of [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`). This bot would not be possible without their incredible, lightweight, and pure TypeScript WhatsApp Web API library.

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change. Please ensure you test your changes locally before submitting a PR.

## Disclaimer

> [!IMPORTANT]
> This project uses an unofficial, reverse-engineered WhatsApp Web API (`@whiskeysockets/baileys`). It is **not** affiliated with, endorsed, or sponsored by WhatsApp or Meta.

> [!CAUTION]
> Use this software at your own risk. The creators and contributors are not responsible for any account bans, suspensions, or other actions taken by WhatsApp as a result of using this bot. Please ensure you comply with WhatsApp's Terms of Service.

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** License.

[View License](LICENSE.md)
