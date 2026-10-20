
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [1006058484, 8003687808];
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is missing!');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.disable('x-powered-by');

app.get('/', (_req, res) => res.send('Bot is running.'));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

server.requestTimeout = 10000;
server.headersTimeout = 12000;

let botTemplates = {
    checkResult:
        'Nickname: {nickname}\n' +
        'ID: {userId} ({zoneId})\n' +
        'Region: {country}',

    confirmMessage:
        '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။\n' +
        '🔜 ငွေလွှဲပြေစာရောက်ပြီး 5min မှ 10min အတွင်း ' +
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
                maxContentLength: 1024 * 1024
            }
        );

        const data = response.data;

        if (
            data?.success === true &&
            typeof data.name === 'string' &&
            data.name.trim()
        ) {
            let nickname = data.name;

            try {
                nickname = decodeURIComponent(data.name);
            } catch (_) {}

            return {
                status: 'valid',
                nickname,
                country: String(
                    data.country ||
                    data.region ||
                    data.data?.country ||
                    data.data?.region ||
                    'Myanmar (Burma)'
                )
            };
        }

        if (data?.success === false) {
            return { status: 'invalid' };
        }

        return { status: 'error' };

    } catch (error) {
        console.error(
            'MLBB API error:',
            error.response?.status || error.code || error.message
        );

        return { status: 'error' };
    }
}

// =====================================
// HELPERS
// =====================================

async function answerCallback(id, options = {}) {
    try {
        await bot.answerCallbackQuery(id, options);
    } catch (_) {}
}

async function deleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (_) {}
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const checks = new Map();
const CHECK_TTL = 30 * 60 * 1000;
const MAX_CHECKS = 2000;

function createCheck(gameId, zoneId, ownerId) {
    const token = crypto.randomBytes(8).toString('hex');

    checks.set(token, {
        gameId: String(gameId),
        zoneId: String(zoneId),
        ownerId,
        confirmed: false,
        createdAt: Date.now()
    });

    if (checks.size > MAX_CHECKS) {
        checks.delete(checks.keys().next().value);
    }

    return token;
}

function getCheck(token) {
    const check = checks.get(token);

    if (!check) return null;

    if (Date.now() - check.createdAt > CHECK_TTL) {
        checks.delete(token);
        return null;
    }

    return check;
}

