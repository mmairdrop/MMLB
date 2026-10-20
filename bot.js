
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

// =====================================
// CONFIGURATION
// =====================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [1006058484, 8003687808];
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is missing!');
}

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

const app = express();

app.get('/', (_req, res) => {
    res.status(200).send('💜 Treasure MLBB ID Checker is Running!');
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// =====================================
// MESSAGE TEMPLATES
// =====================================

let botTemplates = {
    checkResult:
        '👑 Nickname: {nickname}\n\n' +
        '🆔 User ID: {userId} 🌐 {zoneId}\n' +
        '🌍 Country: {country}\n\n' +
        '⚠️ Nickname နဲ့ ID ကို သေချာစစ်ဆေးပါ။',

    confirmMessage:
        '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။\n' +
        '🔜 ငွေလွှဲပြေစာရောက်ပြီး 5min မှ 10min အတွင်း ' +
        'ထည့်ပေးပါမယ်။\n\n' +
        'ဝယ်ယူအားပေးမှုအတွက် ကျေးဇူးတင်ပါတယ်ရှင့် 💜'
};

// =====================================
// MLBB ID CHECKER API
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
                timeout: 10000
            }
        );

        const result = response.data;

        console.log('MLBB API response:', result);

        if (
            result &&
            result.success === true &&
            typeof result.name === 'string' &&
            result.name.trim() !== ''
        ) {
            let nickname = result.name;

            try {
                nickname = decodeURIComponent(result.name);
            } catch (_) {
                nickname = result.name;
            }

            const country =
                result.country ||
                result.region ||
                result.data?.country ||
                result.data?.region ||
                'Myanmar (Burma)';

            return {
                status: 'valid',
                nickname,
                country: String(country)
            };
        }

        if (result && result.success === false) {
            return {
                status: 'invalid',
                message: result.message || 'Player not found'
            };
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
// TELEGRAM HELPERS
// =====================================

async function safeAnswerCallback(queryId, options = {}) {
    try {
        await bot.answerCallbackQuery(queryId, options);
    } catch (error) {
        console.error('Callback answer error:', error.message);
    }
}

async function safeDeleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (_) {}
}

// Keep callback data short and associate it with the correct customer.
const pendingChecks = new Map();

function createCheckToken(gameId, zoneId, ownerId) {
    const token = crypto.randomBytes(8).toString('hex');

    pendingChecks.set(token, {
        gameId: String(gameId),
        zoneId: String(zoneId),
        ownerId: Number(ownerId),
        confirmed: false
    });

    // Avoid unlimited memory growth.
    if (pendingChecks.size > 5000) {
        const oldestToken = pendingChecks.keys().next().value;
        pendingChecks.delete(oldestToken);
    }

    return token;
}

