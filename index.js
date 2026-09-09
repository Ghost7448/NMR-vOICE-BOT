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
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

// ============================================================
// NMR BOT - 24/7 VOICE BOT
// Stable Reconnect + Logs + Status + Persistent Highest Time
// + /addtime + /removetime + /settime
// ============================================================

// ============================================================
// CONFIG
// ============================================================

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

// ============================================================
// DATA
// ============================================================

const DATA_FILE = path.join(__dirname, 'data.json');

let highestVoiceTime = 0;

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
        ),
        'utf8'
      );

      highestVoiceTime = 0;

      console.log('📁 تم إنشاء data.json');
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
      `🏆 أعلى وقت محفوظ: ${formatDuration(highestVoiceTime)}`
    );

  } catch (error) {
    console.error(
      '❌ Error loading data.json:',
      error
    );

    highestVoiceTime = 0;
  }
}

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

    return true;

  } catch (error) {
    console.error(
      '❌ Error saving data.json:',
      error
    );

    return false;
  }
}

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

// ============================================================
// DURATION PARSER
// ============================================================

function parseDuration(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const value = input
    .trim()
    .toLowerCase();

  // يقبل:
  // 30s
  // 10m
  // 2h
  // 3d

  const match =
    value.match(
      /^(\d+(?:\.\d+)?)(s|m|h|d)$/
    );

  if (!match) {
    return null;
  }

  const number =
    Number(match[1]);

  const unit =
    match[2];

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return null;
  }

  const units = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const milliseconds =
    number * units[unit];

  // حماية من الأرقام الضخمة جدًا
  if (
    !Number.isSafeInteger(
      Math.round(milliseconds)
    )
  ) {
    return null;
  }

  return Math.round(milliseconds);
}

// ============================================================
// VALIDATION
// ============================================================

if (!TOKEN) {
  console.error('❌ TOKEN غير موجود');
  process.exit(1);
}

if (!VOICE_GUILD_ID) {
  console.error('❌ VOICE_GUILD_ID غير موجود');
  process.exit(1);
}

if (!VOICE_CHANNEL_ID) {
  console.error('❌ VOICE_CHANNEL_ID غير موجود');
  process.exit(1);
}

if (!LOG_GUILD_ID) {
  console.error('❌ LOG_GUILD_ID غير موجود');
  process.exit(1);
}

if (!LOG_CHANNEL_ID) {
  console.error('❌ LOG_CHANNEL_ID غير موجود');
  process.exit(1);
}

if (!STATUS_CHANNEL_ID) {
  console.error('❌ STATUS_CHANNEL_ID غير موجود');
  process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Channel
  ]
});

// ============================================================
// STATE
// ============================================================

let voiceJoinTime = null;

let reconnectTimer = null;

let reconnectAttempts = 0;

let isConnecting = false;

let isReconnecting = false;

let shuttingDown = false;

let statusMessage = null;

let currentVoiceConnection = null;

// ============================================================
// FOOTER
// ============================================================

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
  embed.setFooter({
    text: `𝓝𝓜𝓡 | ${cairoDate()}`,
    iconURL: FOOTER_GIF
  });

  return embed;
}

// ============================================================
// DURATION FORMAT
// ============================================================

function formatDuration(ms) {
  if (!ms || ms <= 0) {
    return '0 ثانية';
  }

  const totalSeconds =
    Math.floor(ms / 1000);

  const days =
    Math.floor(
      totalSeconds / 86400
    );

  const hours =
    Math.floor(
      (totalSeconds % 86400) / 3600
    );

  const minutes =
    Math.floor(
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

// ============================================================
// GET LOG CHANNEL
// ============================================================

async function getLogChannel() {
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
        LOG_CHANNEL_ID
      );

    if (!channel) {
      return null;
    }

    return channel;

  } catch (error) {
    console.error(
      '❌ getLogChannel:',
      error.message
    );

    return null;
  }
}

// ============================================================
// SEND LOG
// ============================================================

async function sendLog({
  title,
  description,
  color
}) {
  try {
    const channel =
      await getLogChannel();

    if (!channel) {
      console.error(
        '❌ روم اللوجات غير موجودة أو البوت لا يستطيع الوصول إليها'
      );

      return false;
    }

    const embed =
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(
          color || 0x5865F2
        )
        .setTimestamp();

    applyFooter(embed);

    await channel.send({
      embeds: [embed]
    });

    return true;

  } catch (error) {
    console.error(
      '❌ فشل إرسال Log:',
      error
    );

    return false;
  }
}

