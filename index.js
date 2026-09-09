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

  voiceGuildId: process.env.VOICE_GUILD_ID,
  voiceChannelId: process.env.VOICE_CHANNEL_ID,

  logGuildId: process.env.LOG_GUILD_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,

  voiceCheckInterval:
    Number(process.env.VOICE_CHECK_INTERVAL) || 30000,

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
  ['LOG_CHANNEL_ID', CONFIG.logChannelId]
];

const missing = requiredEnv
  .filter(([name, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(
    `❌ Missing environment variables:\n${missing.join('\n')}`
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
// STATE
// ============================================================

let isReady = false;
let isConnecting = false;
let reconnectAttempts = 0;
let voiceCheckTimer = null;
let heartbeatTimer = null;

let startTime = Date.now();


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function formatUptime(ms) {
  let seconds = Math.floor(ms / 1000);

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}


function truncate(text, max = 1000) {
  if (!text) return 'Unknown';

  text = String(text);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}


// ============================================================
// LOGGING
// ============================================================

async function getLogChannel() {
  try {
    const guild = await client.guilds.fetch(CONFIG.logGuildId);

    if (!guild) {
      console.error('❌ Log Guild not found.');
      return null;
    }

    const channel = await guild.channels.fetch(CONFIG.logChannelId);

    if (!channel) {
      console.error('❌ Log Channel not found.');
      return null;
    }

    if (!channel.isTextBased()) {
      console.error('❌ Log Channel is not a text channel.');
      return null;
    }

    return channel;

  } catch (error) {
    console.error('❌ Failed to get log channel:', error);
    return null;
  }
}


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

    const channel = await getLogChannel();

    if (!channel) {
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(truncate(description, 4000))
      .setColor(color)
      .setTimestamp()
      .setFooter({
  text: `𝓝𝓜𝓡 | ${new Date().toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })}`,
  iconURL: 'https://i.postimg.cc/qRBtmgzD/download-20260819-160352.gif'
});

    if (fields.length > 0) {
      embed.addFields(
        fields.map(field => ({
          name: truncate(field.name, 256),
          value: truncate(field.value, 1024),
          inline: field.inline ?? false
        }))
      );
    }

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {
    console.error('❌ Failed to send log:', error);
  }
}


// ============================================================
// LOG TYPES
// ============================================================

async function logStartup() {
  await sendLog({
    title: '🟢 BOT STARTED',
    description: 'The bot has successfully started.',
    color: 0x57F287,
    fields: [
      {
        name: '🤖 Bot',
        value: `${client.user.tag}`,
        inline: true
      },
      {
        name: '🆔 Bot ID',
        value: client.user.id,
        inline: true
      },
      {
        name: '🎧 Voice Channel',
        value: CONFIG.voiceChannelId,
        inline: true
      },
      {
        name: '🖥️ Node.js',
        value: process.version,
        inline: true
      },
      {
        name: '📦 Discord.js',
        value: require('discord.js').version,
        inline: true
      }
    ],
    level: 'STARTUP'
  });
}


async function logReconnect(reason) {
  await sendLog({
    title: '🔄 VOICE RECONNECT',
    description: reason,
    color: 0xFEE75C,
    fields: [
      {
        name: '🔢 Attempt',
        value: `${reconnectAttempts}/${CONFIG.maxReconnectAttempts}`,
        inline: true
      },
      {
        name: '🎧 Voice Channel',
        value: CONFIG.voiceChannelId,
        inline: true
      }
    ],
    level: 'RECONNECT'
  });
}


async function logVoiceConnected() {
  await sendLog({
    title: '🎧 VOICE CONNECTED',
    description: 'The bot is now connected to the configured voice channel.',
    color: 0x57F287,
    fields: [
      {
        name: '🎙️ Channel',
        value: CONFIG.voiceChannelId,
        inline: true
      },
      {
        name: '🏠 Guild',
        value: CONFIG.voiceGuildId,
        inline: true
      }
    ],
    level: 'VOICE'
  });
}


async function logVoiceDisconnected(reason) {
  await sendLog({
    title: '🔴 VOICE DISCONNECTED',
    description: reason,
    color: 0xED4245,
    level: 'VOICE'
  });
}


async function logError(title, error) {
  await sendLog({
    title: `🚨 ${title}`,
    description: error?.stack || error?.message || String(error),
    color: 0xED4245,
    level: 'ERROR'
  });
}


// ============================================================
// JOIN VOICE
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

    const guild = await client.guilds.fetch(
      CONFIG.voiceGuildId
    );

    if (!guild) {
      throw new Error(
        `Voice guild ${CONFIG.voiceGuildId} not found.`
      );
    }

    const channel = await guild.channels.fetch(
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
      getVoiceConnection(CONFIG.voiceGuildId);

    if (connection) {

      const state = connection.state.status;

      if (
        state === VoiceConnectionStatus.Ready ||
        state === VoiceConnectionStatus.Connecting
      ) {
        isConnecting = false;
        return true;
      }

      try {
        connection.destroy();
      } catch {}
    }


    // --------------------------------------------------------
    // Join
    // --------------------------------------------------------

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,

      adapterCreator:
        guild.voiceAdapterCreator,

      selfDeaf: true,
      selfMute: true
    });


    // --------------------------------------------------------
    // Connection Events
    // --------------------------------------------------------

    connection.on(
      VoiceConnectionStatus.Ready,
      async () => {

        reconnectAttempts = 0;

        isConnecting = false;

        await logVoiceConnected();
      }
    );


    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {

        await logVoiceDisconnected(
          'Discord voice connection was disconnected.'
        );

        isConnecting = false;

        try {

          await entersState(
            connection,
            VoiceConnectionStatus.Signalling,
            5_000
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


    connection.on(
      VoiceConnectionStatus.Destroyed,
      async () => {

        isConnecting = false;

        scheduleReconnect(
          'Voice connection was destroyed.'
        );
      }
    );


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
    // Wait until ready
    // --------------------------------------------------------

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      20_000
    );

    reconnectAttempts = 0;

    isConnecting = false;

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
      title: '⚠️ RECONNECT LIMIT',
      description:
        'Maximum reconnect attempts reached. Retrying again after the normal check interval.',
      color: 0xFEE75C,
      level: 'RECONNECT'
    });

    return;
  }

  reconnectAttempts++;

  await logReconnect(reason);

  await sleep(CONFIG.reconnectDelay);

  await connectToVoice();
}


// ============================================================
// VOICE CHECK
// ============================================================

async function checkVoiceConnection() {

  if (!client.isReady()) {
    return;
  }

  try {

    const connection =
      getVoiceConnection(CONFIG.voiceGuildId);

    if (!connection) {

      await sendLog({
        title: '⚠️ VOICE CONNECTION MISSING',
        description:
          'No voice connection exists. Reconnecting...',
        color: 0xFEE75C,
        level: 'WATCHDOG'
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
      title: '⚠️ VOICE WATCHDOG',
      description:
        `Unexpected voice connection state: ${status}. Reconnecting...`,
      color: 0xFEE75C,
      level: 'WATCHDOG'
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
// HEARTBEAT LOG
// ============================================================

async function sendHeartbeat() {

  if (!client.isReady()) {
    return;
  }

  const connection =
    getVoiceConnection(CONFIG.voiceGuildId);

  const voiceStatus =
    connection?.state?.status || 'NOT_CONNECTED';

  await sendLog({
    title: '💓 BOT HEARTBEAT',
    description:
      'Bot is alive and monitoring the voice connection.',
    color: 0x5865F2,
    fields: [
      {
        name: '⏱️ Uptime',
        value: formatUptime(
          Date.now() - startTime
        ),
        inline: true
      },
      {
        name: '🎧 Voice Status',
        value: voiceStatus,
        inline: true
      },
      {
        name: '📡 Ping',
        value: `${client.ws.ping}ms`,
        inline: true
      }
    ],
    level: 'HEARTBEAT'
  });
}


// ============================================================
// READY
// ============================================================

client.once(
  Events.ClientReady,
  async readyClient => {

    isReady = true;
    startTime = Date.now();

    console.log(
      `\n========================================`
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
      `========================================\n`
    );


    // Startup log
    await logStartup();


    // Connect immediately
    await connectToVoice();


    // Watchdog
    voiceCheckTimer = setInterval(
      checkVoiceConnection,
      CONFIG.voiceCheckInterval
    );


    // Heartbeat every 30 minutes
    heartbeatTimer = setInterval(
      sendHeartbeat,
      30 * 60 * 1000
    );
  }
);


// ============================================================
// DISCORD EVENTS
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


client.on(
  Events.Warn,
  async warning => {

    console.warn(
      'Discord Warning:',
      warning
    );

    await sendLog({
      title: '⚠️ DISCORD WARNING',
      description: warning,
      color: 0xFEE75C,
      level: 'WARNING'
    });
  }
);


// ============================================================
// VOICE STATE MONITOR
// ============================================================

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {

    if (!client.user) {
      return;
    }

    if (newState.id !== client.user.id) {
      return;
    }

    // Bot left the configured voice channel
    if (
      oldState.channelId === CONFIG.voiceChannelId &&
      newState.channelId !== CONFIG.voiceChannelId
    ) {

      await sendLog({
        title: '🚪 BOT LEFT VOICE',
        description:
          'The bot is no longer inside the configured voice channel. Reconnecting...',
        color: 0xED4245,
        fields: [
          {
            name: 'Old Channel',
            value: oldState.channelId || 'None',
            inline: true
          },
          {
            name: 'New Channel',
            value: newState.channelId || 'None',
            inline: true
          }
        ],
        level: 'VOICE'
      });


      await sleep(2_000);

      await connectToVoice();
    }
  }
);


// ============================================================
// PROCESS ERROR HANDLING
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
      Don't manually call process.exit() here.

      PM2 will restart the process if Node terminates.
    */
  }
);


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
          : new Error(String(reason))
      );

    } catch {}
  }
);


// ============================================================
// SIGTERM / SIGINT
// ============================================================

async function gracefulShutdown(signal) {

  console.log(
    `\n🛑 Received ${signal}. Shutting down...`
  );

  try {

    await sendLog({
      title: '🔴 BOT STOPPING',
      description:
        `The bot is shutting down because it received ${signal}.`,
      color: 0xED4245,
      level: 'SHUTDOWN'
    });

  } catch {}


  if (voiceCheckTimer) {
    clearInterval(voiceCheckTimer);
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }


  try {

    const connection =
      getVoiceConnection(CONFIG.voiceGuildId);

    if (connection) {
      connection.destroy();
    }

  } catch {}


  try {
    client.destroy();
  } catch {}


  process.exit(0);
}


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

console.log('🚀 Starting NMR Voice Bot...');

client.login(CONFIG.token)
  .catch(async error => {

    console.error(
      '❌ Discord login failed:',
      error
    );

    /*
      Login failure means PM2 should restart the process.
    */

    process.exit(1);
  });