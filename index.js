'use strict';

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder
} = require('discord.js');

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');


// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  token: process.env.TOKEN,

  // Voice
  voiceGuildId: process.env.VOICE_GUILD_ID,
  voiceChannelId: process.env.VOICE_CHANNEL_ID,

  // Logs
  logGuildId: process.env.LOG_GUILD_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,

  // Status
  statusChannelId: process.env.STATUS_CHANNEL_ID,

  // Timers
  voiceCheckInterval:
    Number(process.env.VOICE_CHECK_INTERVAL) || 30000,

  statusUpdateInterval:
    Number(process.env.STATUS_UPDATE_INTERVAL) || 120000,

  maxReconnectAttempts:
    Number(process.env.MAX_RECONNECT_ATTEMPTS) || 5,

  reconnectDelay:
    Number(process.env.RECONNECT_DELAY) || 5000
};


// ============================================================
// VALIDATION
// ============================================================

const requiredEnv = [
  ['TOKEN', CONFIG.token],
  ['VOICE_GUILD_ID', CONFIG.voiceGuildId],
  ['VOICE_CHANNEL_ID', CONFIG.voiceChannelId],
  ['LOG_GUILD_ID', CONFIG.logGuildId],
  ['LOG_CHANNEL_ID', CONFIG.logChannelId],
  ['STATUS_CHANNEL_ID', CONFIG.statusChannelId]
];