function makeCopyKeyboard(gameId, zoneId, token) {
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
            ],
            [
                {
                    text: '🔒 စစ်ဆေးမှု ပြီးဆုံးပါပြီ',
                    callback_data: `done_${token}`
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
                    text: '✅ ID မှန်ကန်ကြောင်း အတည်ပြုရန်',
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
    const template = botTemplates.checkResult;

    const body = template
        .replace(/\{nickname\}/g, () => result.nickname)
        .replace(/\{userId\}/g, () => String(gameId))
        .replace(/\{zoneId\}/g, () => String(zoneId))
        .replace(/\{country\}/g, () => result.country);

    return [
        '╭━━━━━━━━━━━━━━━━━━╮',
        '       💜 TREASURE 💜',
        '       🎮 MLBB ID CHECKER',
        '╰━━━━━━━━━━━━━━━━━━╯',
        '',
        body,
        '',
        '━━━━━━━━━━━━━━━━━━',
        '✨ Treasure Game Shop ✨'
    ].join('\n');
}

// =====================================
// MESSAGE HANDLER
// =====================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = msg.from?.id;
    const text = msg.text || msg.caption || '';

    if (!text || !telegramUserId) return;

    // START COMMAND
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text.trim())) {
        await bot.sendMessage(
            chatId,
            [
                '╭━━━━━━━━━━━━━━━━━━╮',
                '       💜 TREASURE 💜',
                '       🎮 MLBB ID CHECKER',
                '╰━━━━━━━━━━━━━━━━━━╯',
                '',
                '✨ မင်္ဂလာပါ။ ကြိုဆိုပါတယ်။',
                '',
                '🆔 MLBB User ID နဲ့ Zone ID ကို ပို့ပေးပါ။',
                '',
                '📝 ဥပမာ:',
                '667124253(8664)',
                '',
                '📌 ID ၅ ခုအထိ တစ်ခါတည်း စစ်နိုင်ပါတယ်။',
                '',
                '💎 Treasure Game Shop 💎'
            ].join('\n')
        );
        return;
    }

    // SET RESULT TEMPLATE
    if (/^\/settemplate(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            await bot.sendMessage(
                chatId,
                '❌ Admin/Owner သာ အသုံးပြုနိုင်ပါသည်။'
            );
            return;
        }

        const newTemplate = text
            .replace(/^\/settemplate(?:@\w+)?/, '')
            .trim();

        if (!newTemplate) {
            await bot.sendMessage(
                chatId,
                '📝 လက်ရှိ Result Template:\n\n' +
                botTemplates.checkResult +
                '\n\nပြောင်းရန်:\n' +
                '/settemplate Nickname: {nickname}\n' +
                'ID: {userId}\n' +
                'Zone: {zoneId}\n' +
                'Country: {country}'
            );
            return;
        }

        botTemplates.checkResult = newTemplate;

        await bot.sendMessage(
            chatId,
            '✅ Result Template ပြောင်းလဲပြီးပါပြီ။'
        );
        return;
    }

    // SET CONFIRM TEMPLATE
    if (/^\/setconfirm(?:@\w+)?(?:\s|$)/.test(text)) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            await bot.sendMessage(
                chatId,
                '❌ Admin/Owner သာ အသုံးပြုနိုင်ပါသည်။'
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
                '/setconfirm မင်းလိုချင်တဲ့ စာသား'
            );
            return;
        }

        botTemplates.confirmMessage = newTemplate;

        await bot.sendMessage(
            chatId,
            '✅ Confirm Template ပြောင်းလဲပြီးပါပြီ။'
        );
        return;
    }

    // FIND UP TO 5 USER IDs
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
                `🔍 ID စစ်ဆေးနေပါတယ်...\n\n🆔 ${gameId}\n🌐 Zone: ${zoneId}\n⏳ ခဏစောင့်ပေးပါ။`
            );

            const result = await fetchMlbbData(gameId, zoneId);

            await safeDeleteMessage(
                chatId,
                loadingMsg.message_id
            );

            if (result.status === 'error') {
                await bot.sendMessage(
                    chatId,
                    [
                        '╭━━━━━━━━━━━━━━━━━━╮',
                        '       ⚠️ CHECK ERROR',
                        '╰━━━━━━━━━━━━━━━━━━╯',
                        '',
                        `🆔 ID: ${gameId}`,
                        `🌐 Zone: ${zoneId}`,
                        '',
                        'လောလောဆယ် စစ်ဆေး၍မရပါ။',
                        'ခဏနေမှ ပြန်စမ်းပေးပါ။'
                    ].join('\n')
                );
                continue;
            }

            if (result.status === 'invalid') {
                await bot.sendMessage(
                    chatId,
                    [
                        '╭━━━━━━━━━━━━━━━━━━╮',
                        '       ❌ INVALID ID',
                        '╰━━━━━━━━━━━━━━━━━━╯',
                        '',
                        `🆔 ID: ${gameId}`,
                        `🌐 Zone: ${zoneId}`,
                        '',
                        'Player ကို API က ရှာမတွေ့ပါ။',
                        'ID နဲ့ Zone ကို ပြန်စစ်ပေးပါ။'
                    ].join('\n')
                );
                continue;
            }

            const token = createCheckToken(
                gameId,
                zoneId,
                telegramUserId
            );

            const replyText = makeResultText(
                gameId,
                zoneId,
                result
            );

            await bot.sendMessage(
                chatId,
                replyText,
                {
                    reply_markup: makeResultKeyboard(
                        gameId,
                        zoneId,
                        token
                    )
                }
            );

        } catch (error) {
            console.error(
                'Message handler error:',
                error.message
            );

            if (loadingMsg) {
                await safeDeleteMessage(
                    chatId,
                    loadingMsg.message_id
                );
            }

            await bot.sendMessage(
                chatId,
                '⚠️ လုပ်ဆောင်မှု မအောင်မြင်ပါ။ ခဏနေမှ ပြန်စမ်းပါ။'
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

    // CONFIRM ID
    if (data.startsWith('confirm_')) {
        const token = data.slice('confirm_'.length);
        const check = pendingChecks.get(token);

        if (!check) {
            await safeAnswerCallback(query.id, {
                text: '⚠️ စစ်ဆေးမှု သက်တမ်းကုန်သွားပါပြီ။ ID ကို ပြန်ပို့ပါ။',
                show_alert: true
            });
            return;
        }

        if (check.ownerId !== telegramUserId) {
            await safeAnswerCallback(query.id, {
                text: '❌ ဒီ ID ကို စစ်ဆေးခဲ့တဲ့ Customer သာ အတည်ပြုနိုင်ပါတယ်။',
                show_alert: true
            });
            return;
        }

        if (check.confirmed) {
            await safeAnswerCallback(query.id, {
                text: '✅ အတည်ပြုပြီးသား ဖြစ်ပါတယ်။'
            });
            return;
        }

        check.confirmed = true;

        await safeAnswerCallback(query.id, {
            text: '✅ ID အတည်ပြုပြီးပါပြီ။'
        });

        const oldText = query.message.text || '';
        const warning = '⚠️ Nickname နဲ့ ID ကို သေချာစစ်ဆေးပါ။';

        const updatedText = oldText.includes(warning)
            ? oldText.replace(
                warning,
                '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။'
            )
            : oldText + '\n\n✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။';

        try {
            // Edit the existing result message.
            // Keep Copy ID / Copy Zone buttons.
            await bot.editMessageText(updatedText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: makeCopyKeyboard(
                    check.gameId,
                    check.zoneId,
                    token
                )
            });

        } catch (error) {
            console.error(
                'Confirm edit error:',
                error.message
            );
        }

        // Do not send a second confirmation message.
        return;
    }

    // FINISH BUTTON
    if (data.startsWith('done_')) {
        const token = data.slice('done_'.length);
        const check = pendingChecks.get(token);

        if (!check || check.ownerId !== telegramUserId) {
            await safeAnswerCallback(query.id, {
                text: '❌ ဒီခလုတ်ကို အသုံးပြုခွင့်မရှိပါ။',
                show_alert: true
            });
            return;
        }

        await safeAnswerCallback(query.id, {
            text: '💜 ပြီးဆုံးပါပြီ။'
        });
        return;
    }

    await safeAnswerCallback(query.id);
});

// =====================================
// ERROR HANDLERS
// =====================================

bot.on('polling_error', (error) => {
    console.error(
        'Telegram polling error:',
        error.message
    );
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

console.log('💜 Treasure MLBB ID Checker started!');