function copyKeyboard(gameId, zoneId) {
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

function resultKeyboard(gameId, zoneId, token) {
    return {
        inline_keyboard: [
            [{
                text: '✅ ID အတည်ပြုရန်',
                callback_data: `confirm_${token}`
            }],
            [{
                text: '📋 Copy ID',
                copy_text: { text: String(gameId) }
            }, {
                text: '📋 Copy Zone',
                copy_text: { text: String(zoneId) }
            }]
        ]
    };
}

function makeBody(gameId, zoneId, result) {
    return botTemplates.checkResult
        .replace(/\{nickname\}/g, () => result.nickname)
        .replace(/\{userId\}/g, () => String(gameId))
        .replace(/\{zoneId\}/g, () => String(zoneId))
        .replace(/\{country\}/g, () => result.country);
}

// =====================================
// ANIMATED RESULT
// =====================================

const animationFrames = [
    { heart: '💜', sparkle: '✨', check: '☑️' },
    { heart: '💖', sparkle: '🌟', check: '✅' },
    { heart: '💗', sparkle: '💫', check: '✔️' },
    { heart: '🤍', sparkle: '✨', check: '☑️' }
];

function makeAnimatedText(body, frame, confirmed = false) {
    const heart = frame.heart;
    const sparkle = frame.sparkle;
    const check = confirmed ? '✅' : frame.check;

    const codeBox = [
        `${heart} Nickname: ${body.nickname}`,
        `${heart} ID: ${body.gameId} (${body.zoneId})`,
        `${heart} Region: ${body.country}`
    ].join('\n');

    return (
        '<pre>' + escapeHtml(codeBox) + '</pre>\n' +
        `${sparkle} ${check} Nickname နဲ့ ID ကို ` +
        (confirmed
            ? 'အတည်ပြုပြီးပါပြီ။'
            : 'သေချာစစ်ဆေးပါ။') +
        `\n\n${heart} ${sparkle} ${heart}`
    );
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendAnimatedResult(
    chatId,
    gameId,
    zoneId,
    result,
    ownerId
) {
    const token = createCheck(gameId, zoneId, ownerId);

    // Use the template configured by the admin.
    const raw = makeBody(gameId, zoneId, result);

    const body = {
        nickname: result.nickname,
        gameId: String(gameId),
        zoneId: String(zoneId),
        country: result.country
    };

    // Preserve /settemplate customization.
    const templateLines = raw.split('\n');
    body.custom = templateLines;

    let message;

    for (let i = 0; i < animationFrames.length; i++) {
        const frame = animationFrames[i];

        // Default fields can be customized through /settemplate.
        const customBody = raw
            .replace(/\{nickname\}/g, result.nickname)
            .replace(/\{userId\}/g, String(gameId))
            .replace(/\{zoneId\}/g, String(zoneId))
            .replace(/\{country\}/g, result.country);

        const heart = frame.heart;
        const sparkle = frame.sparkle;
        const check = frame.check;

        const text =
            '<pre>' +
            escapeHtml(
                customBody
                    .split('\n')
                    .map(line => `${heart} ${line}`)
                    .join('\n')
            ) +
            '</pre>\n' +
            `${sparkle} ${check} Nickname နဲ့ ID ကို စစ်ဆေးပါ။` +
            `\n\n${heart} ${sparkle} ${heart}`;

        try {
            if (!message) {
                message = await bot.sendMessage(chatId, text, {
                    parse_mode: 'HTML'
                });
            } else {
                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: message.message_id,
                    parse_mode: 'HTML'
                });
            }
        } catch (error) {
            console.error('Animation frame error:', error.message);
        }

        // A short pause creates a pulsing effect.
        if (i < animationFrames.length - 1) {
            await delay(1100);
        }
    }

    if (message) {
        try {
            await bot.editMessageReplyMarkup(
                resultKeyboard(gameId, zoneId, token),
                {
                    chat_id: chatId,
                    message_id: message.message_id
                }
            );
        } catch (error) {
            console.error('Keyboard error:', error.message);
        }
    }
}

// =====================================
// MESSAGE HANDLER
// =====================================

