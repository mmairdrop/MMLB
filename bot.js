const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN || '8587488350:AAH9_ju9OhNC8L6eyNKdloLlh5gCv7CHTiM';
const ADMIN_IDS = [1006058484, 8003687808];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const app = express();
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

app.get('/', (req, res) => res.send('MLBB Checker Bot is Running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

setInterval(() => {
    if (RENDER_URL) {
        axios.get(RENDER_URL).catch(() => {});
    }
}, 45000);

let botTemplates = {
    checkResult: `👋 Nickname: {nickname}\n\n🆔 User ID: {userId} 🌐 {zoneId}\n🌍 Country: {country}\n\n ⚠️Nickname နဲ့ ID ကို သေချာစစ်ဆေးပါ။`,
    confirmMessage: `✅ ID မှန်ကန်ကြောင်း အတည်ပြုပြီးပါပြီ။\n🔜 ငွေလွှဲ‌ပြေစာရောက်ပြီး 5min မှ 10min အတွင်း ထည့်ပေးပါမယ်။\n\n ဝယ်ယူအားပေးမှုအတွက် ကျေးဇူးတင်ပါတယ်ရှင့် 💜`
};

async function fetchMlbbData(userId, zoneId) {
    try {
        const response = await axios.post('https://api.viphub.id/api/v1/game/mobile-legends/check', {
            id: userId,
            zone: zoneId
        }, { timeout: 7000 });

        if (response.data && response.data.status) {
            return {
                nickname: response.data.data.username || response.data.data.nickname,
                country: response.data.data.region || 'Myanmar'
            };
        }
    } catch (e) {
        console.log('Primary API failed:', e.message);
    }
    return null;
}

// Handle both text messages and photo captions
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || msg.caption || '';

    if (!text) return;

    if (text.trim() === '/start') {
        return bot.sendMessage(chatId, `မင်္ဂလာပါ! MLBB ID စစ်ဆေးရန် ID နှင့် Zone ကို ပို့ပေးပါ။ စာသားများကြားထဲတွင်ဖြစ်စေ၊ ပုံနှင့်တွဲ၍ဖြစ်စေ ID ၅ ခုအထိ တခါတည်း ပို့စစ်နိုင်ပါသည်။`, { parse_mode: 'Markdown' });
    }

    if (text.startsWith('/settemplate')) {
        if (!ADMIN_IDS.includes(userId)) {
            return bot.sendMessage(chatId, '❌ သင်သည် Owner/Admin မဟုတ်ပါ။');
        }
        const newText = text.replace('/settemplate', '').trim();
        if (!newText) {
            return bot.sendMessage(chatId, `📝 **လက်ရှိ စာသား ပုံစံများ:**\n\n1. Result Template:\n${botTemplates.checkResult}\n\n2. Confirm Template:\n${botTemplates.confirmMessage}`);
        }
        botTemplates.checkResult = newText;
        return bot.sendMessage(chatId, '✅ စာသားနှင့် Emoji ပုံစံကို အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ။');
    }

    // Flexible Regex to find up to 5 IDs (handles surrounding text, spaces, and brackets like 12345678(1234))
    const regex = /(\d{5,12})\s*[\(\（]\s*(\d{3,6})\s*[\)\）]/g;
    const matches = [...text.matchAll(regex)].slice(0, 5);

    if (matches.length > 0) {
        for (const match of matches) {
            const gameId = match[1];
            const zoneId = match[2];

            const loadingMsg = await bot.sendMessage(chatId, `🔍 စစ်ဆေးနေသည်: ${gameId}(${zoneId})...`);
            const data = await fetchMlbbData(gameId, zoneId);
            bot.deleteMessage(chatId, loadingMsg.message_id);

            if (!data) {
                await bot.sendMessage(chatId, `❌ ID: ${gameId}(${zoneId}) သည် မှားယွင်းနေပါသည် သို့မဟုတ် API ချိတ်ဆက်၍ မရပါ။`);
                continue;
            }

            let replyText = botTemplates.checkResult
                .replace('{nickname}', data.nickname)
                .replace('{userId}', gameId)
                .replace('{zoneId}', zoneId)
                .replace('{country}', data.country);

            const inlineKeyboard = [
                [{ text: '✅ ID မှန်ကန်ကြောင်း အတည်ပြုရန်', callback_data: `confirm_${gameId}_${zoneId}` }]
            ];

            if (ADMIN_IDS.includes(userId)) {
                inlineKeyboard.push([
                    { text: '📋 Copy ID', callback_data: `copy_id_${gameId}` },
                    { text: '📋 Copy Zone', callback_data: `copy_zone_${zoneId}` }
                ]);
            }

            await bot.sendMessage(chatId, replyText, {
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (data.startsWith('confirm_')) {
        bot.answerCallbackQuery(query.id, { text: 'အတည်ပြုပြီးပါပြီ!' });
        bot.sendMessage(chatId, botTemplates.confirmMessage);
    }

    if (data.startsWith('copy_id_')) {
        if (!ADMIN_IDS.includes(userId)) {
            return bot.answerCallbackQuery(query.id, { text: '❌ Admin/Owner သာ Copy ကူးနိုင်ပါသည်။', show_alert: true });
        }
        const copyId = data.replace('copy_id_', '');
        bot.answerCallbackQuery(query.id, { text: `ID: ${copyId}`, show_alert: false });
        bot.sendMessage(chatId, `\`${copyId}\``, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('copy_zone_')) {
        if (!ADMIN_IDS.includes(userId)) {
            return bot.answerCallbackQuery(query.id, { text: `❌ Admin/Owner သာ Copy ကူးနိုင်ပါသည်။`, show_alert: true });
        }
        const copyZone = data.replace('copy_zone_', '');
        bot.answerCallbackQuery(query.id, { text: `Zone: ${copyZone}`, show_alert: false });
        bot.sendMessage(chatId, `\`${copyZone}\``, { parse_mode: 'Markdown' });
    }
});
