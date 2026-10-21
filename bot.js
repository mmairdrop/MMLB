
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// ==================================================
// TreasureGameShop - MLBB ID Checker
// Render Webhook + Group + Private Chat
// ==================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const RENDER_URL = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || '').replace(/^\/+|\/+$/g, '');
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const ADMIN_IDS = [1006058484, 8003687808];

if (!BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ။');
if (!/^https:\/\/.+/i.test(RENDER_URL)) {
  throw new Error('RENDER_EXTERNAL_URL ကို စစ်ပါ။');
}
if (!/^[A-Za-z0-9_-]{16,128}$/.test(WEBHOOK_PATH)) {
  throw new Error('WEBHOOK_PATH ကို စစ်ပါ။');
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET ကို စစ်ပါ။');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ==================================================
// Message templates
// ==================================================

let resultTemplate =
  '💜 Nickname: {{nickname}}\n' +
  '💜 ID: {{id}} ({{zone}})\n' +
  '💜 Region: {{region}}\n\n' +
  '📣 Nickname နဲ့ ID ကို စစ်ဆေးပါ။';

let confirmTemplate =
  '💜 Nickname: {{nickname}}\n' +
  '💜 ID: {{id}} ({{zone}})\n' +
  '💜 Region: {{region}}\n\n' +
  '🩵 ID အတည်ပြုပြီးပါပြီ 🩵\n' +
  '⏳ 5 မိနစ်မှ 15 မိနစ်အတွင်း ထည့်ပေးပါတယ်ရှင့် 💜';

const waitingAdminAction = new Map();
const processedMessages = new Set();
const MAX_PROCESSED_MESSAGES = 3000;

function rememberMessage(key) {
  if (processedMessages.has(key)) return false;

  processedMessages.add(key);

  if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
    processedMessages.delete(processedMessages.values().next().value);
  }

  return true;
}

// ==================================================
// Template replacement
// ==================================================

function applyTemplate(template, values) {
  return template
    .replace(/\{\{nickname\}\}/g, values.nickname || '')
    .replace(/\{\{id\}\}/g, values.id || '')
    .replace(/\{\{zone\}\}/g, values.zone || '')
    .replace(/\{\{region\}\}/g, values.region || '');
}

// ==================================================
// Find MLBB Game ID + Zone ID
//
// Supported:
// 148132090 (2741)
// 148132090(2741)
// 148132090 2741
// ID: 148132090, Server: 2741
// 148132090 - 2741
// Caption text attached to a photo is also supported.
// ==================================================

function extractMlbbIds(text) {
  if (!text) return [];

  const results = [];
  const seen = new Set();

  // Explicit ID/Server labels first.
  const labeledRegex =
    /(?:game\s*)?id\s*[:=#-]?\s*(\d{5,12})[\s\S]{0,35}?(?:zone|server|sid)\s*[:=#-]?\s*(\d{3,6})/gi;

  let match;

  while ((match = labeledRegex.exec(text)) !== null) {
    const gameId = match[1];
    const zoneId = match[2];
    const key = `${gameId}:${zoneId}`;

    if (!seen.has(key)) {
      seen.add(key);
      results.push({ gameId, zoneId });
    }
  }

  // ID + Zone in parentheses, or separated by spaces,
  // comma, colon, slash, pipe, or hyphen.
  const pairRegex =
    /(\d{5,12})\s*(?:[\(（]\s*(\d{3,6})\s*[\)）]|\s*[,|:/\-]\s*(\d{3,6})(?!\d)|\s+(\d{3,6})(?!\d))/g;

  while ((match = pairRegex.exec(text)) !== null) {
    const gameId = match[1];
    const zoneId = match[2] || match[3] || match[4];

    if (!zoneId) continue;

    const key = `${gameId}:${zoneId}`;

    if (!seen.has(key)) {
      seen.add(key);
      results.push({ gameId, zoneId });
    }

    if (results.length >= 5) break;
  }

  return results.slice(0, 5);
}

// ==================================================
// MLBB nickname + region API
// ==================================================

async function fetchMlbbData(gameId, zoneId) {
  try {
    const response = await axios.get(
      'https://api.isan.eu.org/nickname/ml',
      {
        params: {
          id: gameId,
          server: zoneId,
          decode: false
        },
        timeout: 15000
      }
    );

    const data = response.data || {};

    if (data.success && data.name) {
      return {
        success: true,
        nickname: String(data.name),
        region: String(data.country || data.region || 'Unknown')
      };
    }

    return {
      success: false,
      error: data.error || 'ID/Zone မှန်မမှန် စစ်ဆေးပေးပါ။'
    };
  } catch (error) {
    console.error('MLBB API error:', error.message);

    return {
      success: false,
      error: 'စစ်ဆေးမှု ခေတ္တမအောင်မြင်ပါ။ နောက်မှ ပြန်စမ်းပါ။'
    };
  }
}

// ==================================================
// Buttons
// ==================================================

function makeResultKeyboard(gameId, zoneId, ownerId) {
  return {
    inline_keyboard: [
      [{
        text: '🩵 ID မှန်ကန်ပါတယ်',
        callback_data: `confirm|${gameId}|${zoneId}|${ownerId}`
      }],
      [
        {
          text: '📋 Copy ID',
          copy_text: { text: String(gameId) }
        },
        {
          text: '📋 Copy Zone',
          copy_text: { text: String(zoneId) }
        }
      ]
    ]
  };
}

function makeCopyKeyboard(gameId, zoneId) {
  return {
    inline_keyboard: [[
      {
        text: '📋 Copy ID',
        copy_text: { text: String(gameId) }
      },
      {
        text: '📋 Copy Zone',
        copy_text: { text: String(zoneId) }
      }
    ]]
  };
}

// ==================================================
// Animated checking status
// ==================================================

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function animateChecking(chatId, messageId) {
  const frames = [
    '💜 🔎 MLBB ID စစ်ဆေးနေပါတယ်...',
    '🩵 ✨ Nickname ရှာဖွေနေပါတယ်...',
    '💜 🌏 Region စစ်ဆေးနေပါတယ်...',
    '🩵 💫 ခဏလေး စောင့်ပေးပါရှင့်...'
  ];

  for (const frame of frames) {
    try {
      await bot.editMessageText(frame, {
        chat_id: chatId,
        message_id: messageId
      });
    } catch (error) {
      if (!String(error.message).includes('message is not modified')) {
        console.error('Animation error:', error.message);
      }
    }

    await sleep(350);
  }
}

// ==================================================
// Render health check
// ==================================================

app.get('/', (_req, res) => {
  res.status(200).send('Mobile Legends ID Checker 💖 is running.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Mobile Legends ID Checker',
    mode: 'webhook'
  });
});

// ==================================================
// Telegram Webhook
// ==================================================

const WEBHOOK_ROUTE = `/${WEBHOOK_PATH}`;

app.post(WEBHOOK_ROUTE, (req, res) => {
  const suppliedSecret = req.get('x-telegram-bot-api-secret-token');

  if (suppliedSecret !== WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  Promise.resolve(bot.processUpdate(req.body)).catch(error => {
    console.error('processUpdate error:', error.message);
  });
});

// ==================================================
// Incoming messages
// ==================================================

bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;

  // Read regular text OR a photo's caption.
  const text = String(msg.text || msg.caption || '').trim();

  if (!userId || msg.from.is_bot || !text) return;

  const command = text.split(/\s/)[0].split('@')[0];

  try {
    // /start
    if (command === '/start') {
      await bot.sendMessage(
        chatId,
        '💖 Mobile legends id checker 💖\n\n' +
        '💜 Game ID နဲ့ Zone ID ကို ပို့ပေးပါ။\n\n' +
        '✨ ဥပမာ - 148132090 (2741)\n' +
        '✨ သို့မဟုတ် - 148132090 2741\n\n' +
        '📣 Nickname နဲ့ ID ကို စစ်ဆေးပါ။'
      );
      return;
    }

    // Admin template commands
    if (command === '/settemplate' || command === '/setconfirm') {
      if (!ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '⛔ Admin သာ အသုံးပြုနိုင်ပါတယ်။');
        return;
      }

      const action = command === '/settemplate' ? 'result' : 'confirm';
      waitingAdminAction.set(userId, action);

      await bot.sendMessage(
        chatId,
        action === 'result'
          ? 'Result template အသစ်ပို့ပါ။ Fields: {{nickname}}, {{id}}, {{zone}}, {{region}}'
          : 'Confirm template အသစ်ပို့ပါ။ Fields: {{nickname}}, {{id}}, {{zone}}, {{region}}'
      );
      return;
    }

    if (ADMIN_IDS.includes(userId) && waitingAdminAction.has(userId)) {
      const action = waitingAdminAction.get(userId);
      waitingAdminAction.delete(userId);

      if (action === 'result') {
        resultTemplate = text;
        await bot.sendMessage(chatId, '💜 Result template ပြောင်းပြီးပါပြီ။');
      } else {
        confirmTemplate = text;
        await bot.sendMessage(chatId, '🩵 Confirm template ပြောင်းပြီးပါပြီ။');
      }
      return;
    }

    // Only process messages containing an ID + Zone pair.
    // Ordinary group messages are silently ignored.
    const entries = extractMlbbIds(text);

    if (entries.length === 0) return;

    const messageKey = `${chatId}:${msg.message_id}`;

    if (!rememberMessage(messageKey)) return;

    for (const entry of entries) {
      const { gameId, zoneId } = entry;

      const loadingMessage = await bot.sendMessage(
        chatId,
        '💜 🔎 MLBB ID စစ်ဆေးနေပါတယ်...'
      );

      const [result] = await Promise.all([
        fetchMlbbData(gameId, zoneId),
        animateChecking(chatId, loadingMessage.message_id)
      ]);

      if (!result.success) {
        await bot.editMessageText(
          `💔 ID: ${gameId} (${zoneId})\n${result.error}`,
          {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          }
        );
        continue;
      }

      const output = applyTemplate(resultTemplate, {
        nickname: result.nickname,
        id: gameId,
        zone: zoneId,
        region: result.region
      });

      await bot.editMessageText(output, {
        chat_id: chatId,
        message_id: loadingMessage.message_id,
        reply_markup: makeResultKeyboard(gameId, zoneId, userId)
      });
    }
  } catch (error) {
    console.error('Message handler error:', error.message);

    // Only send an error if this message contained a valid ID pair.
    if (extractMlbbIds(text).length > 0) {
      try {
        await bot.sendMessage(
          chatId,
          '💔 ID စစ်ဆေးရာတွင် အမှားဖြစ်နေပါတယ်။ ခဏနေမှ ပြန်စမ်းပါ။'
        );
      } catch (sendError) {
        console.error('Unable to send error:', sendError.message);
      }
    }
  }
});

