const path = require('path');
const fs = require('fs');

require('dotenv').config({
  path: path.join(__dirname, '.env')
});

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  AuditLogEvent,
  PermissionsBitField
} = require('discord.js');

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

// ============================================================
// NMR BOT - 24/7 VOICE + LOGS + STATUS
// ============================================================

// =========================
// CONFIG
// =========================

const TOKEN = process.env.TOKEN;

const VOICE_GUILD_ID = process.env.VOICE_GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

const LOG_GUILD_ID = process.env.LOG_GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;

const VOICE_CHECK_INTERVAL =
  Number(process.env.VOICE_CHECK_INTERVAL) || 30000;

const STATUS_UPDATE_INTERVAL =
  Number(process.env.STATUS_UPDATE_INTERVAL) || 120000;

const MAX_RECONNECT_ATTEMPTS =
  Number(process.env.MAX_RECONNECT_ATTEMPTS) || 5;

const RECONNECT_DELAY =
  Number(process.env.RECONNECT_DELAY) || 5000;

// =========================
// DATA FILE
// =========================

const DATA_FILE = path.join(__dirname, 'data.json');

let highestVoiceTime = 0;

// تحميل أعلى وقت محفوظ
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          {
            highestVoiceTime: 0
          },
          null,
          2
        )
      );

      highestVoiceTime = 0;
      return;
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8');

    if (!raw.trim()) {
      highestVoiceTime = 0;
      return;
    }

    const data = JSON.parse(raw);

    highestVoiceTime =
      Number(data.highestVoiceTime) || 0;

    console.log(
      `💾 أعلى وقت محفوظ: ${formatDuration(highestVoiceTime)}`
    );

  } catch (error) {
    console.error(
      '❌ فشل تحميل data.json:',
      error
    );

    highestVoiceTime = 0;
  }
}

// حفظ أعلى وقت
function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          highestVoiceTime
        },
        null,
        2
      ),
      'utf8'
    );

  } catch (error) {
    console.error(
      '❌ فشل حفظ data.json:',
      error
    );
  }
}

// تحديث الرقم القياسي
function updateHighestVoiceTime(currentTime) {
  if (
    Number.isFinite(currentTime) &&
    currentTime > highestVoiceTime
  ) {
    highestVoiceTime = currentTime;

    saveData();

    console.log(
      `🏆 رقم قياسي جديد: ${formatDuration(highestVoiceTime)}`
    );

    return true;
  }

  return false;
}

// =========================
// VALIDATION
// =========================

if (!TOKEN) {
  console.error('❌ TOKEN غير موجود في .env');
  process.exit(1);
}

if (!VOICE_GUILD_ID) {
  console.error('❌ VOICE_GUILD_ID غير موجود في .env');
  process.exit(1);
}

if (!VOICE_CHANNEL_ID) {
  console.error('❌ VOICE_CHANNEL_ID غير موجود في .env');
  process.exit(1);
}

if (!LOG_GUILD_ID) {
  console.error('❌ LOG_GUILD_ID غير موجود في .env');
  process.exit(1);
}

if (!LOG_CHANNEL_ID) {
  console.error('❌ LOG_CHANNEL_ID غير موجود في .env');
  process.exit(1);
}

if (!STATUS_CHANNEL_ID) {
  console.error('❌ STATUS_CHANNEL_ID غير موجود في .env');
  process.exit(1);
}

// =========================
// CLIENT
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Channel
  ]
});

// =========================
// VARIABLES
// =========================

let voiceJoinTime = null;
let reconnectAttempts = 0;
let reconnectTimer = null;

let statusMessage = null;

let shuttingDown = false;

// منع إنشاء أكثر من اتصال في نفس الوقت
let isConnecting = false;

// =========================
// FOOTER
// =========================

const FOOTER_GIF =
  'https://i.postimg.cc/qRBtmgzD/download-20260819-160352.gif';

