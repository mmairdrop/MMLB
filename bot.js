
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// ===== Environment variables =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || '').replace(/^\/+|\/+$/g, '');
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Admin Telegram IDs
const ADMIN_IDS = [1006058484, 8003687808];

// ===== Check configuration =====
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing.');
if (!RENDER_URL || !RENDER_URL.startsWith('https://')) {
  throw new Error('RENDER_EXTERNAL_URL is missing or invalid.');
}
if (!/^[A-Za-z0-9_-]{16,128}$/.test(WEBHOOK_PATH)) {
  throw new Error('Set WEBHOOK_PATH to a random string of 16-128 characters.');
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET || '')) {
  throw new Error('Set TELEGRAM_WEBHOOK_SECRET using letters, numbers, _ or -.');
}

// ===== Bot and Express =====
// Important: Webhook mode, not polling mode.
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ===== Message templates =====
let resultTemplate =
  '💜 Nickname: {{nickname}}\n' +
  '💜 ID: {{id}} ({{zone}})\n' +
  '💜 Region: {{region}}\n\n' +
  '📣 Nickname နဲ့ ID ကို စစ်ဆေးပါ။';

let confirmTemplate =
  '💜 ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။\n' +
  '⏳ 5 မိနစ်မှ 15 မိနစ်အတွင်း ထည့်ပေးပါမယ်။';

// Admins can set a template by sending /settemplate or /setconfirm,
// then sending the new template in the next message.
const waitingAdminAction = new Map();

// ===== Fetch MLBB data =====
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
      error: data.error || 'ID မမှန်ပါ၊ ဒါမှမဟုတ် အချက်အလက်ရှာမတွေ့ပါ။'
    };
  } catch (error) {
    console.error('MLBB API error:', error.message);

    return {
      success: false,
      error: 'အချက်အလက်စစ်ဆေးရာတွင် အမှားဖြစ်နေပါတယ်။ ခဏနေမှ ပြန်စမ်းပါ။'
    };
  }
}

// ===== Replace template fields =====
function applyTemplate(template, values) {
  return template
    .replace(/\{\{nickname\}\}/g, values.nickname || '')
    .replace(/\{\{id\}\}/g, values.id || '')
    .replace(/\{\{zone\}\}/g, values.zone || '')
    .replace(/\{\{region\}\}/g, values.region || '');
}