const missing = requiredEnv
  .filter(([name, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(
    '\n❌ Missing environment variables:\n' +
    missing.map(x => `- ${x}`).join('\n') +
    '\n'
  );

  process.exit(1);
}


// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});


// ============================================================
// GLOBAL STATE
// ============================================================

let isReady = false;
let isConnecting = false;

let reconnectAttempts = 0;

let voiceCheckTimer = null;
let statusTimer = null;
let heartbeatTimer = null;

let statusMessage = null;


// ============================================================
// VOICE SESSION TIME
// ============================================================

// بداية جلسة الفويس الحالية
let voiceJoinTime = null;

// أعلى وقت وصل له البوت أثناء تشغيل البرنامج
let highestVoiceTime = 0;


// ============================================================
// BOT START TIME
// ============================================================

let startTime = Date.now();


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function truncate(text, max = 1000) {
  if (!text) {
    return 'Unknown';
  }

  text = String(text);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}


// ============================================================
// FORMAT UPTIME
// ============================================================

function formatUptime(ms) {

  if (!ms || ms < 0) {
    return '0 ثانية';
  }

  let seconds = Math.floor(ms / 1000);

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

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

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ثانية`);
  }

  return parts.join(' و ');
}


// ============================================================
// FORMAT EGYPT TIME
// ============================================================

function getEgyptDate() {

  return new Date().toLocaleString(
    'en-GB',
    {
      timeZone: 'Africa/Cairo',

      day: '2-digit',
      month: '2-digit',
      year: 'numeric',

      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',

      hour12: false
    }
  );
}


// ============================================================
// GET LOG CHANNEL
// ============================================================

async function getLogChannel() {

  try {

    const guild =
      await client.guilds.fetch(
        CONFIG.logGuildId
      );

    if (!guild) {
      console.error(
        '❌ Log Guild not found.'
      );

      return null;
    }


    const channel =
      await guild.channels.fetch(
        CONFIG.logChannelId
      );


    if (!channel) {
      console.error(
        '❌ Log Channel not found.'
      );

      return null;
    }


    if (!channel.isTextBased()) {

      console.error(
        '❌ Log Channel is not a text channel.'
      );

      return null;
    }


    return channel;

  } catch (error) {

    console.error(
      '❌ Failed to get log channel:',
      error
    );

    return null;
  }
}


// ============================================================
// GET STATUS CHANNEL
// ============================================================

async function getStatusChannel() {

  try {

    const guild =
      await client.guilds.fetch(
        CONFIG.logGuildId
      );


    if (!guild) {
      return null;
    }


    const channel =
      await guild.channels.fetch(
        CONFIG.statusChannelId
      );


    if (!channel) {
      console.error(
        '❌ Status Channel not found.'
      );

      return null;
    }


    if (!channel.isTextBased()) {

      console.error(
        '❌ Status Channel is not a text channel.'
      );

      return null;
    }


    return channel;

  } catch (error) {

    console.error(
      '❌ Failed to get status channel:',
      error
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
  color = 0x5865F2,
  fields = [],
  level = 'INFO'
}) {

  console.log(
    `[${new Date().toISOString()}] [${level}] ${title} - ${description}`
  );


  try {

    if (!client.isReady()) {
      return;
    }


    const channel =
      await getLogChannel();


    if (!channel) {
      return;
    }


    const embed =
      new EmbedBuilder()

        .setTitle(title)

        .setDescription(
          truncate(description, 4000)
        )

        .setColor(color)

        .setTimestamp()

        .setFooter({
          text:
            `𝓝𝓜𝓡 | ${getEgyptDate()}`,

          iconURL:
            'https://i.postimg.cc/qRBtmgzD/download-20260819-160352.gif'
        });


    if (fields.length > 0) {

      embed.addFields(
        fields.map(field => ({
          name:
            truncate(field.name, 256),

          value:
            truncate(field.value, 1024),

          inline:
            field.inline ?? false
        }))
      );
    }


    await channel.send({
      embeds: [embed]
    });


  } catch (error) {

    console.error(
      '❌ Failed to send log:',
      error
    );
  }
}


// ============================================================
// STARTUP LOG
// ============================================================

async function logStartup() {

  await sendLog({

    title:
      '🟢 BOT STARTED',

    description:
      'The bot has successfully started and is now monitoring the voice connection.',

    color:
      0x57F287,

    fields: [

      {
        name:
          '🤖 Bot',

        value:
          `${client.user.tag}`,

        inline:
          true
      },

      {
        name:
          '🆔 Bot ID',

        value:
          client.user.id,

        inline:
          true
      },

      {
        name:
          '🎧 Voice Channel',

        value:
          CONFIG.voiceChannelId,

        inline:
          true
      },

      {
        name:
          '🖥️ Node.js',

        value:
          process.version,

        inline:
          true
      },

      {
        name:
          '📦 Discord.js',

        value:
          require('discord.js').version,

        inline:
          true
      }

    ],

    level:
      'STARTUP'
  });
}


// ============================================================
// VOICE CONNECTED LOG
// ============================================================

async function logVoiceConnected() {

  await sendLog({

    title:
      '🎧 VOICE CONNECTED',

    description:
      'The bot is now connected to the configured voice channel.',

    color:
      0x57F287,

    fields: [

      {
        name:
          '🎙️ Channel',

        value:
          CONFIG.voiceChannelId,

        inline:
          true
      },

      {
        name:
          '🏠 Guild',

        value:
          CONFIG.voiceGuildId,

        inline:
          true
      }

    ],

    level:
      'VOICE'
  });
}


// ============================================================
// VOICE DISCONNECTED LOG
// ============================================================

async function logVoiceDisconnected(reason) {

  await sendLog({

    title:
      '🔴 VOICE DISCONNECTED',

    description:
      reason,

    color:
      0xED4245,

    level:
      'VOICE'
  });
}


// ============================================================
// RECONNECT LOG
// ============================================================

async function logReconnect(reason) {

  await sendLog({

    title:
      '🔄 VOICE RECONNECT',

    description:
      reason,

    color:
      0xFEE75C,

    fields: [

      {
        name:
          '🔢 Attempt',

        value:
          `${reconnectAttempts}/${CONFIG.maxReconnectAttempts}`,

        inline:
          true
      },

      {
        name:
          '🎧 Voice Channel',

        value:
          CONFIG.voiceChannelId,

        inline:
          true
      }

    ],

    level:
      'RECONNECT'
  });
}


// ============================================================
// ERROR LOG
// ============================================================

async function logError(title, error) {

  await sendLog({

    title:
      `🚨 ${title}`,

    description:
      error?.stack ||
      error?.message ||
      String(error),

    color:
      0xED4245,

    level:
      'ERROR'
  });
}


// ============================================================
// CONNECT TO VOICE
// ============================================================

async function connectToVoice() {

  if (!client.isReady()) {
    return false;
  }


  if (isConnecting) {
    return false;
  }


  isConnecting = true;


  try {

    const guild =
      await client.guilds.fetch(
        CONFIG.voiceGuildId
      );


    if (!guild) {

      throw new Error(
        `Voice guild ${CONFIG.voiceGuildId} not found.`
      );
    }


    const channel =
      await guild.channels.fetch(
        CONFIG.voiceChannelId
      );


    if (!channel) {

      throw new Error(
        `Voice channel ${CONFIG.voiceChannelId} not found.`
      );
    }


    if (!channel.isVoiceBased()) {

      throw new Error(
        `Channel ${CONFIG.voiceChannelId} is not a voice channel.`
      );
    }


    // --------------------------------------------------------
    // Existing connection
    // --------------------------------------------------------

    let connection =
      getVoiceConnection(
        CONFIG.voiceGuildId
      );


    if (connection) {

      const state =
        connection.state.status;


      if (
        state === VoiceConnectionStatus.Ready ||
        state === VoiceConnectionStatus.Connecting ||
        state === VoiceConnectionStatus.Signalling
      ) {

        isConnecting = false;

        return true;
      }


      try {
        connection.destroy();
      } catch {}
    }


    // --------------------------------------------------------
    // Join Voice
    // --------------------------------------------------------

    connection =
      joinVoiceChannel({

        channelId:
          channel.id,

        guildId:
          guild.id,

        adapterCreator:
          guild.voiceAdapterCreator,

        selfDeaf:
          true,

        selfMute:
          true
      });


    // --------------------------------------------------------
    // READY
    // --------------------------------------------------------

    connection.on(
      VoiceConnectionStatus.Ready,
      async () => {

        reconnectAttempts = 0;

        isConnecting = false;


        // بداية جلسة جديدة
        if (!voiceJoinTime) {

          voiceJoinTime =
            Date.now();
        }


        await logVoiceConnected();

        await updateStatusEmbed();
      }
    );


    // --------------------------------------------------------
    // DISCONNECTED
    // --------------------------------------------------------

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {

        // نحسب أعلى وقت قبل تصفير الجلسة
        if (voiceJoinTime) {

          const sessionTime =
            Date.now() - voiceJoinTime;


          if (sessionTime > highestVoiceTime) {

            highestVoiceTime =
              sessionTime;
          }
        }


        voiceJoinTime = null;


        await updateStatusEmbed();


        await logVoiceDisconnected(
          'Discord voice connection was disconnected.'
        );


        isConnecting = false;


        try {

          await entersState(
            connection,
            VoiceConnectionStatus.Signalling,
            5000
          );

        } catch {

          try {
            connection.destroy();
          } catch {}


          scheduleReconnect(
            'Voice connection could not recover automatically.'
          );
        }
      }
    );


    // --------------------------------------------------------
    // DESTROYED
    // --------------------------------------------------------

    connection.on(
      VoiceConnectionStatus.Destroyed,
      async () => {

        if (voiceJoinTime) {

          const sessionTime =
            Date.now() - voiceJoinTime;


          if (sessionTime > highestVoiceTime) {

            highestVoiceTime =
              sessionTime;
          }
        }


        voiceJoinTime = null;

        isConnecting = false;

        await updateStatusEmbed();


        scheduleReconnect(
          'Voice connection was destroyed.'
        );
      }
    );


    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    connection.on(
      'error',
      async error => {

        await logError(
          'VOICE CONNECTION ERROR',
          error
        );


        isConnecting = false;


        scheduleReconnect(
          'Voice connection emitted an error.'
        );
      }
    );


    // --------------------------------------------------------
    // WAIT FOR READY
    // --------------------------------------------------------

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      20000
    );


    reconnectAttempts = 0;

    isConnecting = false;


    if (!voiceJoinTime) {
      voiceJoinTime = Date.now();
    }


    return true;


  } catch (error) {

    isConnecting = false;


    await logError(
      'VOICE CONNECTION FAILED',
      error
    );


    scheduleReconnect(
      `Failed to connect to voice: ${error.message}`
    );


    return false;
  }
}


// ============================================================
// RECONNECT SYSTEM
// ============================================================

async function scheduleReconnect(reason) {

  if (!client.isReady()) {
    return;
  }


  if (isConnecting) {
    return;
  }


  if (
    reconnectAttempts >=
    CONFIG.maxReconnectAttempts
  ) {

    reconnectAttempts = 0;


    await sendLog({

      title:
        '⚠️ RECONNECT LIMIT',

      description:
        'Maximum reconnect attempts reached. The watchdog will continue checking the connection.',

      color:
        0xFEE75C,

      level:
        'RECONNECT'
    });


    return;
  }


  reconnectAttempts++;


  await logReconnect(
    reason
  );


  await sleep(
    CONFIG.reconnectDelay
  );


  await connectToVoice();
}


// ============================================================
// VOICE WATCHDOG
// ============================================================

async function checkVoiceConnection() {

  if (!client.isReady()) {
    return;
  }


  try {

    const connection =
      getVoiceConnection(
        CONFIG.voiceGuildId
      );


    if (!connection) {

      await sendLog({

        title:
          '⚠️ VOICE CONNECTION MISSING',

        description:
          'No voice connection exists. Reconnecting...',

        color:
          0xFEE75C,

        level:
          'WATCHDOG'
      });


      await connectToVoice();

      return;
    }


    const status =
      connection.state.status;


    if (
      status === VoiceConnectionStatus.Ready ||
      status === VoiceConnectionStatus.Connecting ||
      status === VoiceConnectionStatus.Signalling
    ) {

      return;
    }


    await sendLog({

      title:
        '⚠️ VOICE WATCHDOG',

      description:
        `Unexpected voice connection state: ${status}. Reconnecting...`,

      color:
        0xFEE75C,

      level:
        'WATCHDOG'
    });


    try {
      connection.destroy();
    } catch {}


    await connectToVoice();


  } catch (error) {

    await logError(
      'VOICE WATCHDOG ERROR',
      error
    );
  }
}


// ============================================================
// GET CURRENT VOICE TIME
// ============================================================

function getCurrentVoiceTime() {

  if (!voiceJoinTime) {
    return 0;
  }


  return Date.now() - voiceJoinTime;
}


// ============================================================
// UPDATE HIGHEST TIME
// ============================================================

function updateHighestVoiceTime() {

  const current =
    getCurrentVoiceTime();


  if (
    current > highestVoiceTime
  ) {

    highestVoiceTime =
      current;
  }
}


// ============================================================
// UPDATE STATUS EMBED
// ============================================================

async function updateStatusEmbed() {

  if (!client.isReady()) {
    return;
  }


  try {

    const channel =
      await getStatusChannel();


    if (!channel) {
      return;
    }


    const connection =
      getVoiceConnection(
        CONFIG.voiceGuildId
      );


    const isConnected =
      connection &&
      connection.state.status ===
      VoiceConnectionStatus.Ready;


    // --------------------------------------------------------
    // Time
    // --------------------------------------------------------

    updateHighestVoiceTime();


    const currentVoiceTime =
      isConnected
        ? getCurrentVoiceTime()
        : 0;


    // --------------------------------------------------------
    // Voice Name
    // --------------------------------------------------------

    let voiceName =
      'غير متصل';


    if (isConnected) {

      try {

        const guild =
          await client.guilds.fetch(
            CONFIG.voiceGuildId
          );


        const channelData =
          await guild.channels.fetch(
            CONFIG.voiceChannelId
          );


        voiceName =
          channelData?.name ||
          'Unknown Voice';


      } catch {

        voiceName =
          'Unknown Voice';
      }
    }


    // --------------------------------------------------------
    // Status
    // --------------------------------------------------------

    const statusText =
      isConnected
        ? '🟢 متصل'
        : '🔴 غير متصل';


    // --------------------------------------------------------
    // Embed
    // --------------------------------------------------------

    const embed =
      new EmbedBuilder()

        .setTitle(
          '𝓝𝓜𝓡 𝓑𝓞𝓣'
        )

        .setDescription(
          '📊 **حالة البوت ومراقبة مدة الاتصال بالفويس**'
        )

        .setColor(
          isConnected
            ? 0x57F287
            : 0xED4245
        )

        .addFields(

          {
            name:
              '📡 حالة البوت',

            value:
              `\`\`\`\n${statusText}\n\`\`\``,

            inline:
              false
          },

          {
            name:
              '🎧 اسم الفويس',

            value:
              `\`${voiceName}\``,

            inline:
              true
          },

          {
            name:
              '⏱️ وقت البوت الحالي',

            value:
              `\`${formatUptime(
                currentVoiceTime
              )}\``,

            inline:
              true
          },

          {
            name:
              '🏆 أعلى وقت قعده البوت',

            value:
              `\`${formatUptime(
                highestVoiceTime
              )}\``,

            inline:
              false
          }

        )

        .setFooter({

          text:
            `𝓝𝓜𝓡 | ${getEgyptDate()}`,

          iconURL:
            'https://i.postimg.cc/qRBtmgzD/download-20260819-160352.gif'
        })

        .setTimestamp();


    // --------------------------------------------------------
    // Edit Existing Message
    // --------------------------------------------------------

    if (statusMessage) {

      try {

        await statusMessage.edit({
          embeds: [embed]
        });

        return;

      } catch {

        statusMessage = null;
      }
    }


    // --------------------------------------------------------
    // Search Existing Status Message
    // --------------------------------------------------------

    const messages =
      await channel.messages.fetch({
        limit: 20
      });


    const oldMessage =
      messages.find(
        message =>

          message.author.id ===
            client.user.id &&

          message.embeds?.[0]?.title ===
            '𝓝𝓜𝓡 𝓑𝓞𝓣'
      );


    if (oldMessage) {

      statusMessage =
        oldMessage;


      await statusMessage.edit({
        embeds: [embed]
      });


      return;
    }


    // --------------------------------------------------------
    // Create New Status Message
    // --------------------------------------------------------

    statusMessage =
      await channel.send({
        embeds: [embed]
      });


  } catch (error) {

    console.error(
      '❌ Status update failed:',
      error
    );
  }
}