function cairoDate() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function applyFooter(embed) {
  return embed.setFooter({
    text: `𝓝𝓜𝓡 | ${cairoDate()}`,
    iconURL: FOOTER_GIF
  });
}

// =========================
// FORMAT DURATION
// =========================

function formatDuration(ms) {
  if (!ms || ms < 0) {
    return '0 ثانية';
  }

  const totalSeconds = Math.floor(ms / 1000);

  const days = Math.floor(
    totalSeconds / 86400
  );

  const hours = Math.floor(
    (totalSeconds % 86400) / 3600
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );

  const seconds =
    totalSeconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days} يوم`);
  }

  if (hours > 0) {
    parts.push(`${hours} ساعة`);
  }

  if (minutes > 0) {
    parts.push(`${minutes} دقيقة`);
  }

  if (
    seconds > 0 ||
    parts.length === 0
  ) {
    parts.push(`${seconds} ثانية`);
  }

  return parts.join(' و ');
}

// =========================
// GET LOG CHANNEL
// =========================

async function getLogChannel() {
  try {
    const guild =
      await client.guilds.fetch(
        LOG_GUILD_ID
      );

    if (!guild) {
      console.error(
        '❌ لم يتم العثور على LOG_GUILD_ID'
      );

      return null;
    }

    const channel =
      await guild.channels.fetch(
        LOG_CHANNEL_ID
      );

    if (!channel) {
      console.error(
        '❌ لم يتم العثور على LOG_CHANNEL_ID'
      );

      return null;
    }

    return channel;

  } catch (error) {
    console.error(
      '❌ خطأ في الحصول على روم اللوجات:',
      error
    );

    return null;
  }
}

// =========================
// SEND LOG
// =========================

async function sendLog({
  title,
  description,
  color = 0x5865F2
}) {
  try {
    const channel =
      await getLogChannel();

    if (!channel) {
      return false;
    }

    const embed =
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

    applyFooter(embed);

    await channel.send({
      embeds: [embed]
    });

    return true;

  } catch (error) {
    console.error(
      '❌ فشل إرسال اللوج:',
      error
    );

    return false;
  }
}

// =========================
// START LOG
// =========================

async function sendStartupLog() {
  await sendLog({
    title: '🟢 𝓝𝓜𝓡 BOT ONLINE',
    description:
      `البوت اشتغل بنجاح.\n\n` +
      `🤖 **الحالة:** متصل\n` +
      `🎙️ **Voice:** ${VOICE_CHANNEL_ID}\n` +
      `🕐 **الوقت:** ${cairoDate()}`,
    color: 0x57F287
  });
}

// =========================
// RESTART LOG
// =========================

async function sendReconnectLog() {
  await sendLog({
    title: '🔄 𝓝𝓜𝓡 BOT RECONNECT',
    description:
      `تم إعادة اتصال البوت بالروم الصوتية.\n\n` +
      `🤖 **الحالة:** متصل\n` +
      `🎙️ **Voice Channel:** ${VOICE_CHANNEL_ID}\n` +
      `🔁 **المحاولة:** ${reconnectAttempts}`,
    color: 0xFEE75C
  });
}

// =========================
// ERROR LOG
// =========================

async function sendErrorLog(error) {
  await sendLog({
    title: '🔴 𝓝𝓜𝓡 BOT ERROR',
    description:
      `حدث خطأ في البوت.\n\n` +
      `\`\`\`\n${String(error).slice(
        0,
        3500
      )}\n\`\`\``,
    color: 0xED4245
  });
}

// =========================
// STATUS CHANNEL
// =========================

async function getStatusChannel() {
  try {
    const guild =
      await client.guilds.fetch(
        LOG_GUILD_ID
      );

    if (!guild) {
      return null;
    }

    const channel =
      await guild.channels.fetch(
        STATUS_CHANNEL_ID
      );

    return channel || null;

  } catch (error) {
    console.error(
      '❌ خطأ في الحصول على روم الحالة:',
      error
    );

    return null;
  }
}

