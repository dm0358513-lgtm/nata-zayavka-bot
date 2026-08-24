const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // chat_id Натальи, куда слать готовые заявки

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не задан');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const QUESTIONS = [
  { key: 'route', text: 'Откуда и куда везём груз? (страна/город отправления и назначения)' },
  { key: 'cargo', text: 'Что за груз? (категория товара, хрупкий или нет)' },
  { key: 'volume', text: 'Примерный объём или вес? (кубы или кг)' },
  { key: 'timing', text: 'Когда груз будет готов к отправке?' },
  { key: 'customs_experience', text: 'Был ли уже опыт растаможки этого товара? (да / нет / не уверен)' },
];

const sessions = new Map();

function startSession(chatId) {
  sessions.set(chatId, { step: 0, answers: {} });
}

function leadsFilePath() {
  return path.join(__dirname, 'leads.json');
}

function saveLead(lead) {
  const file = leadsFilePath();
  let leads = [];
  if (fs.existsSync(file)) {
    try {
      leads = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      leads = [];
    }
  }
  leads.push(lead);
  fs.writeFileSync(file, JSON.stringify(leads, null, 2), 'utf8');
}

function formatLead(from, answers) {
  return (
    `<b>Новая заявка на расчёт логистики</b>\n\n` +
    `Откуда/куда: ${answers.route}\n` +
    `Груз: ${answers.cargo}\n` +
    `Объём/вес: ${answers.volume}\n` +
    `Сроки: ${answers.timing}\n` +
    `Опыт растаможки: ${answers.customs_experience}\n\n` +
    `Контакт: ${from.username ? '@' + from.username : from.first_name} (id: ${from.id})`
  );
}

bot.start((ctx) => {
  startSession(ctx.chat.id);
  ctx.reply(
    'Здравствуйте! Помогу оформить заявку на расчёт доставки груза — отвечу на несколько коротких вопросов.\n\n' +
      QUESTIONS[0].text
  );
});

bot.command('cancel', (ctx) => {
  sessions.delete(ctx.chat.id);
  ctx.reply('Заявка отменена. Если захотите начать заново — напишите /start.');
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) return;

  let session = sessions.get(chatId);
  if (!session) {
    startSession(chatId);
    session = sessions.get(chatId);
    await ctx.reply(
      'Начнём с заявки на расчёт доставки.\n\n' + QUESTIONS[0].text
    );
    return;
  }

  const currentQuestion = QUESTIONS[session.step];
  session.answers[currentQuestion.key] = text;
  session.step += 1;

  if (session.step < QUESTIONS.length) {
    await ctx.reply(QUESTIONS[session.step].text);
    return;
  }

  const lead = {
    date: new Date().toISOString(),
    from: {
      id: ctx.from.id,
      username: ctx.from.username || null,
      first_name: ctx.from.first_name || null,
    },
    answers: session.answers,
  };
  saveLead(lead);
  sessions.delete(chatId);

  const summary = formatLead(ctx.from, session.answers);

  await ctx.replyWithHTML(
    'Спасибо! Заявка записана:\n\n' + summary + '\n\nОтветим в течение дня.'
  );

  if (ADMIN_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(ADMIN_CHAT_ID, summary, { parse_mode: 'HTML' });
    } catch (e) {
      console.error('Не удалось отправить заявку админу:', e.message);
    }
  }
});

bot.launch();
console.log('Бот запущен');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