// ============================================================
// LOG EVENTS
// ============================================================

async function logOnline() {
  await sendLog({
    title:
      '🟢 𝓝𝓜𝓡 BOT ONLINE',

    description:
      `البوت اشتغل بنجاح.\n\n` +
      `🤖 **الحالة:** متصل\n` +
      `🎙️ **الروم:** <#${VOICE_CHANNEL_ID}>\n` +
      `🕐 **الوقت:** ${cairoDate()}`,

    color: 0x57F287
  });
}

async function logDisconnected() {
  await sendLog({
    title:
      '🟡 𝓝𝓜𝓡 VOICE DISCONNECTED',

    description:
      `تم فقد الاتصال الصوتي.\n\n` +
      `🎙️ **الروم:** <#${VOICE_CHANNEL_ID}>\n` +
      `🔄 **الحالة:** جاري استعادة الاتصال`,

    color: 0xFEE75C
  });
}

async function logReconnected() {
  await sendLog({
    title:
      '🟢 𝓝𝓜𝓡 VOICE RECONNECTED',

    description:
      `تم استعادة الاتصال بالروم الصوتية بنجاح.\n\n` +
      `🎙️ **الروم:** <#${VOICE_CHANNEL_ID}>\n` +
      `🔄 **المحاولات:** ${reconnectAttempts}`,

    color: 0x57F287
  });
}

async function logLeftVoice() {
  await sendLog({
    title:
      '⚠️ 𝓝𝓜𝓡 BOT LEFT VOICE',

    description:
      `البوت لم يعد داخل الروم الصوتية المطلوبة.\n\n` +
      `🎙️ **الروم المطلوبة:** <#${VOICE_CHANNEL_ID}>\n` +
      `🔄 **الإجراء:** محاولة إعادة الدخول`,

    color: 0xFEE75C
  });
}

async function logError(error) {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);

  await sendLog({
    title:
      '🔴 𝓝𝓜𝓡 BOT ERROR',

    description:
      `حدث خطأ في البوت.\n\n` +
      `\`\`\`\n${text.slice(
        0,
        3500
      )}\n\`\`\``,

    color: 0xED4245
  });
}

// ============================================================
// TIME COMMAND LOG
// ============================================================

async function logTimeCommand({
  command,
  user,
  amount,
  oldTime,
  newTime
}) {
  await sendLog({
    title:
      '⏱️ 𝓝𝓜𝓡 TIME UPDATE',

    description:
      `تم تعديل أعلى وقت للبوت.\n\n` +
      `👤 **بواسطة:** ${user}\n` +
      `⚙️ **الأمر:** \`/${command}\`\n` +
      `⏱️ **القيمة:** \`${amount}\`\n\n` +
      `📊 **قبل:** ${formatDuration(oldTime)}\n` +
      `🏆 **بعد:** ${formatDuration(newTime)}`,

    color: 0x5865F2
  });
}

// ============================================================
// STATUS CHANNEL
// ============================================================

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
      '❌ getStatusChannel:',
      error.message
    );

    return null;
  }
}

// ============================================================
// STATUS EMBED
// ============================================================

function buildStatusEmbed() {
  const currentVoiceTime =
    voiceJoinTime
      ? Date.now() -
        voiceJoinTime
      : 0;

  updateHighestVoiceTime(
    currentVoiceTime
  );

  const embed =
    new EmbedBuilder()
      .setTitle('𝓝𝓡𝓜 𝓑𝓞𝓣')

      .setDescription(
        '```ansi\n' +
        '🟢 البوت يعمل بشكل طبيعي\n' +
        '```'
      )

      .setColor(0x57F287)

      .addFields(
        {
          name:
            '🤖 حالة البوت',

          value:
            '🟢 **متصل**',

          inline: true
        },

        {
          name:
            '🎙️ الروم الصوتية',

          value:
            `<#${VOICE_CHANNEL_ID}>`,

          inline: true
        },

        {
          name:
            '⏱️ الوقت الحالي',

          value:
            `\`${formatDuration(
              currentVoiceTime
            )}\``,

          inline: false
        },

        {
          name:
            '🏆 أعلى وقت',

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

// ============================================================
// FIND STATUS MESSAGE
// ============================================================

async function findStatusMessage(channel) {
  try {
    const messages =
      await channel.messages.fetch({
        limit: 30
      });

    return (
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
            '𝓝𝓡𝓜 𝓑𝓞𝓣'
        );
      }) || null
    );

  } catch {
    return null;
  }
}

// ============================================================
// UPDATE STATUS
// ============================================================