// =========================
// BUILD STATUS EMBED
// =========================

function buildStatusEmbed() {
  const now =
    Date.now();

  const currentVoiceTime =
    voiceJoinTime
      ? now - voiceJoinTime
      : 0;

  // تحديث أعلى وقت قبل بناء الـEmbed
  updateHighestVoiceTime(
    currentVoiceTime
  );

  const embed =
    new EmbedBuilder()
      .setTitle('𝓝𝓜𝓡 𝓑𝓞𝓣')
      .setDescription(
        '```ansi\n' +
        '🟢 Connected\n' +
        '```'
      )
      .setColor(0x57F287)
      .addFields(
        {
          name: '🤖 حالة البوت',
          value: '🟢 **متصل**',
          inline: true
        },
        {
          name: '🎙️ الروم الصوتية',
          value: `<#${VOICE_CHANNEL_ID}>`,
          inline: true
        },
        {
          name: '⏱️ الوقت الحالي',
          value:
            `\`${formatDuration(
              currentVoiceTime
            )}\``,
          inline: false
        },
        {
          name: '🏆 أعلى وقت للبوت',
          value:
            `\`${formatDuration(
              highestVoiceTime
            )}\``,
          inline: false
        }
      )
      .setTimestamp();

  applyFooter(embed);

  return embed;
}

// =========================
// FIND OLD STATUS MESSAGE
// =========================

async function findOldStatusMessage(
  channel
) {
  try {
    const messages =
      await channel.messages.fetch({
        limit: 20
      });

    const oldMessage =
      messages.find(message => {
        if (
          message.author.id !==
          client.user.id
        ) {
          return false;
        }

        return message.embeds.some(
          embed =>
            embed.title ===
            '𝓝𝓜𝓡 𝓑𝓞𝓣'
        );
      });

    return oldMessage || null;

  } catch (error) {
    console.error(
      '❌ فشل البحث عن رسالة الحالة:',
      error
    );

    return null;
  }
}

// =========================
// UPDATE STATUS
// =========================

async function updateStatus() {
  try {
    const channel =
      await getStatusChannel();

    if (!channel) {
      console.error(
        '❌ STATUS_CHANNEL_ID غير موجود أو غير متاح'
      );

      return;
    }

    const embed =
      buildStatusEmbed();

    if (
      statusMessage &&
      statusMessage.id
    ) {
      try {
        statusMessage =
          await statusMessage.edit({
            embeds: [embed]
          });

        return;

      } catch {
        statusMessage = null;
      }
    }

    const oldMessage =
      await findOldStatusMessage(
        channel
      );

    if (oldMessage) {
      try {
        statusMessage =
          await oldMessage.edit({
            embeds: [embed]
          });

        return;

      } catch {
        statusMessage = null;
      }
    }

    statusMessage =
      await channel.send({
        embeds: [embed]
      });

  } catch (error) {
    console.error(
      '❌ فشل تحديث Status:',
      error
    );
  }
}

// =========================
// CONNECT TO VOICE
// =========================

