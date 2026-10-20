
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

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

app.get('/', (req, res) => {
    res.status(200).send('MLBB ID Checker Bot is Running!');
});

app.get('/health', (req, res) => {
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
        '👋 Nickname: {nickname}\n\n' +
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
                'မရရှိပါ';

            return {
                status: 'valid',
                nickname,
                country: String(country)
            };
        }

        if (
            result &&
            result.success === false
        ) {
            return {
                status: 'invalid',
                message: result.message || 'Player not found'
            };
        }

        return {
            status: 'error'
        };

    } catch (error) {
        console.error(
            'MLBB API error:',
            error.response?.status ||
            error.code ||
            error.message
        );

        return {
            status: 'error'
        };
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

function makeCopyKeyboard(gameId, zoneId, ownerId) {
    return {
        inline_keyboard: [
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
            }],
            [{
                text: '🔒 စစ်ဆေးမှု ပြီးဆုံးပါပြီ',
                callback_data: `done_${ownerId}`
            }]
        ]
    };
}

function makeResultKeyboard(gameId, zoneId, ownerId) {
    return {
        inline_keyboard: [
            [{
                text: '✅ ID မှန်ကန်ကြောင်း အတည်ပြုရန်',
                callback_data:
                    `confirm_${gameId}_${zoneId}_${ownerId}`
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
// MESSAGE HANDLER
// =====================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = msg.from?.id;
    const text = msg.text || msg.caption || '';

    if (!text || !telegramUserId) return;

    // START COMMAND
    if (text.trim() === '/start') {
        return bot.sendMessage(
            chatId,
            'မင်္ဂလာပါ 💜 Treasure MLBB ID Checker မှ ကြိုဆိုပါတယ်။\n\n' +
            'MLBB User ID နဲ့ Zone ID ကို အောက်ပါပုံစံအတိုင်း ပို့ပေးပါ။\n\n' +
            'ဥပမာ - 667124253(8664)\n\n' +
            'စာသားထဲမှာဖြစ်စေ၊ ပုံ Caption ထဲမှာဖြစ်စေ ' +
            'ID ၅ ခုအထိ တစ်ခါတည်း စစ်နိုင်ပါတယ်။'
        );
    }

    // SET RESULT TEMPLATE
    if (text.startsWith('/settemplate')) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            return bot.sendMessage(
                chatId,
                '❌ Admin/Owner သာ အသုံးပြုနိုင်ပါသည်။'
            );
        }

        const newTemplate = text
            .replace(/^\/settemplate(?:@\w+)?/, '')
            .trim();

        if (!newTemplate) {
            return bot.sendMessage(
                chatId,
                '📝 လက်ရှိ Result Template:\n\n' +
                botTemplates.checkResult +
                '\n\nပြောင်းရန်:\n' +
                '/settemplate Nickname: {nickname}\n' +
                'ID: {userId}\n' +
                'Zone: {zoneId}\n' +
                'Country: {country}'
            );
        }

        botTemplates.checkResult = newTemplate;

        return bot.sendMessage(
            chatId,
            '✅ Result Template ပြောင်းလဲပြီးပါပြီ။'
        );
    }

    // SET CONFIRM TEMPLATE
    if (text.startsWith('/setconfirm')) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            return bot.sendMessage(
                chatId,
                '❌ Admin/Owner သာ အသုံးပြုနိုင်ပါသည်။'
            );
        }

        const newTemplate = text
            .replace(/^\/setconfirm(?:@\w+)?/, '')
            .trim();

        if (!newTemplate) {
            return bot.sendMessage(
                chatId,
                '📝 လက်ရှိ Confirm Template:\n\n' +
                botTemplates.confirmMessage +
                '\n\nပြောင်းရန်:\n' +
                '/setconfirm မင်းလိုချင်တဲ့ စာသား'
            );
        }

        botTemplates.confirmMessage = newTemplate;

        return bot.sendMessage(
            chatId,
            '✅ Confirm Template ပြောင်းလဲပြီးပါပြီ။'
        );
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
                `🔍 စစ်ဆေးနေသည်: ${gameId}(${zoneId})...`
            );

            const result = await fetchMlbbData(gameId, zoneId);

            await safeDeleteMessage(
                chatId,
                loadingMsg.message_id
            );

            if (result.status === 'error') {
                await bot.sendMessage(
                    chatId,
                    `⚠️ ID: ${gameId}(${zoneId}) ကို လောလောဆယ် ` +
                    'စစ်ဆေး၍မရပါ။ API ချိတ်ဆက်မှုကို စစ်ဆေးပြီး ' +
                    'ခဏနေမှ ပြန်စမ်းပါ။'
                );
                continue;
            }

            if (result.status === 'invalid') {
                await bot.sendMessage(
                    chatId,
                    `❌ ID: ${gameId}(${zoneId}) ကို API က ရှာမတွေ့ပါ။\n` +
                    'User ID နဲ့ Zone ID ကို ပြန်စစ်ပေးပါ။'
                );
                continue;
            }

            // BUILD RESULT MESSAGE
            const replyText = botTemplates.checkResult
                .replace(/\{nickname\}/g, result.nickname)
                .replace(/\{userId\}/g, gameId)
                .replace(/\{zoneId\}/g, zoneId)
                .replace(/\{country\}/g, result.country);

            await bot.sendMessage(
                chatId,
                replyText,
                {
                    reply_markup: makeResultKeyboard(
                        gameId,
                        zoneId,
                        telegramUserId
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
    const telegramUserId = query.from.id;
    const data = query.data || '';

    if (!chatId || !messageId) {
        return safeAnswerCallback(query.id);
    }

    // CONFIRM ID
    if (data.startsWith('confirm_')) {
        const parts = data.split('_');

        const gameId = parts[1];
        const zoneId = parts[2];
        const ownerId = Number(parts[3]);

        if (ownerId !== telegramUserId) {
            return safeAnswerCallback(query.id, {
                text: '❌ ဒီ ID ကို စစ်ဆေးခဲ့တဲ့ Customer သာ အတည်ပြုနိုင်ပါတယ်။',
                show_alert: true
            });
        }

        await safeAnswerCallback(query.id, {
            text: '✅ ID အတည်ပြုပြီးပါပြီ။'
        });

        const oldText = query.message.text || '';

        const updatedText = oldText.replace(
            '⚠️ Nickname နဲ့ ID ကို သေချာစစ်ဆေးပါ။',
            '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။'
        );

        // CONFIRM BUTTON DISAPPEARS.
        // COPY BUTTONS REMAIN.
        try {
            await bot.editMessageText(updatedText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: makeCopyKeyboard(
                    gameId,
                    zoneId,
                    ownerId
                )
            });
        } catch (error) {
            console.error('Confirm edit error:', error.message);
        }

        // DO NOT SEND A NEW MESSAGE HERE.
        return;
    }

    if (data.startsWith('done_')) {
        const ownerId = Number(data.split('_')[1]);

        if (ownerId !== telegramUserId) {
            return safeAnswerCallback(query.id, {
                text: '❌ ဒီခလုတ်ကို စစ်ဆေးခဲ့တဲ့ Customer သာ အသုံးပြုနိုင်ပါတယ်။',
                show_alert: true
            });
        }

        return safeAnswerCallback(query.id, {
            text: 'အတည်ပြုပြီးပါပြီ။'
        });
    }

    return safeAnswerCallback(query.id);
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

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});
