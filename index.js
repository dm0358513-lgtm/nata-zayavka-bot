const { Telegraf, Markup } = require('telegraf');
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
  {
    key: 'route',
    text:
      'Откуда забираем груз и куда доставляем? Укажите город/страну отправления и город назначения в России. ' +
      'Если знаете условия поставки (Incoterms, например FCA/EXW/CIF) — укажите тоже.',
  },
  {
    key: 'hs_sanctions',
    text:
      'Код ТН ВЭД груза (если знаете) и подтвердите — груз санкционный или нет?\n' +
      'Пример: «84369900, не санкционный». Если код не знаете — напишите «не знаю».',
  },
  {
    key: 'delivery_type',
    text: 'Каким видом доставки планируете везти груз?',
    options: ['Море', 'Море + ЖД', 'ЖД', 'Авиа'],
  },
  {
    key: 'consolidation',
    text: 'Как отправляем: сборным грузом (вместе с другими) или отдельным контейнером? Если морем не едем — выберите «Не важно».',
    options: ['Сборный груз', 'Отдельный контейнер', 'Не важно'],
  },
  { key: 'cargo', text: 'Что за груз? (категория товара, хрупкий или нет)' },
  {
    key: 'places',
    text:
      'Сколько мест груза, в какой упаковке и какого размера? Укажите количество и тип (палеты, бухты, ящики), ' +
      'размеры одного места (Д×Ш×В, см) и вес, если знаете.\n' +
      'Пример: 7 палет 115×115×240 см + 2 бухты.',
  },
  { key: 'timing', text: 'Когда груз будет готов к отправке?' },
  { key: 'customs_experience', text: 'Был ли уже опыт растаможки этого товара? (да / нет / не уверен)' },
];

function questionKeyboard(question) {
  if (!question.options) return Markup.removeKeyboard();
  return Markup.keyboard(question.options, { columns: 2 })
    .resize()
    .oneTime();
}

async function askQuestion(ctx, question) {
  await ctx.reply(question.text, questionKeyboard(question));
}

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
    `ТН ВЭД / санкционность: ${answers.hs_sanctions}\n` +
    `Вид доставки: ${answers.delivery_type}\n` +
    `Способ отправки: ${answers.consolidation}\n` +
    `Груз: ${answers.cargo}\n` +
    `Места и размеры: ${answers.places}\n` +
    `Сроки: ${answers.timing}\n` +
    `Опыт растаможки: ${answers.customs_experience}\n\n` +
    `Контакт: ${from.username ? '@' + from.username : from.first_name} (id: ${from.id})`
  );
}

bot.start(async (ctx) => {
  startSession(ctx.chat.id);
  await ctx.reply(
    'Здравствуйте! Помогу оформить заявку на расчёт доставки груза — отвечу на несколько коротких вопросов.'
  );
  await askQuestion(ctx, QUESTIONS[0]);
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
    await ctx.reply('Начнём с заявки на расчёт доставки.');
    await askQuestion(ctx, QUESTIONS[0]);
    return;
  }

  const currentQuestion = QUESTIONS[session.step];

  if (currentQuestion.options) {
    const match = currentQuestion.options.find(
      (opt) => opt.toLowerCase() === text.toLowerCase()
    );
    if (!match) {
      await ctx.reply('Пожалуйста, выберите один из вариантов на клавиатуре ниже.');
      await askQuestion(ctx, currentQuestion);
      return;
    }
    session.answers[currentQuestion.key] = match;
  } else {
    session.answers[currentQuestion.key] = text;
  }
  session.step += 1;

  if (session.step < QUESTIONS.length) {
    await askQuestion(ctx, QUESTIONS[session.step]);
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
    'Спасибо! Заявка записана:\n\n' + summary + '\n\nОтветим в течение дня.',
    Markup.removeKeyboard()
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
