
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// ==================================================
// TreasureGameShop - Mobile Legends ID Checker
// Render Webhook + Health Check
// ==================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const RENDER_URL = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || '').replace(/^\/+|\/+$/g, '');
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const ADMIN_IDS = [1006058484, 8003687808];

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN Environment Variable မရှိပါ။');
}

if (!/^https:\/\/.+/i.test(RENDER_URL)) {
  throw new Error('RENDER_EXTERNAL_URL မရှိပါ။ Render URL ကို စစ်ပါ။');
}

if (!/^[A-Za-z0-9_-]{16,128}$/.test(WEBHOOK_PATH)) {
  throw new Error('WEBHOOK_PATH ကို 16-128 characters သတ်မှတ်ပါ။');
}

if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET မရှိပါ။');
}

// Telegram Bot: Webhook mode only
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ==================================================
// Message templates
// Admin can change these with /settemplate, /setconfirm
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
  '💖 ID အတည်ပြုပြီးပါပြီ 💜\n' +
  '⏳ 5 မိနစ်မှ 15 မိနစ်အတွင်း ထည့်ပေးပါတယ်ရှင့် 💜';

const waitingAdminAction = new Map();

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
// Fetch MLBB nickname and region
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
      error: data.error || 'ID မမှန်ပါ၊ သို့မဟုတ် အချက်အလက် ရှာမတွေ့ပါ။'
    };
  } catch (error) {
    console.error('MLBB API error:', error.message);

    return {
      success: false,
      error: 'အချက်အလက်စစ်ဆေးရာတွင် အမှားဖြစ်နေပါတယ်။ ခဏနေမှ ပြန်စမ်းပါ။'
    };
  }
}

// ==================================================
// Buttons
// ==================================================