// ============================================================
// HEARTBEAT
// ============================================================

async function sendHeartbeat() {

  if (!client.isReady()) {
    return;
  }


  const connection =
    getVoiceConnection(
      CONFIG.voiceGuildId
    );


  const voiceStatus =
    connection?.state?.status ||
    'NOT_CONNECTED';


  await sendLog({

    title:
      '💓 BOT HEARTBEAT',

    description:
      'Bot is alive and monitoring the voice connection.',

    color:
      0x5865F2,

    fields: [

      {
        name:
          '⏱️ Bot Uptime',

        value:
          formatUptime(
            Date.now() - startTime
          ),

        inline:
          true
      },

      {
        name:
          '🎧 Voice Status',

        value:
          voiceStatus,

        inline:
          true
      },

      {
        name:
          '📡 Ping',

        value:
          `${client.ws.ping}ms`,

        inline:
          true
      },

      {
        name:
          '🏆 Highest Voice Time',

        value:
          formatUptime(
            highestVoiceTime
          ),

        inline:
          false
      }

    ],

    level:
      'HEARTBEAT'
  });
}


// ============================================================
// READY EVENT
// ============================================================

client.once(
  Events.ClientReady,
  async readyClient => {

    isReady = true;

    startTime =
      Date.now();


    console.log(
      '\n========================================'
    );

    console.log(
      `🟢 Logged in as ${readyClient.user.tag}`
    );

    console.log(
      `🎧 Voice Channel: ${CONFIG.voiceChannelId}`
    );

    console.log(
      `📋 Log Channel: ${CONFIG.logChannelId}`
    );

    console.log(
      `📊 Status Channel: ${CONFIG.statusChannelId}`
    );

    console.log(
      '========================================\n'
    );


    // --------------------------------------------------------
    // Startup Log
    // --------------------------------------------------------

    await logStartup();


    // --------------------------------------------------------
    // Connect Voice
    // --------------------------------------------------------

    await connectToVoice();


    // --------------------------------------------------------
    // Initial Status
    // --------------------------------------------------------

    await updateStatusEmbed();


    // --------------------------------------------------------
    // Voice Watchdog
    // --------------------------------------------------------

    voiceCheckTimer =
      setInterval(
        checkVoiceConnection,
        CONFIG.voiceCheckInterval
      );


    // --------------------------------------------------------
    // Status Update
    // --------------------------------------------------------

    statusTimer =
      setInterval(
        updateStatusEmbed,
        CONFIG.statusUpdateInterval
      );


    // --------------------------------------------------------
    // Heartbeat
    // --------------------------------------------------------

    heartbeatTimer =
      setInterval(
        sendHeartbeat,
        30 * 60 * 1000
      );
  }
);


