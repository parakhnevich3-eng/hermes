# Hermes Telegram Bot

1. Create a bot in Telegram through BotFather.
2. Copy `.env.example` to `.env`.
3. Put the BotFather token into `TELEGRAM_BOT_TOKEN`.
4. Put the DeepSeek API key into `DEEPSEEK_API_KEY`.
5. Keep `DEEPSEEK_MODEL=deepseek-v4-pro` to use DeepSeek V4 Pro.
6. Optionally set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of allowed Telegram user IDs.
7. Run diagnostics:

```powershell
npm run telegram:doctor
```

8. Start Hermes in the background:

```powershell
npm run telegram:start
```

Useful service commands:

```powershell
npm run telegram:status
npm run telegram:stop
```

`npm run tg` still runs the bot in the foreground. By default `telegram:start`
uses polling mode. If Telegram ever shows `409 Conflict`, regenerate the
BotFather token and restart the service so old polling sessions lose access.

## Telegram commands

- `/start` starts onboarding for new chats.
- `/onboarding` or `/setup` restarts onboarding.
- `/profile` shows saved onboarding settings.
- `/model` shows the configured DeepSeek model.
- `/health` checks that the bot is alive.
- `/reset` clears chat memory.
- `/whoami` shows your Telegram user ID.
