
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

// =====================================
// CONFIG
// =====================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [1006058484, 8003687808];
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is missing!');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.disable('x-powered-by');

app.get('/', (_req, res) => {
    res.status(200).send('Bot is running!');
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

server.requestTimeout = 10000;
server.headersTimeout = 12000;

// =====================================
// TEMPLATES
// =====================================

let botTemplates = {
    checkResult:
        '💜 Nickname: {nickname}\n' +
        '💜 ID: {userId} ({zoneId})\n' +
        '💜 Region: {country}',

    confirmMessage:
        '✅ ID အတည်ပြုပြီးပါပြီ။\n' +
        '⏳ 5 မိနစ်မှ 15 မိနစ်အတွင်း ထည့်ပေးပါမည်။'
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
            error.response?.status ||
            error.code ||
            error.message
        );

        return { status: 'error' };
    }
}

// =====================================
// SAFE HELPERS
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

function renderTemplate(template, data) {
    return template.replace(
        /\{(nickname|userId|zoneId|country)\}/g,
        (_, key) => escapeHtml(data[key] ?? '')
    );
}

// =====================================
// CHECK STORAGE
// =====================================

const checks = new Map();
const CHECK_TTL = 30 * 60 * 1000;
const MAX_CHECKS = 2000;

function createCheck(gameId, zoneId, ownerId, result) {
    const token = crypto.randomBytes(8).toString('hex');

    checks.set(token, {
        gameId: String(gameId),
        zoneId: String(zoneId),
        ownerId,
        nickname: result.nickname,
        country: result.country,
        confirmed: false,
        createdAt: Date.now()
    });

    while (checks.size > MAX_CHECKS) {
        checks.delete(checks.keys().next().value);
    }

    return token;
}

function getCheck(token) {
    const item = checks.get(token);

    if (!item) return null;

    if (Date.now() - item.createdAt > CHECK_TTL) {
        checks.delete(token);
        return null;
    }

    return item;
}

// =====================================
// BUTTONS
// =====================================

function copyKeyboard(gameId, zoneId) {
    return {
        inline_keyboard: [[
            {
                text: '📋 Copy ID',
                copy_text: {
                    text: String(gameId)
                }
            },
            {
                text: '📋 Copy Zone',
                copy_text: {
                    text: String(zoneId)
                }
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
                copy_text: {
                    text: String(gameId)
                }
            }, {
                text: '📋 Copy Zone',
                copy_text: {
                    text: String(zoneId)
                }
            }]
        ]
    };
}

// =====================================
// SEPARATE BOXES - NO COPY CODE BUTTON
// =====================================

function makeResultText(item, frame, confirmed = false) {
    const heart = frame.heart;
    const sparkle = frame.sparkle;
    const tick = frame.tick;

    const fields = [
        `${heart} Nickname: ${escapeHtml(item.nickname)}`,
        `${heart} ID: ${escapeHtml(item.gameId)} (${escapeHtml(item.zoneId)})`,
        `${heart} Region: ${escapeHtml(item.country)}`
    ];

    // Separate visual boxes without <pre> or <code>.
    const boxes = fields.map(line =>
        `<blockquote>${line}</blockquote>`
    ).join('\n');

    const status = confirmed
        ? botTemplates.confirmMessage
        : `${sparkle} ${tick} Nickname နဲ့ ID ကို စစ်ဆေးပါ။`;

    // The final resting heart is purple.
    const footer = confirmed
        ? '💜'
        : `💜 ${sparkle} 💜`;

    return `${boxes}\n${status}\n\n${footer}`;
}

// =====================================
// HEART / SPARKLE ANIMATION
// =====================================

