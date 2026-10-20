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
        }, { timeout: 5000 });

        if (response.data && response.data.status) {
            return {
                nickname: response.data.data.username || response.data.data.nickname,
                country: response.data.data.region || 'Unknown'
            };
        }
    } catch (e) {
        console.log('Primary API failed. Switching to Backup API...');
    }

    try {
        const response = await axios.get(`https://api.elixir.my.id/api/mlbb?id=${userId}&zone=${zoneId}`, { timeout: 5000 });
        if (response.data && response.data.result) {
            return {
                nickname: response.data.result.username || response.data.result.nickname,
                country: 'N/A (Backup API)'
            };
        }
    } catch (e) {
        console.log('Backup API failed:', e.message);
    }

    return null;
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text ? msg.text.trim() : '';

    if (text === '/start') {
        return bot.sendMessage(chatId, `မင်္ဂလာပါ! MLBB ID စစ်ဆေးရန် \`12345678(1234)\` ပုံစံဖြင့် စာပို့ပေးပါ။`, { parse_mode: 'Markdown' });
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

    const match = text.match(/^(\d+)[(\s]+(\d+)\)?$/);
    if (match) {
        const gameId = match[1];
        const zoneId = match[2];

        const loadingMsg = await bot.sendMessage(chatId, '🔍 အချက်အလက်များ စစ်ဆေးနေပါသည်...');
        const data = await fetchMlbbData(gameId, zoneId);
        bot.deleteMessage(chatId, loadingMsg.message_id);

        if (!data) {
            return bot.sendMessage(chatId, '❌ ID သို့မဟုတ် Zone ID မှားယွင်းနေပါသည်/ API အလုပ်မလုပ်ပါ။');
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

        bot.sendMessage(chatId, replyText, {
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
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
            return bot.answerCallbackQuery(query.id, { text: '❌ Admin/Owner သသာ Copy ကူးနိုင်ပါသည်။', show_alert: true });
        }
        const copyZone = data.replace('copy_zone_', '');
        bot.answerCallbackQuery(query.id, { text: `Zone: ${copyZone}`, show_alert: false });
        bot.sendMessage(chatId, `\`${copyZone}\``, { parse_mode: 'Markdown' });
    }
});
