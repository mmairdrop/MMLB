
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

// =====================================
// CONFIGURATION
// =====================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [1006058484, 8003687808];
const PORT = Number(process.env.PORT) || 3000;

if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is missing!');
}

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

const app = express();

app.disable('x-powered-by');

app.get('/', (_req, res) => {
    res.status(200).send('Bot is running.');
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

server.requestTimeout = 10000;
server.headersTimeout = 12000;
server.keepAliveTimeout = 5000;

// =====================================
// MESSAGE TEMPLATES
// =====================================

let botTemplates = {
    checkResult:
        '😎 Nickname: {nickname}\n' +
        '🆔 ID: {userId} ({zoneId})\n' +
        '🌍 Region: {country}\n\n' +
        '⚠️ Nickname နဲ့ ID ကို စစ်ဆေးပါ။',

    confirmMessage:
        '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။\n' +
        'ငွေလွှဲပြေစာရောက်ပြီး 5min မှ 10min အတွင်း ထည့်ပေးပါမယ်\n' 
        'ထည့်ပေးပါမယ်။\n\n' +
        'ဝယ်ယူအားပေးမှုအတွက် ကျေးဇူးတင်ပါတယ်ရှင့် 💜'
};

// =====================================
// MLBB API
// =====================================

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
                timeout: 10000,
                maxRedirects: 0,
                maxContentLength: 1024 * 1024,
                maxBodyLength: 1024 * 1024
            }
        );

        const result = response.data;

        if (
            result &&
            result.success === true &&
            typeof result.name === 'string' &&
            result.name.trim() !== ''
        ) {
            let nickname = result.name;

            try {
                nickname = decodeURIComponent(result.name);
            } catch (_) {}

            return {
                status: 'valid',
                nickname,
                country: String(
                    result.country ||
                    result.region ||
                    result.data?.country ||
                    result.data?.region ||
                    'Myanmar (Burma)'
                )
            };
        }

        if (result && result.success === false) {
            return {
                status: 'invalid',
                message: 'Player not found'
            };
        }

        return { status: 'error' };

    } catch (error) {
        // Do not print API keys, tokens, or full request URLs.
        console.error(
            'MLBB API error:',
            error.response?.status ||
            error.code ||
            error.message
        );

        return { status: 'error' };
    }
}

// =====================================
// TELEGRAM HELPERS
// =====================================

async function safeAnswerCallback(queryId, options = {}) {
    try {
        await bot.answerCallbackQuery(queryId, options);
    } catch (error) {
        console.error('Callback error:', error.message);
    }
}

async function safeDeleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (_) {}
}

// Short callback tokens prevent Telegram's 64-byte callback limit.
const pendingChecks = new Map();
const MAX_PENDING_CHECKS = 2000;
const CHECK_TTL = 30 * 60 * 1000;

function createCheckToken(gameId, zoneId, ownerId) {
    const token = crypto.randomBytes(8).toString('hex');

    pendingChecks.set(token, {
        gameId: String(gameId),
        zoneId: String(zoneId),
        ownerId: Number(ownerId),
        confirmed: false,
        createdAt: Date.now()
    });

    if (pendingChecks.size > MAX_PENDING_CHECKS) {
        const oldest = pendingChecks.keys().next().value;
        pendingChecks.delete(oldest);
    }

    return token;
}