// ==================================================
// Confirmation button
// ==================================================

bot.on('callback_query', async query => {
  const callbackData = query.data || '';

  try {
    if (!callbackData.startsWith('confirm|')) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    const parts = callbackData.split('|');

    if (parts.length !== 4) {
      await bot.answerCallbackQuery(query.id, {
        text: 'ခလုတ်အချက်အလက် မမှန်ပါ။',
        show_alert: true
      });
      return;
    }

    const [, gameId, zoneId, ownerIdText] = parts;
    const ownerId = Number(ownerIdText);

    // Keep existing rule: the person who submitted the ID confirms it.
    if (query.from.id !== ownerId) {
      await bot.answerCallbackQuery(query.id, {
        text: 'ဒီ ID ကို ပို့ခဲ့သူသာ အတည်ပြုနိုင်ပါတယ်။',
        show_alert: true
      });
      return;
    }

    await bot.answerCallbackQuery(query.id, {
      text: '🩵 ID အတည်ပြုပြီးပါပြီ။'
    });

    if (!query.message) return;

    const result = await fetchMlbbData(gameId, zoneId);

    if (!result.success) {
      await bot.sendMessage(
        query.message.chat.id,
        '💔 ID ကို ပြန်စစ်ဆေးမရပါ။ ထပ်စစ်ဆေးပေးပါ။'
      );
      return;
    }

    const output = applyTemplate(confirmTemplate, {
      nickname: result.nickname,
      id: gameId,
      zone: zoneId,
      region: result.region
    });

    // Remove confirmation button; keep Copy buttons.
    await bot.editMessageText(output, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: makeCopyKeyboard(gameId, zoneId)
    });
  } catch (error) {
    console.error('Callback handler error:', error.message);
  }
});

// ==================================================
// Start server and register webhook
// ==================================================

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Express server listening on port ${PORT}`);

  try {
    const webhookUrl = `${RENDER_URL}${WEBHOOK_ROUTE}`;

    await bot.setWebHook(webhookUrl, {
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: false
    });

    console.log('Telegram webhook registered successfully.');
    console.log(`Health check: ${RENDER_URL}/health`);
  } catch (error) {
    console.error(
      'Webhook setup failed:',
      error.response?.body || error.message
    );

    server.close(() => process.exit(1));
  }
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