async function updateStatus() {
  if (
    shuttingDown ||
    !client.isReady()
  ) {
    return;
  }

  try {
    const channel =
      await getStatusChannel();

    if (!channel) {
      return;
    }

    const embed =
      buildStatusEmbed();

    if (statusMessage) {
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
      await findStatusMessage(
        channel
      );

    if (oldMessage) {
      try {
        statusMessage =
          await oldMessage.edit({
            embeds: [embed]
          });

        return;

      } catch {}
    }

    statusMessage =
      await channel.send({
        embeds: [embed]
      });

  } catch (error) {
    console.error(
      '❌ Status update error:',
      error.message
    );
  }
}

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

async function registerCommands() {
  try {
    const guild =
      await client.guilds.fetch(
        LOG_GUILD_ID
      );

    if (!guild) {
      console.error(
        '❌ لم يتم العثور على سيرفر الأوامر'
      );

      return;
    }

    const commands = [
      new SlashCommandBuilder()
        .setName('addtime')
        .setDescription(
          'إضافة وقت إلى أعلى وقت محفوظ للبوت'
        )
        .addStringOption(option =>
          option
            .setName('amount')
            .setDescription(
              'مثال: 2h أو 30m أو 1d'
            )
            .setRequired(true)
        )
        .setDefaultMemberPermissions(
          PermissionFlagsBits.Administrator
        ),

      new SlashCommandBuilder()
        .setName('removetime')
        .setDescription(
          'خصم وقت من أعلى وقت محفوظ للبوت'
        )
        .addStringOption(option =>
          option
            .setName('amount')
            .setDescription(
              'مثال: 2h أو 30m أو 1d'
            )
            .setRequired(true)
        )
        .setDefaultMemberPermissions(
          PermissionFlagsBits.Administrator
        ),

      new SlashCommandBuilder()
        .setName('settime')
        .setDescription(
          'تحديد أعلى وقت للبوت مباشرة'
        )
        .addStringOption(option =>
          option
            .setName('amount')
            .setDescription(
              'مثال: 2h أو 30m أو 1d'
            )
            .setRequired(true)
        )
        .setDefaultMemberPermissions(
          PermissionFlagsBits.Administrator
        )
    ].map(command =>
      command.toJSON()
    );

    await guild.commands.set(
      commands
    );

    console.log(
      '✅ تم تسجيل أوامر الوقت بنجاح'
    );

  } catch (error) {
    console.error(
      '❌ فشل تسجيل Slash Commands:',
      error
    );
  }
}

// ============================================================
// SLASH COMMAND HANDLER
// ============================================================

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const command =
      interaction.commandName;

    if (
      ![
        'addtime',
        'removetime',
        'settime'
      ].includes(command)
    ) {
      return;
    }

    // ========================================================
    // ADMIN CHECK
    // ========================================================

    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      await interaction.reply({
        content:
          '❌ الأمر ده متاح للـ **Administrators فقط**.',
        ephemeral: true
      });

      return;
    }

    const input =
      interaction.options.getString(
        'amount',
        true
      );

    const milliseconds =
      parseDuration(input);

    // ========================================================
    // INVALID TIME
    // ========================================================

    if (!milliseconds) {
      await interaction.reply({
        content:
          '❌ صيغة الوقت غلط.\n\n' +
          'استخدم مثلًا:\n' +
          '`30s` = 30 ثانية\n' +
          '`30m` = 30 دقيقة\n' +
          '`2h` = ساعتين\n' +
          '`3d` = 3 أيام',

        ephemeral: true
      });

      return;
    }

    const oldTime =
      highestVoiceTime;

    let newTime;

    // ========================================================
    // ADD TIME
    // ========================================================

    if (
      command ===
      'addtime'
    ) {
      newTime =
        highestVoiceTime +
        milliseconds;

      highestVoiceTime =
        newTime;

      saveData();

      await interaction.reply({
        content:
          `✅ تم إضافة **${formatDuration(
            milliseconds
          )}** إلى أعلى وقت.\n\n` +
          `🏆 **أعلى وقت الآن:** ${formatDuration(
            highestVoiceTime
          )}`,

        ephemeral: true
      });
    }

    // ========================================================
    // REMOVE TIME
    // ========================================================

    else if (
      command ===
      'removetime'
    ) {
      newTime =
        Math.max(
          0,
          highestVoiceTime -
            milliseconds
        );

      highestVoiceTime =
        newTime;

      saveData();

      await interaction.reply({
        content:
          `✅ تم خصم **${formatDuration(
            milliseconds
          )}** من أعلى وقت.\n\n` +
          `🏆 **أعلى وقت الآن:** ${formatDuration(
            highestVoiceTime
          )}`,

        ephemeral: true
      });
    }

    // ========================================================
    // SET TIME
    // ========================================================

    else if (
      command ===
      'settime'
    ) {
      newTime =
        milliseconds;

      highestVoiceTime =
        newTime;

      saveData();

      await interaction.reply({
        content:
          `✅ تم تحديد أعلى وقت يدويًا.\n\n` +
          `🏆 **أعلى وقت الآن:** ${formatDuration(
            highestVoiceTime
          )}`,

        ephemeral: true
      });
    }

    // ========================================================
    // UPDATE STATUS IMMEDIATELY
    // ========================================================

    await updateStatus();

    // ========================================================
    // LOG
    // ========================================================

    await logTimeCommand({
      command,
      user:
        `${interaction.user.tag} (<@${interaction.user.id}>)`,
      amount: input,
      oldTime,
      newTime
    });
  }
);