// ============================================================
// DISCORD CLIENT ERROR
// ============================================================

client.on(
  Events.Error,
  async error => {

    console.error(
      'Discord Client Error:',
      error
    );


    await logError(
      'DISCORD CLIENT ERROR',
      error
    );
  }
);


// ============================================================
// DISCORD WARNING
// ============================================================

client.on(
  Events.Warn,
  async warning => {

    console.warn(
      'Discord Warning:',
      warning
    );


    await sendLog({

      title:
        '⚠️ DISCORD WARNING',

      description:
        warning,

      color:
        0xFEE75C,

      level:
        'WARNING'
    });
  }
);


// ============================================================
// VOICE STATE UPDATE
// ============================================================

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {

    if (!client.user) {
      return;
    }


    // نهتم بالبوت فقط
    if (
      newState.id !==
      client.user.id
    ) {
      return;
    }


    // --------------------------------------------------------
    // Bot Joined Configured Voice
    // --------------------------------------------------------

    if (
      newState.channelId ===
      CONFIG.voiceChannelId
    ) {

      if (!voiceJoinTime) {

        voiceJoinTime =
          Date.now();
      }


      updateHighestVoiceTime();

      await updateStatusEmbed();

      return;
    }


    // --------------------------------------------------------
    // Bot Left Configured Voice
    // --------------------------------------------------------

    if (
      oldState.channelId ===
        CONFIG.voiceChannelId &&

      newState.channelId !==
        CONFIG.voiceChannelId
    ) {


      // حفظ مدة الجلسة
      updateHighestVoiceTime();


      voiceJoinTime =
        null;


      await sendLog({

        title:
          '🚪 BOT LEFT VOICE',

        description:
          'The bot is no longer inside the configured voice channel. Reconnecting...',

        color:
          0xED4245,

        fields: [

          {
            name:
              'Old Channel',

            value:
              oldState.channelId ||
              'None',

            inline:
              true
          },

          {
            name:
              'New Channel',

            value:
              newState.channelId ||
              'None',

            inline:
              true
          },

          {
            name:
              '🏆 Highest Voice Time',

            value:
              formatUptime(
                highestVoiceTime
              ),

            inline:
              false
          }

        ],

        level:
          'VOICE'
      });


      await updateStatusEmbed();


      await sleep(2000);


      await connectToVoice();
    }
  }
);