async function connectToVoice() {
  if (shuttingDown) {
    return;
  }

  if (isConnecting) {
    return;
  }

  isConnecting = true;

  try {
    const guild =
      await client.guilds.fetch(
        VOICE_GUILD_ID
      );

    if (!guild) {
      throw new Error(
        'Voice Guild not found'
      );
    }

    const channel =
      await guild.channels.fetch(
        VOICE_CHANNEL_ID
      );

    if (!channel) {
      throw new Error(
        'Voice Channel not found'
      );
    }

    const existingConnection =
      getVoiceConnection(
        VOICE_GUILD_ID
      );

    if (existingConnection) {
      try {
        existingConnection.destroy();
      } catch {}
    }

    console.log(
      `🎙️ Connecting to: ${channel.name}`
    );

    const connection =
      joinVoiceChannel({
        channelId:
          VOICE_CHANNEL_ID,
        guildId:
          VOICE_GUILD_ID,
        adapterCreator:
          guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
      });

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30000
    );

    // بداية جلسة جديدة
    voiceJoinTime =
      Date.now();

    reconnectAttempts = 0;

    console.log(
      `✅ Connected to ${channel.name}`
    );

    await sendReconnectLog();

    await updateStatus();

    // Ready
    connection.on(
      VoiceConnectionStatus.Ready,
      () => {
        console.log(
          '🟢 Voice connection READY'
        );
      }
    );

    // Disconnected
    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        if (shuttingDown) {
          return;
        }

        console.log(
          '🟡 Voice connection DISCONNECTED'
        );

        await sendLog({
          title:
            '🟡 𝓝𝓜𝓡 VOICE DISCONNECTED',
          description:
            `البوت فقد الاتصال بالروم الصوتية.\n\n` +
            `🔄 جاري محاولة إعادة الاتصال...`,
          color: 0xFEE75C
        });

        scheduleReconnect();
      }
    );

    // Destroyed
    connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        if (shuttingDown) {
          return;
        }

        console.log(
          '🔴 Voice connection DESTROYED'
        );

        scheduleReconnect();
      }
    );

    connection.on(
      'error',
      async error => {
        console.error(
          '❌ Voice error:',
          error
        );

        await sendErrorLog(
          error
        );
      }
    );

  } catch (error) {
    console.error(
      '❌ Voice connection failed:',
      error
    );

    await sendErrorLog(error);

    scheduleReconnect();

  } finally {
    isConnecting = false;
  }
}

// =========================
// RECONNECT
// =========================

function scheduleReconnect() {
  if (shuttingDown) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  if (
    reconnectAttempts >=
    MAX_RECONNECT_ATTEMPTS
  ) {
    console.error(
      '❌ تم الوصول للحد الأقصى لمحاولات الاتصال'
    );

    reconnectAttempts = 0;
  }

  reconnectAttempts++;

  console.log(
    `🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`
  );

  reconnectTimer =
    setTimeout(async () => {
      reconnectTimer = null;

      await connectToVoice();
    }, RECONNECT_DELAY);
}

// =========================
// VOICE WATCHDOG
// =========================

async function voiceWatchdog() {
  if (shuttingDown) {
    return;
  }

  try {
    const guild =
      await client.guilds.fetch(
        VOICE_GUILD_ID
      );

    if (!guild) {
      return;
    }

    const me =
      await guild.members.fetch(
        client.user.id
      );

    const voiceChannel =
      me.voice.channel;

    // البوت مش داخل الروم المطلوبة
    if (
      !voiceChannel ||
      voiceChannel.id !==
        VOICE_CHANNEL_ID
    ) {
      console.log(
        '⚠️ البوت مش داخل الروم المطلوبة - جاري الاتصال...'
      );

      await connectToVoice();
    }

  } catch (error) {
    console.error(
      '❌ Watchdog error:',
      error
    );
  }
}

// =========================
// VOICE STATE UPDATE
// =========================

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {
    if (
      !client.user ||
      oldState.id !==
        client.user.id
    ) {
      return;
    }

    if (shuttingDown) {
      return;
    }

    const oldChannel =
      oldState.channelId;

    const newChannel =
      newState.channelId;

    if (
      oldChannel !==
        VOICE_CHANNEL_ID ||
      newChannel !==
        VOICE_CHANNEL_ID
    ) {
      if (
        newChannel !==
        VOICE_CHANNEL_ID
      ) {
        console.log(
          '⚠️ البوت خرج من الروم الصوتية'
        );

        await sendLog({
          title:
            '⚠️ 𝓝𝓜𝓡 BOT LEFT VOICE',
          description:
            `البوت خرج من الروم الصوتية.\n\n` +
            `🔄 جاري إعادته تلقائيًا...`,
          color: 0xFEE75C
        });

        scheduleReconnect();
      }
    }
  }
);