// ============================================================
// DESTROY CURRENT CONNECTION
// ============================================================

function destroyCurrentConnection() {
  try {
    const connection =
      getVoiceConnection(
        VOICE_GUILD_ID
      );

    if (connection) {
      connection.destroy();
    }
  } catch {}
}

// ============================================================
// CREATE VOICE CONNECTION
// ============================================================

async function createVoiceConnection() {
  if (
    shuttingDown ||
    isConnecting
  ) {
    return null;
  }

  isConnecting = true;

  try {
    const guild =
      await client.guilds.fetch(
        VOICE_GUILD_ID
      );

    const channel =
      await guild.channels.fetch(
        VOICE_CHANNEL_ID
      );

    if (!channel) {
      throw new Error(
        'Voice channel not found'
      );
    }

    console.log(
      `🎙️ Connecting → ${channel.name}`
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

    currentVoiceConnection =
      connection;

    // ========================================================
    // DISCONNECTED
    // ========================================================

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        if (shuttingDown) {
          return;
        }

        console.log(
          '🟡 Voice DISCONNECTED'
        );

        await logDisconnected();

        try {
          await entersState(
            connection,
            VoiceConnectionStatus.Connecting,
            5000
          );

          await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            15000
          );

          console.log(
            '🟢 Voice connection recovered'
          );

          reconnectAttempts = 0;

          await logReconnected();

          return;

        } catch {
          console.log(
            '⚠️ فشل استرجاع الاتصال الحالي'
          );

          scheduleReconnect();
        }
      }
    );

    // ========================================================
    // DESTROYED
    // ========================================================

    connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        if (shuttingDown) {
          return;
        }

        console.log(
          '🔴 Voice connection destroyed'
        );

        scheduleReconnect();
      }
    );

    // ========================================================
    // ERROR
    // ========================================================

    connection.on(
      'error',
      error => {
        console.error(
          '❌ Voice Error:',
          error
        );

        logError(error).catch(
          () => {}
        );
      }
    );

    // ========================================================
    // READY
    // ========================================================

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30000
    );

    currentVoiceConnection =
      connection;

    voiceJoinTime =
      Date.now();

    reconnectAttempts = 0;

    console.log(
      '🟢 Voice connection READY'
    );

    return connection;

  } catch (error) {
    console.error(
      '❌ Voice connection failed:',
      error.message
    );

    await logError(error);

    scheduleReconnect();

    return null;

  } finally {
    isConnecting = false;
  }
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {
  if (
    shuttingDown ||
    reconnectTimer ||
    isReconnecting
  ) {
    return;
  }

  isReconnecting = true;

  reconnectAttempts++;

  const attempt =
    reconnectAttempts;

  console.log(
    `🔄 Reconnect scheduled: ${attempt}/${MAX_RECONNECT_ATTEMPTS}`
  );

  reconnectTimer =
    setTimeout(
      async () => {
        reconnectTimer = null;

        if (shuttingDown) {
          isReconnecting = false;
          return;
        }

        try {
          const guild =
            await client.guilds.fetch(
              VOICE_GUILD_ID
            );

          const member =
            await guild.members.fetch(
              client.user.id
            );

          if (
            member.voice.channelId ===
            VOICE_CHANNEL_ID
          ) {
            console.log(
              '✅ البوت بالفعل داخل الروم - إلغاء reconnect'
            );

            reconnectAttempts = 0;
            isReconnecting = false;

            return;
          }

          destroyCurrentConnection();

          await createVoiceConnection();

          const updatedMember =
            await guild.members.fetch(
              client.user.id
            );

          if (
            updatedMember.voice.channelId ===
            VOICE_CHANNEL_ID
          ) {
            await logReconnected();

            reconnectAttempts = 0;
          }

        } catch (error) {
          console.error(
            '❌ Reconnect error:',
            error.message
          );

          if (
            reconnectAttempts <
            MAX_RECONNECT_ATTEMPTS
          ) {
            isReconnecting = false;

            scheduleReconnect();

            return;
          }

          console.log(
            '⚠️ إعادة المحاولات من البداية...'
          );

          reconnectAttempts = 0;
        }

        isReconnecting = false;

      },
      RECONNECT_DELAY
    );
}