function makeResultKeyboard(gameId, zoneId, ownerId) {
  return {
    inline_keyboard: [
      [
        {
          text: '💜 ID မှန်ကန်ပါတယ်',
          callback_data: `confirm|${gameId}|${zoneId}|${ownerId}`
        }
      ],
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
    inline_keyboard: [
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

// ==================================================
// Animated-style checking message
// Emoji change while the ID is being checked
// ==================================================

async function animateChecking(chatId, messageId) {
  const frames = [
    '💜 🔎 MLBB ID စစ်ဆေးနေပါတယ်...',
    '💖 ✨ Nickname ရှာဖွေနေပါတယ်...',
    '💜 🔍 Region စစ်ဆေးနေပါတယ်...'
  ];

  for (const frame of frames) {
    try {
      await bot.editMessageText(frame, {
        chat_id: chatId,
        message_id: messageId
      });

      await new Promise(resolve => setTimeout(resolve, 450));
    } catch (error) {
      // Telegram may reject an unchanged message.
      // Continue checking instead of stopping the bot.
      if (!String(error.message).includes('message is not modified')) {
        console.error('Animation error:', error.message);
      }
    }
  }
}

// ==================================================
// Health routes for Render and uptime monitoring
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
  const suppliedSecret =
    req.get('x-telegram-bot-api-secret-token');

  if (suppliedSecret !== WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }

  // Acknowledge Telegram immediately.
  res.sendStatus(200);

  Promise.resolve(bot.processUpdate(req.body)).catch(error => {
    console.error('processUpdate error:', error.message);
  });
});

// ==================================================
// Handle incoming messages
// ==================================================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const text = (msg.text || '').trim();

  if (!text || !userId) return;

  try {
    // /start
    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
      await bot.sendMessage(
        chatId,
        '💖 Mobile legends id checker 💖\n\n' +
        '💜 Game ID နဲ့ Zone ID ကို ပို့ပေးပါ။\n\n' +
        '✨ ဥပမာ - 667124253 (8664)\n\n' +
        '📣 Nickname နဲ့ ID ကို စစ်ဆေးပြီး အတည်ပြုပါ။'
      );
      return;
    }

    // Admin template commands
    const command = text.split(/\s/)[0].split('@')[0];

    if (command === '/settemplate' || command === '/setconfirm') {
      if (!ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(
          chatId,
          '⛔ ဒီ command ကို Admin သာ အသုံးပြုနိုင်ပါတယ်။'
        );
        return;
      }

      const action = command === '/settemplate' ? 'result' : 'confirm';
      waitingAdminAction.set(userId, action);

      await bot.sendMessage(
        chatId,
        action === 'result'
          ? 'Result template အသစ်ကို ပို့ပါ။\n' +
            'Fields: {{nickname}}, {{id}}, {{zone}}, {{region}}'
          : 'Confirm template အသစ်ကို ပို့ပါ။\n' +
            'Fields: {{nickname}}, {{id}}, {{zone}}, {{region}}'
      );
      return;
    }

    // Save the next admin message as a template.
    if (ADMIN_IDS.includes(userId) && waitingAdminAction.has(userId)) {
      const action = waitingAdminAction.get(userId);
      waitingAdminAction.delete(userId);

      if (action === 'result') {
        resultTemplate = text;
        await bot.sendMessage(chatId, '💜 Result template ပြောင်းပြီးပါပြီ။');
      } else {
        confirmTemplate = text;
        await bot.sendMessage(chatId, '💖 Confirm template ပြောင်းပြီးပါပြီ။');
      }
      return;
    }

    // Match ID + Zone in parentheses.
    // Also accepts full-width parentheses and trailing text.
    const regex = /(\d{5,12})\s*[\(（]\s*(\d{3,6})\s*[\)）]/g;
    const entries = [];
    let match;

    while ((match = regex.exec(text)) !== null && entries.length < 5) {
      entries.push({
        gameId: match[1],
        zoneId: match[2]
      });
    }

    if (entries.length === 0) {
      await bot.sendMessage(
        chatId,
        '💗 ID ပုံစံမမှန်ပါ။\n\n' +
        '✨ ဥပမာ - 667124253 (8664)'
      );
      return;
    }

    for (const entry of entries) {
      const { gameId, zoneId } = entry;

      const loadingMessage = await bot.sendMessage(
        chatId,
        '💜 🔎 MLBB ID စစ်ဆေးနေပါတယ်...'
      );

      // Animate the status while the lookup runs.
      const animation = animateChecking(
        chatId,
        loadingMessage.message_id
      );

      const result = await fetchMlbbData(gameId, zoneId);
      await animation;

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

      const values = {
        nickname: result.nickname,
        id: gameId,
        zone: zoneId,
        region: result.region
      };

      const output = applyTemplate(resultTemplate, values);

      await bot.editMessageText(output, {
        chat_id: chatId,
        message_id: loadingMessage.message_id,
        reply_markup: makeResultKeyboard(gameId, zoneId, userId)
      });
    }
  } catch (error) {
    console.error('Message handler error:', error);

    try {
      await bot.sendMessage(
        chatId,
        '💔 အမှားတစ်ခု ဖြစ်သွားပါတယ်။ ခဏနေမှ ပြန်စမ်းပါ။'
      );
    } catch (sendError) {
      console.error('Unable to send error:', sendError.message);
    }
  }
});

// ==================================================
// Handle confirmation button
// ==================================================

bot.on('callback_query', async (query) => {
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

    // Only the person who submitted the ID can confirm it.
    if (query.from.id !== ownerId) {
      await bot.answerCallbackQuery(query.id, {
        text: 'ဒီ ID ကို ပို့ခဲ့သူသာ အတည်ပြုနိုင်ပါတယ်။',
        show_alert: true
      });
      return;
    }

    await bot.answerCallbackQuery(query.id, {
      text: '💜 ID အတည်ပြုပြီးပါပြီ။'
    });

    if (!query.message) return;

    // Re-fetch details so the confirmation keeps real values.
    const result = await fetchMlbbData(gameId, zoneId);

    if (!result.success) {
      await bot.sendMessage(
        query.message.chat.id,
        '💔 ID အချက်အလက်ကို ပြန်စစ်ဆေးမရပါ။ ID ကို ထပ်စစ်ဆေးပေးပါ။'
      );
      return;
    }

    const output = applyTemplate(confirmTemplate, {
      nickname: result.nickname,
      id: gameId,
      zone: zoneId,
      region: result.region
    });

    // Confirmation removes the confirm button.
    // Copy buttons remain available.
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

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
