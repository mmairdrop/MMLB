
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [1006058484, 8003687808];

if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is missing');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('MLBB Checker Bot is Running!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message);
});

const botTemplates = {
    checkResult:
        '👋 Nickname: {nickname}\n\n' +
        '🆔 User ID: {userId} 🌐 {zoneId}\n' +
        '🌍 Country: {country}\n\n' +
        '⚠️ Nickname နဲ့ ID ကို သေချာစစ်ဆေးပါ။',

    confirmMessage:
        '✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။\n' +
        '🔜 ငွေလွှဲပြေစာကို Admin ထံပို့ပေးပါ။\n' +
        'ငွေပေးချေမှု အတည်ပြုပြီးမှ Top-up လုပ်ပေးပါမယ်။\n\n' +
        'ဝယ်ယူအားပေးမှုအတွက် ကျေးဇူးတင်ပါတယ် 💜'
};

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

        // API က ID မမှန်ကြောင်း အတည်ပြုမှသာ invalid ဟု သတ်မှတ်မည်။
        if (result && result.success === true && result.name) {
            let nickname;

            try {
                nickname = decodeURIComponent(result.name);
            } catch {
                nickname = result.name;
            }

            return {
                status: 'valid',
                nickname,
                country: 'API မှ မဖော်ပြထားပါ'
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
            error.response?.status || error.code || error.message
        );

        return { status: 'error' };
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = msg.from?.id;
    const text = msg.text || msg.caption || '';

    if (!text || !telegramUserId) return;

    if (text.trim() === '/start') {
        return bot.sendMessage(
            chatId,
            'မင်္ဂလာပါ 💜 MLBB ID စစ်ဆေးရန်\n\n' +
            'User ID နဲ့ Zone ID ကို 12345678(1234) ' +
            'ပုံစံဖြင့် ပို့ပေးပါ။\n' +
            'စာသား သို့မဟုတ် ပုံ Caption ထဲမှ ID ၅ ခုအထိ စစ်နိုင်ပါတယ်။'
        );
    }

    if (text.startsWith('/settemplate')) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            return bot.sendMessage(
                chatId,
                '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။'
            );
        }

        return bot.sendMessage(
            chatId,
            '📝 လက်ရှိ Result Template:\n\n' +
            botTemplates.checkResult +
            '\n\nConfirm Template:\n' +
            botTemplates.confirmMessage +
            '\n\nမှတ်ချက်: ဤ Version တွင် Template ပြောင်းလဲမှုကို ' +
            'အမြဲတမ်းသိမ်းဆည်းခြင်း မပါဝင်ပါ။'
        );
    }

    const regex = /(\d{5,12})\s*[\(\（]\s*(\d{3,6})\s*[\)\）]/g;
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

            await bot.deleteMessage(
                chatId,
                loadingMsg.message_id
            ).catch(() => {});

            if (result.status === 'error') {
                await bot.sendMessage(
                    chatId,
                    `⚠️ ID: ${gameId}(${zoneId}) ကို လောလောဆယ် ` +
                    'စစ်ဆေး၍မရပါ။ API ပြဿနာဖြစ်နိုင်ပါတယ်။ ' +
                    'ခဏနေမှ ပြန်စမ်းပါ။'
                );
                continue;
            }

            if (result.status === 'invalid') {
                await bot.sendMessage(
                    chatId,
                    `❌ ID: ${gameId}(${zoneId}) ကို API က ` +
                    'ရှာမတွေ့ပါ။ ID နဲ့ Zone ID ကို ပြန်စစ်ပါ။'
                );
                continue;
            }

            const replyText = botTemplates.checkResult
                .replace('{nickname}', result.nickname)
                .replace('{userId}', gameId)
                .replace('{zoneId}', zoneId)
                .replace('{country}', result.country);

            const keyboard = [
                [{
                    text: '✅ ID မှန်ကန်ကြောင်း အတည်ပြုရန်',
                    callback_data:
                        `confirm_${gameId}_${zoneId}_${telegramUserId}`
                }]
            ];

            if (ADMIN_IDS.includes(telegramUserId)) {
                keyboard.push([
                    {
                        text: '📋 Copy ID',
                        callback_data: `copy_id_${gameId}`
                    },
                    {
                        text: '📋 Copy Zone',
                        callback_data: `copy_zone_${zoneId}`
                    }
                ]);
            }

            await bot.sendMessage(chatId, replyText, {
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });

        } catch (error) {
            console.error('Message handler error:', error.message);

            if (loadingMsg) {
                await bot.deleteMessage(
                    chatId,
                    loadingMsg.message_id
                ).catch(() => {});
            }

            await bot.sendMessage(
                chatId,
                '⚠️ တောင်းဆိုမှုကို လုပ်ဆောင်၍မရပါ။ ခဏနေမှ ပြန်စမ်းပါ။'
            ).catch(() => {});
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat?.id;
    const telegramUserId = query.from.id;
    const data = query.data || '';

    if (!chatId) {
        return bot.answerCallbackQuery(query.id).catch(() => {});
    }

    if (data.startsWith('confirm_')) {
        const parts = data.split('_');
        const ownerId = Number(parts[3]);

        if (ownerId !== telegramUserId) {
            return bot.answerCallbackQuery(query.id, {
                text: '❌ ဒီ ID ကို စစ်ဆေးခဲ့တဲ့ Customer သာ အတည်ပြုနိုင်ပါတယ်။',
                show_alert: true
            });
        }

        await bot.answerCallbackQuery(query.id, {
            text: 'ID အတည်ပြုပြီးပါပြီ။'
        });

        return bot.sendMessage(
            chatId,
            botTemplates.confirmMessage
        );
    }

    if (data.startsWith('copy_id_')) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            return bot.answerCallbackQuery(query.id, {
                text: '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။',
                show_alert: true
            });
        }

        const copyId = data.slice('copy_id_'.length);

        await bot.answerCallbackQuery(query.id, {
            text: `ID: ${copyId}`
        });

        return bot.sendMessage(chatId, copyId);
    }

    if (data.startsWith('copy_zone_')) {
        if (!ADMIN_IDS.includes(telegramUserId)) {
            return bot.answerCallbackQuery(query.id, {
                text: '❌ Admin သာ အသုံးပြုနိုင်ပါသည်။',
                show_alert: true
            });
        }

        const copyZone = data.slice('copy_zone_'.length);

        await bot.answerCallbackQuery(query.id, {
            text: `Zone: ${copyZone}`
        });

        return bot.sendMessage(chatId, copyZone);
    }

    return bot.answerCallbackQuery(query.id).catch(() => {});
});