// ============================================================
// WATCHDOG
// ============================================================

async function voiceWatchdog() {
  if (
    shuttingDown ||
    !client.isReady() ||
    isConnecting ||
    isReconnecting
  ) {
    return;
  }

  try {
    const guild =
      await client.guilds.fetch(
        VOICE_GUILD_ID
      );

    const member =
      await guild.members.fetch(
        client.user.id
      );

    const channelId =
      member.voice.channelId;

    if (
      channelId ===
      VOICE_CHANNEL_ID
    ) {
      return;
    }

    console.log(
      '⚠️ Watchdog: البوت مش داخل الروم المطلوبة'
    );

    await logLeftVoice();

    scheduleReconnect();

  } catch (error) {
    console.error(
      '❌ Watchdog error:',
      error.message
    );
  }
}

// ============================================================
// VOICE STATE UPDATE
// ============================================================

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
      oldChannel ===
        VOICE_CHANNEL_ID &&
      newChannel !==
        VOICE_CHANNEL_ID
    ) {
      console.log(
        '⚠️ VoiceState: البوت خرج من الروم'
      );

      await logLeftVoice();

      scheduleReconnect();
    }
  }
);

// ============================================================
// READY
// ============================================================

client.once(
  Events.ClientReady,
  async readyClient => {
    console.log(
      '=========================================='
    );

    console.log(
      `🤖 Logged in as ${readyClient.user.tag}`
    );

    console.log(
      `🆔 ${readyClient.user.id}`
    );

    console.log(
      '=========================================='
    );

    // تسجيل الأوامر
    await registerCommands();

    // Log Online
    await logOnline();

    // دخول الفويس
    await createVoiceConnection();

    // تحديث Status
    await updateStatus();
  }
);

// ============================================================
// STATUS UPDATE
// ============================================================

setInterval(
  async () => {
    if (
      client.isReady()
    ) {
      await updateStatus();
    }
  },
  STATUS_UPDATE_INTERVAL
);

// ============================================================
// VOICE WATCHDOG
// ============================================================

setInterval(
  async () => {
    if (
      client.isReady()
    ) {
      await voiceWatchdog();
    }
  },
  VOICE_CHECK_INTERVAL
);

// ============================================================
// SAVE HIGHEST TIME EVERY MINUTE
// ============================================================

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

// ============================================================
// HEARTBEAT
// ============================================================

setInterval(
  () => {
    if (
      client.isReady()
    ) {
      console.log(
        `💓 Heartbeat | ${cairoDate()}`
      );
    }
  },
  30 * 60 * 1000
);

// ============================================================
// UNCAUGHT EXCEPTION
// ============================================================

process.on(
  'uncaughtException',
  async error => {
    console.error(
      '💥 UNCAUGHT EXCEPTION:',
      error
    );

    try {
      await logError(error);
    } catch {}

    saveData();

    process.exit(1);
  }
);

// ============================================================
// UNHANDLED REJECTION
// ============================================================

process.on(
  'unhandledRejection',
  async reason => {
    console.error(
      '💥 UNHANDLED REJECTION:',
      reason
    );

    try {
      await logError(reason);
    } catch {}
  }
);

// ============================================================
// SHUTDOWN
// ============================================================

async function gracefulShutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `🛑 ${signal} received`
  );

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
      `🏆 **أعلى وقت:** ${formatDuration(
        highestVoiceTime
      )}`,

    color: 0xED4245
  });

  try {
    if (reconnectTimer) {
      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }
  } catch {}

  try {
    destroyCurrentConnection();
  } catch {}

  saveData();

  try {
    client.destroy();
  } catch {}

  process.exit(0);
}

process.on(
  'SIGINT',
  () =>
    gracefulShutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () =>
    gracefulShutdown('SIGTERM')
);

// ============================================================
// START
// ============================================================

loadData();

client.login(TOKEN);