// ============================================================
// UNCAUGHT EXCEPTION
// ============================================================

process.on(
  'uncaughtException',
  async error => {

    console.error(
      '🔥 UNCAUGHT EXCEPTION:',
      error
    );


    try {

      await logError(
        'UNCAUGHT EXCEPTION',
        error
      );

    } catch {}


    /*
      PM2 is responsible for restarting
      the process if Node terminates.
    */
  }
);


// ============================================================
// UNHANDLED REJECTION
// ============================================================

process.on(
  'unhandledRejection',
  async reason => {

    console.error(
      '🔥 UNHANDLED REJECTION:',
      reason
    );


    try {

      await logError(
        'UNHANDLED PROMISE REJECTION',

        reason instanceof Error
          ? reason
          : new Error(
              String(reason)
            )
      );

    } catch {}
  }
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function gracefulShutdown(signal) {

  console.log(
    `\n🛑 Received ${signal}. Shutting down...`
  );


  try {

    await sendLog({

      title:
        '🔴 BOT STOPPING',

      description:
        `The bot is shutting down because it received ${signal}.`,

      color:
        0xED4245,

      fields: [

        {
          name:
            '⏱️ Bot Uptime',

          value:
            formatUptime(
              Date.now() - startTime
            ),

          inline:
            true
        },

        {
          name:
            '🏆 Highest Voice Time',

          value:
            formatUptime(
              highestVoiceTime
            ),

          inline:
            true
        }

      ],

      level:
        'SHUTDOWN'
    });

  } catch {}


  // Stop timers

  if (voiceCheckTimer) {
    clearInterval(
      voiceCheckTimer
    );
  }


  if (statusTimer) {
    clearInterval(
      statusTimer
    );
  }


  if (heartbeatTimer) {
    clearInterval(
      heartbeatTimer
    );
  }


  // Destroy voice connection

  try {

    const connection =
      getVoiceConnection(
        CONFIG.voiceGuildId
      );


    if (connection) {
      connection.destroy();
    }

  } catch {}


  // Destroy Discord client

  try {
    client.destroy();
  } catch {}


  isReady = false;


  process.exit(0);
}


// ============================================================
// SIGNALS
// ============================================================

process.on(
  'SIGTERM',
  () => gracefulShutdown('SIGTERM')
);


process.on(
  'SIGINT',
  () => gracefulShutdown('SIGINT')
);


// ============================================================
// LOGIN
// ============================================================

console.log(
  '🚀 Starting NMR Voice Bot...'
);


client.login(
  CONFIG.token
).catch(
  async error => {

    console.error(
      '❌ Discord login failed:',
      error
    );


    /*
      PM2 will restart the process.
    */

    process.exit(1);
  }
);