// =========================
// READY
// =========================

client.once(
  Events.ClientReady,
  async readyClient => {
    console.log(
      '============================================'
    );

    console.log(
      `🤖 Logged in as ${readyClient.user.tag}`
    );

    console.log(
      `🆔 ${readyClient.user.id}`
    );

    console.log(
      '============================================'
    );

    await sendStartupLog();

    await connectToVoice();

    await updateStatus();
  }
);

// =========================
// STATUS INTERVAL
// =========================

setInterval(
  async () => {
    if (
      !client.isReady()
    ) {
      return;
    }

    await updateStatus();

  },
  STATUS_UPDATE_INTERVAL
);

// =========================
// VOICE CHECK INTERVAL
// =========================

setInterval(
  async () => {
    if (
      !client.isReady()
    ) {
      return;
    }

    await voiceWatchdog();

  },
  VOICE_CHECK_INTERVAL
);

// =========================
// SAVE TIME PERIODICALLY
// =========================

// حفظ الرقم القياسي كل دقيقة
// كحماية إضافية في حالة إغلاق مفاجئ
setInterval(
  () => {
    if (
      voiceJoinTime
    ) {
      const currentTime =
        Date.now() -
        voiceJoinTime;

      updateHighestVoiceTime(
        currentTime
      );
    }
  },
  60000
);

// =========================
// HEARTBEAT
// =========================

setInterval(
  async () => {
    if (
      !client.isReady()
    ) {
      return;
    }

    console.log(
      `💓 Heartbeat | ${cairoDate()}`
    );

  },
  30 * 60 * 1000
);

// =========================
// UNCAUGHT EXCEPTION
// =========================

process.on(
  'uncaughtException',
  async error => {
    console.error(
      '💥 UNCAUGHT EXCEPTION:',
      error
    );

    try {
      await sendErrorLog(error);
    } catch {}

    // مهم:
    // نخلي PM2 يعيد تشغيل البوت
    process.exit(1);
  }
);

// =========================
// UNHANDLED REJECTION
// =========================

process.on(
  'unhandledRejection',
  async reason => {
    console.error(
      '💥 UNHANDLED REJECTION:',
      reason
    );

    try {
      await sendErrorLog(reason);
    } catch {}
  }
);

// =========================
// GRACEFUL SHUTDOWN
// =========================

async function gracefulShutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `🛑 Received ${signal}`
  );

  // حفظ أعلى وقت قبل الإغلاق
  if (voiceJoinTime) {
    const currentTime =
      Date.now() -
      voiceJoinTime;

    updateHighestVoiceTime(
      currentTime
    );
  }

  await sendLog({
    title:
      '🛑 𝓝𝓜𝓡 BOT SHUTDOWN',
    description:
      `البوت يتم إيقافه الآن.\n\n` +
      `📡 **Signal:** ${signal}\n` +
      `🕐 **الوقت:** ${cairoDate()}\n` +
      `🏆 **أعلى وقت محفوظ:** ${formatDuration(
        highestVoiceTime
      )}`,
    color: 0xED4245
  });

  try {
    const connection =
      getVoiceConnection(
        VOICE_GUILD_ID
      );

    if (connection) {
      connection.destroy();
    }
  } catch {}

  try {
    client.destroy();
  } catch {}

  saveData();

  process.exit(0);
}

process.on(
  'SIGINT',
  () =>
    gracefulShutdown(
      'SIGINT'
    )
);

process.on
  'SIGTERM',
  () =>
    gracefulShutdown(
      'SIGTERM'
    );

// =========================
// LOAD DATA
// =========================

loadData();

// =========================
// LOGIN
// =========================

client.login(TOKEN);