bot.on('message', async msg => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text || msg.caption || '';

    if (!text || !userId) return;

    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text.trim())) {
        await bot.sendMessage(
            chatId,
            '💜 မင်္ဂလာပါ!\n\n' +
            '🆔 MLBB ID နဲ့ Zone ID ပို့ပေးပါ။\n' +
            'ဥပမာ: 667124253(8664)\n\n' +
            '✨ ID ၅ ခုအထိ စစ်နိုင်ပါတယ်။'
        );
        return;
    }

    if (/^\/settemplate(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(userId)) {
            await bot.sendMessage(chatId, '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။');
            return;
        }

        const template = text
            .replace(/^\/settemplate(?:@\w+)?/, '')
            .trim();

        if (!template) {
            await bot.sendMessage(
                chatId,
                'လက်ရှိ Template:\n\n' +
                botTemplates.checkResult +
                '\n\nပြောင်းရန်:\n' +
                '/settemplate Nickname: {nickname}\n' +
                'ID: {userId} ({zoneId})\n' +
                'Region: {country}'
            );
            return;
        }

        botTemplates.checkResult = template;
        await bot.sendMessage(chatId, '✅ Template ပြောင်းပြီးပါပြီ။');
        return;
    }

    if (/^\/setconfirm(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(userId)) {
            await bot.sendMessage(chatId, '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။');
            return;
        }

        const template = text
            .replace(/^\/setconfirm(?:@\w+)?/, '')
            .trim();

        if (!template) {
            await bot.sendMessage(
                chatId,
                'လက်ရှိ Confirm Template:\n\n' +
                botTemplates.confirmMessage +
                '\n\nပြောင်းရန်:\n/setconfirm မင်းလိုချင်တဲ့စာသား'
            );
            return;
        }

        botTemplates.confirmMessage = template;
        await bot.sendMessage(chatId, '✅ Confirm Template ပြောင်းပြီးပါပြီ။');
        return;
    }

    const regex =
        /(\d{5,12})\s*[\(\（]\s*(\d{3,6})\s*[\)\）]/g;

    const matches = [...text.matchAll(regex)].slice(0, 5);

    if (!matches.length) return;

    for (const match of matches) {
        const gameId = match[1];
        const zoneId = match[2];
        let loading;

        try {
            loading = await bot.sendMessage(
                chatId,
                `🔎 စစ်ဆေးနေပါတယ်...\n🆔 ${gameId} (${zoneId})`
            );

            const result = await fetchMlbbData(gameId, zoneId);
            await deleteMessage(chatId, loading.message_id);

            if (result.status === 'error') {
                await bot.sendMessage(
                    chatId,
                    '⚠️ လောလောဆယ် စစ်ဆေး၍မရပါ။ ခဏနေမှ ပြန်စမ်းပါ။'
                );
                continue;
            }

            if (result.status === 'invalid') {
                await bot.sendMessage(
                    chatId,
                    `❌ ID ${gameId} (${zoneId}) ကို ရှာမတွေ့ပါ။`
                );
                continue;
            }

            await sendAnimatedResult(
                chatId,
                gameId,
                zoneId,
                result,
                userId
            );

        } catch (error) {
            console.error('Message handler error:', error.message);

            if (loading) {
                await deleteMessage(chatId, loading.message_id);
            }

            await bot.sendMessage(
                chatId,
                '⚠️ လုပ်ဆောင်မှု မအောင်မြင်ပါ။ ခဏနေမှ ပြန်စမ်းပါ။'
            ).catch(() => {});
        }
    }
});

// =====================================
// BUTTON HANDLER
// =====================================

bot.on('callback_query', async query => {
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const userId = query.from?.id;
    const data = query.data || '';

    if (!chatId || !messageId || !userId) {
        await answerCallback(query.id);
        return;
    }

    if (data.startsWith('confirm_')) {
        const token = data.slice('confirm_'.length);
        const check = getCheck(token);

        if (!check) {
            await answerCallback(query.id, {
                text: '⚠️ သက်တမ်းကုန်သွားပါပြီ။ ID ကို ပြန်ပို့ပါ။',
                show_alert: true
            });
            return;
        }

        if (check.ownerId !== userId) {
            await answerCallback(query.id, {
                text: '❌ ID ပိုင်ရှင်သာ အတည်ပြုနိုင်ပါတယ်။',
                show_alert: true
            });
            return;
        }

        if (check.confirmed) {
            await answerCallback(query.id, {
                text: '✅ အတည်ပြုပြီးပါပြီ။'
            });
            return;
        }

        check.confirmed = true;

        await answerCallback(query.id, {
            text: '💖 ID အတည်ပြုပြီးပါပြီ။'
        });

        const currentText = query.message.text || '';
        const newText = currentText.replace(
            /Nickname နဲ့ ID ကို စစ်ဆေးပါ။/,
            'Nickname နဲ့ ID ကို အတည်ပြုပြီးပါပြီ။'
        );

        try {
            await bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: copyKeyboard(
                    check.gameId,
                    check.zoneId
                )
            });
        } catch (error) {
            console.error('Confirm error:', error.message);
        }
    }
});

bot.on('polling_error', error => {
    console.error('Polling error:', error.message);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

console.log('Bot started.');