// ===== Inline keyboards =====
function makeResultKeyboard(gameId, zoneId, ownerId) {
  return {
    inline_keyboard: [
      [
        {
          text: '✅ ID မှန်ကန်ပါတယ်',
          callback_data: `confirm_${gameId}_${zoneId}_${ownerId}`
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

// ===== Health routes =====
app.get('/', (_req, res) => {
  res.status(200).send('Telegram bot is running.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    mode: 'webhook'
  });
});

// ===== Telegram webhook route =====
const WEBHOOK_ROUTE = `/${WEBHOOK_PATH}`;

app.post(WEBHOOK_ROUTE, (req, res) => {
  const suppliedSecret = req.get('x-telegram-bot-api-secret-token');

  if (suppliedSecret !== WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }

  // Telegram should receive an HTTP response promptly.
  res.sendStatus(200);

  try {
    bot.processUpdate(req.body);
  } catch (error) {
    console.error('processUpdate error:', error);
  }
});

// ===== Handle messages =====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();

  if (!text || !userId) return;

  try {
    // Start command
    if (text === '/start') {
      await bot.sendMessage(
        chatId,
        '💜 MLBB ID Checker မှ ကြိုဆိုပါတယ်။\n\n' +
        'Game ID နဲ့ Zone ID ကို ဒီပုံစံအတိုင်း ပို့ပေးပါ။\n' +
        'ဥပမာ - 667124253 (8664)\n\n' +
        'ID အများဆုံး 5 ခုအထိ တစ်ခါတည်း စစ်ဆေးနိုင်ပါတယ်။'
      );
      return;
    }

    // Admin-only template commands
    if (text === '/settemplate' || text === '/setconfirm') {
      if (!ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '⛔ ဒီ command ကို Admin သာ အသုံးပြုနိုင်ပါတယ်။');
        return;
      }

      const action = text === '/settemplate' ? 'result' : 'confirm';
      waitingAdminAction.set(userId, action);

      await bot.sendMessage(
        chatId,
        action === 'result'
          ? 'Result template အသစ်ကို ပို့ပါ။\n' +
            'သုံးနိုင်တဲ့ fields: {{nickname}}, {{id}}, {{zone}}, {{region}}'
          : 'Confirm message အသစ်ကို ပို့ပါ။'
      );
      return;
    }

    // Save the next message as an admin template
    if (ADMIN_IDS.includes(userId) && waitingAdminAction.has(userId)) {
      const action = waitingAdminAction.get(userId);
      waitingAdminAction.delete(userId);

      if (action === 'result') {
        resultTemplate = text;
        await bot.sendMessage(chatId, '✅ Result template ပြောင်းပြီးပါပြီ။');
      } else {
        confirmTemplate = text;
        await bot.sendMessage(chatId, '✅ Confirm message ပြောင်းပြီးပါပြီ။');
      }
      return;
    }

    // Find up to 5 entries in the format: GameID (ZoneID)
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
        '❗ ID ပုံစံမမှန်ပါ။\nဥပမာ - 667124253 (8664)'
      );
      return;
    }

    for (const entry of entries) {
      const { gameId, zoneId } = entry;

      const loadingMessage = await bot.sendMessage(
        chatId,
        '🔎 MLBB ID စစ်ဆေးနေပါတယ်...'
      );

      const result = await fetchMlbbData(gameId, zoneId);

      if (!result.success) {
        await bot.editMessageText(
          `❌ ${gameId} (${zoneId})\n${result.error}`,
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
    console.error('Message handler error:', error);

    try {
      await bot.sendMessage(
        chatId,
        '⚠️ အမှားတစ်ခု ဖြစ်သွားပါတယ်။ ခဏနေမှ ပြန်စမ်းပါ။'
      );
    } catch (sendError) {
      console.error('Unable to send error message:', sendError.message);
    }
  }
});

// ===== Handle button presses =====
bot.on('callback_query', async (query) => {
  const callbackData = query.data || '';

  try {
    if (!callbackData.startsWith('confirm_')) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    const parts = callbackData.split('_');

    if (parts.length !== 4) {
      await bot.answerCallbackQuery(query.id, {
        text: 'ခလုတ်အချက်အလက် မမှန်ပါ။',
        show_alert: true
      });
      return;
    }

    const [, gameId, zoneId, ownerIdText] = parts;
    const ownerId = Number(ownerIdText);

    if (query.from.id !== ownerId) {
      await bot.answerCallbackQuery(query.id, {
        text: 'ဒီ ID ကို စစ်ဆေးခဲ့သူသာ အတည်ပြုနိုင်ပါတယ်။',
        show_alert: true
      });
      return;
    }

    await bot.answerCallbackQuery(query.id, {
      text: 'ID အတည်ပြုပြီးပါပြီ။'
    });

    if (!query.message) return;

    await bot.editMessageText(confirmTemplate, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: makeCopyKeyboard(gameId, zoneId)
    });
  } catch (error) {
    console.error('Callback handler error:', error.message);
  }
});

// ===== Start server and register webhook =====
const server = app.listen(PORT, async () => {
  console.log(`Express server listening on port ${PORT}`);

  try {
    const webhookUrl =
      `${RENDER_URL.replace(/\/+$/, '')}${WEBHOOK_ROUTE}`;

    await bot.setWebHook(webhookUrl, {
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: false
    });

    console.log('Telegram webhook registered successfully.');
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