const frames = [
    { heart: '💜', sparkle: '✨', tick: '☑️' },
    { heart: '💖', sparkle: '🌟', tick: '✅' },
    { heart: '💗', sparkle: '💫', tick: '✔️' },
    { heart: '🤍', sparkle: '✨', tick: '☑️' },
    { heart: '💜', sparkle: '✨', tick: '✅' }
];

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
    const item = {
        gameId: String(gameId),
        zoneId: String(zoneId),
        nickname: result.nickname,
        country: result.country
    };

    const token = createCheck(
        gameId,
        zoneId,
        ownerId,
        result
    );

    let sentMessage = null;

    for (let i = 0; i < frames.length; i++) {
        const text = makeResultText(item, frames[i]);

        try {
            if (!sentMessage) {
                sentMessage = await bot.sendMessage(
                    chatId,
                    text,
                    { parse_mode: 'HTML' }
                );
            } else {
                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: sentMessage.message_id,
                    parse_mode: 'HTML'
                });
            }
        } catch (error) {
            // Telegram may reject an identical edit.
            if (!String(error.message).includes('message is not modified')) {
                console.error('Animation error:', error.message);
            }
        }

        if (i < frames.length - 1) {
            await delay(900);
        }
    }

    if (sentMessage) {
        // End on purple hearts and keep the buttons.
        try {
            await bot.editMessageText(
                makeResultText(item, frames[4]),
                {
                    chat_id: chatId,
                    message_id: sentMessage.message_id,
                    parse_mode: 'HTML',
                    reply_markup: resultKeyboard(
                        gameId,
                        zoneId,
                        token
                    )
                }
            );
        } catch (error) {
            console.error('Final message error:', error.message);
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
            'MLBB ID နဲ့ Zone ID ပို့ပေးပါ။\n\n' +
            'ဥပမာ: 667124253(8664)\n\n' +
            '✨ ID ၅ ခုအထိ တစ်ခါတည်း စစ်နိုင်ပါတယ်။'
        );
        return;
    }

    // Admin: customize result template
    if (/^\/settemplate(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(userId)) {
            await bot.sendMessage(
                chatId,
                '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။'
            );
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
                '/settemplate 💜 Nickname: {nickname}\n' +
                '💜 ID: {userId} ({zoneId})\n' +
                '💜 Region: {country}'
            );
            return;
        }

        botTemplates.checkResult = template;

        await bot.sendMessage(
            chatId,
            '✅ Result Template ပြောင်းပြီးပါပြီ။'
        );
        return;
    }

    // Admin: customize confirmation text
    if (/^\/setconfirm(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(userId)) {
            await bot.sendMessage(
                chatId,
                '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။'
            );
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
                '\n\nပြောင်းရန်:\n' +
                '/setconfirm ✅ ID အတည်ပြုပြီးပါပြီ။ 5 မိနစ်မှ 15 မိနစ်အတွင်း ထည့်ပေးပါမည်။'
            );
            return;
        }

        botTemplates.confirmMessage = template;

        await bot.sendMessage(
            chatId,
            '✅ Confirm Template ပြောင်းပြီးပါပြီ။'
        );
        return;
    }

    // Accept ID(zone), ID (zone), and full messages.
    const regex =
        /(\d{5,12})\s*[\(\（]\s*(\d{3,6})\s*[\)\）]/g;

    const matches = [...text.matchAll(regex)].slice(0, 5);

    if (!matches.length) return;

    for (const match of matches) {
        const gameId = match[1];
        const zoneId = match[2];
        let loading = null;

        try {
            loading = await bot.sendMessage(
                chatId,
                `🔎 ID စစ်ဆေးနေပါတယ်...\n${gameId} (${zoneId})`
            );

            const result = await fetchMlbbData(gameId, zoneId);

            await deleteMessage(chatId, loading.message_id);
            loading = null;

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
// CALLBACK HANDLER
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

    if (!data.startsWith('confirm_')) {
        await answerCallback(query.id);
        return;
    }

    const token = data.slice('confirm_'.length);
    const item = getCheck(token);

    if (!item) {
        await answerCallback(query.id, {
            text: '⚠️ သက်တမ်းကုန်ပါပြီ။ ID ကို ပြန်ပို့ပါ။',
            show_alert: true
        });
        return;
    }

    if (item.ownerId !== userId) {
        await answerCallback(query.id, {
            text: '❌ ID စစ်ဆေးခဲ့တဲ့ Customer သာ အတည်ပြုနိုင်ပါတယ်။',
            show_alert: true
        });
        return;
    }

    if (item.confirmed) {
        await answerCallback(query.id, {
            text: '✅ အတည်ပြုပြီးပါပြီ။'
        });
        return;
    }

    item.confirmed = true;

    await answerCallback(query.id, {
        text: '💜 ID အတည်ပြုပြီးပါပြီ။'
    });

    const body = {
        gameId: item.gameId,
        zoneId: item.zoneId,
        nickname: item.nickname,
        country: item.country
    };

    // Same separate boxes, no Copy Code button.
    const finalText =
        makeResultText(body, frames[4], true);

    try {
        await bot.editMessageText(finalText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: copyKeyboard(
                item.gameId,
                item.zoneId
            )
        });
    } catch (error) {
        console.error('Confirmation edit error:', error.message);
    }
});

// =====================================
// ERROR HANDLERS
// =====================================

bot.on('polling_error', error => {
    console.error('Polling error:', error.message);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
});

console.log('Bot started successfully.'); 
