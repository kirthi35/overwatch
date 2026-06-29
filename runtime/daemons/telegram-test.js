#!/usr/bin/env node
// Verify Telegram delivery is configured + reachable. Sends ONE test message.
// Run after setting telegram_bot_token + telegram_chat_id in .env and launching
// the CLI once (which seeds ~/.overwatch/telegram.json), or with the env vars set:
//   node ~/.overwatch/daemons/telegram-test.js
const { notifyTelegram, enabled, loadConfig } = require('./lib/telegram.js');

(async () => {
  const c = loadConfig();
  if (!enabled()) {
    console.error(
      'Telegram NOT configured.\n' +
      '  Set telegram_bot_token + telegram_chat_id in .env and run `npm start` once\n' +
      '  (it seeds ~/.overwatch/telegram.json), or export TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.'
    );
    process.exit(1);
  }
  console.log(`Sending test message (chat ${c.chatId}, minSeverity ${c.minSeverity})...`);
  // Force CRITICAL so it clears any severity threshold.
  const r = await notifyTelegram({ label: 'TEST', message: 'Overwatch Telegram delivery is working.', severity: 'CRITICAL' });
  if (r && r.ok) { console.log('Delivered. Check your Telegram.'); process.exit(0); }
  console.error('Delivery FAILED:', JSON.stringify(r));
  console.error('Common causes: wrong bot token (404), wrong/empty chat_id, or you have not sent /start to the bot yet.');
  process.exit(1);
})();