function getCheck(token) {
    const check = pendingChecks.get(token);

    if (!check) return null;

    if (Date.now() - check.createdAt > CHECK_TTL) {
        pendingChecks.delete(token);
        return null;
    }

    return check;
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

function makeResultKeyboard(gameId, zoneId, token) {
    return {
        inline_keyboard: [
            [
                {
                    text: '✅ ID အတည်ပြုရန်',
                    callback_data: `confirm_${token}`
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

function makeResultText(gameId, zoneId, result) {
    return botTemplates.checkResult
        .replace(/\{nickname\}/g, () => result.nickname)
        .replace(/\{userId\}/g, () => String(gameId))
        .replace(/\{zoneId\}/g, () => String(zoneId))
        .replace(/\{country\}/g, () => result.country);
}

// =====================================
// MESSAGE HANDLER
// =====================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = msg.from?.id;
    const text = msg.text || msg.caption || '';

    if (!text || !telegramUserId) return;

    // START
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text.trim())) {
        await bot.sendMessage(
            chatId,
            [
                '✨ မင်္ဂလာပါ 💜',
                '',
                '🆔 MLBB User ID နဲ့ Zone ID ကို ပို့ပေးပါ။',
                '📝 ဥပမာ: 667124253(8664)',
                '',
                '💫 ID ၅ ခုအထိ တစ်ခါတည်း စစ်နိုင်ပါတယ်။'
            ].join('\n')
        );
        return;
    }

    // ADMIN: SET RESULT TEMPLATE
    if (/^\/settemplate(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            await bot.sendMessage(
                chatId,
                '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။'
            );
            return;
        }

        const newTemplate = text
            .replace(/^\/settemplate(?:@\w+)?/, '')
            .trim();

        if (!newTemplate) {
            await bot.sendMessage(
                chatId,
                '📝 လက်ရှိ Template:\n\n' +
                botTemplates.checkResult +
                '\n\nပြောင်းရန်:\n' +
                '/settemplate 🫟 {nickname}\n' +
                '💜 {userId} ({zoneId})\n' +
                '💙 {country}'
            );
            return;
        }

        botTemplates.checkResult = newTemplate;

        await bot.sendMessage(chatId, '💜 Template ပြောင်းပြီးပါပြီ။');
        return;
    }

    // ADMIN: SET CONFIRM TEMPLATE
    if (/^\/setconfirm(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            await bot.sendMessage(
                chatId,
                '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။'
            );
            return;
        }

        const newTemplate = text
            .replace(/^\/setconfirm(?:@\w+)?/, '')
            .trim();

        if (!newTemplate) {
            await bot.sendMessage(
                chatId,
                '📝 လက်ရှိ Confirm Template:\n\n' +
                botTemplates.confirmMessage +
                '\n\nပြောင်းရန်:\n' +
                '/setconfirm မင်းလိုချင်တဲ့စာသား'
            );
            return;
        }

        botTemplates.confirmMessage = newTemplate;

        await bot.sendMessage(chatId, '💜 Confirm Template ပြောင်းပြီးပါပြီ။');
        return;
    }

    // FIND UP TO 5 IDs
    const regex =
        /(\d{5,12})\s*[\(\（]\s*(\d{3,6})\s*[\)\）]/g;

    const matches = [...text.matchAll(regex)].slice(0, 5);

    if (!matches.length) return;

    for (const match of matches) {
        const gameId = match[1];
        const zoneId = match[2];
        let loadingMsg;

        try {
            loadingMsg = await bot.sendMessage(
                chatId,
                `🔎 စစ်ဆေးနေပါတယ်...\n💞 ${gameId} (${zoneId})`
            );

            const result = await fetchMlbbData(gameId, zoneId);

            await safeDeleteMessage(
                chatId,
                loadingMsg.message_id
            );

            if (result.status === 'error') {
                await bot.sendMessage(
                    chatId,
                    `💔 ID ${gameId} (${zoneId}) ကို ယခုစစ်ဆေး၍မရပါ။ ခဏနေမှ ပြန်စမ်းပါ။`
                );
                continue;
            }

            if (result.status === 'invalid') {
                await bot.sendMessage(
                    chatId,
                    `💔 ID ${gameId} (${zoneId}) ကို ရှာမတွေ့ပါ။ ID နဲ့ Zone ကို ပြန်စစ်ပါ။`
                );
                continue;
            }

            const token = createCheckToken(
                gameId,
                zoneId,
                telegramUserId
            );

            await bot.sendMessage(
                chatId,
                makeResultText(gameId, zoneId, result),
                {
                    reply_markup: makeResultKeyboard(
                        gameId,
                        zoneId,
                        token
                    )
                }
            );

        } catch (error) {
            console.error('Message handler error:', error.message);

            if (loadingMsg) {
                await safeDeleteMessage(
                    chatId,
                    loadingMsg.message_id
                );
            }

            await bot.sendMessage(
                chatId,
                '💔 လုပ်ဆောင်မှု မအောင်မြင်ပါ။ ခဏနေမှ ပြန်စမ်းပါ။'
            ).catch(() => {});
        }
    }
});

// =====================================
// INLINE BUTTON HANDLER
// =====================================

bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const telegramUserId = query.from?.id;
    const data = query.data || '';

    if (!chatId || !messageId || !telegramUserId) {
        await safeAnswerCallback(query.id);
        return;
    }

    if (data.startsWith('confirm_')) {
        const token = data.slice('confirm_'.length);
        const check = getCheck(token);

        if (!check) {
            await safeAnswerCallback(query.id, {
                text: '💔 သက်တမ်းကုန်သွားပါပြီ။ ID ကို ပြန်ပို့ပါ။',
                show_alert: true
            });
            return;
        }

        if (check.ownerId !== telegramUserId) {
            await safeAnswerCallback(query.id, {
                text: '💔 ဒီ ID ကို စစ်ဆေးခဲ့သူသာ အတည်ပြုနိုင်ပါတယ်။',
                show_alert: true
            });
            return;
        }

        if (check.confirmed) {
            await safeAnswerCallback(query.id, {
                text: '💜 အတည်ပြုပြီးပါပြီ။'
            });
            return;
        }

        check.confirmed = true;

        await safeAnswerCallback(query.id, {
            text: '💜 ID အတည်ပြုပြီးပါပြီ။'
        });

        const oldText = query.message.text || '';
        const warning = '⚠️ Nickname နဲ့ ID ကို စစ်ဆေးပါ။';

        const updatedText = oldText.includes(warning)
            ? oldText.replace(
                warning,
                '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။'
            )
            : oldText + '\n✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။';

        try {
            await bot.editMessageText(updatedText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: makeCopyKeyboard(
                    check.gameId,
                    check.zoneId
                )
            });
        } catch (error) {
            console.error('Confirm edit error:', error.message);
        }

        return;
    }

    await safeAnswerCallback(query.id);
});

// =====================================
// ERROR HANDLERS
// =====================================

bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

// Exit on an uncaught exception so the hosting process manager
// can restart the bot instead of continuing in an unknown state.
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

console.log('Bot started successfully.');
