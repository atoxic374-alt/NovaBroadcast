const { Client, GatewayIntentBits, Partials, REST, Routes, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const runtime = require('./src/core/Runtime');

// Tokens are read from environment variables first (Railway Variables), then config.json.
// Supported: BOT_TOKENS (comma / newline separated), BOT_TOKEN, BOT_TOKEN_1 ... BOT_TOKEN_10
const collectTokens = () => {
    const list = [];
    if (process.env.BOT_TOKENS) list.push(...process.env.BOT_TOKENS.split(/[\s,]+/));
    if (process.env.BOT_TOKEN) list.push(process.env.BOT_TOKEN);
    for (let i = 1; i <= 10; i++) {
        if (process.env[`BOT_TOKEN_${i}`]) list.push(process.env[`BOT_TOKEN_${i}`]);
    }
    list.push(...runtime.savedTokens());
    list.push(...(config.bot.tokens || []));
    return [...new Set(list.map(t => (t || '').trim()).filter(t => t && !t.startsWith('TOKEN_')))];
};

config.bot.tokens = collectTokens();

const { createLogger } = require('./src/core/Toolkit');
const router = require('./src/core/CommandRouter');
const { canUse } = require('./src/core/Access');
const { notifyEnvironmentOwners, flushPendingOwnerAlerts } = require('./src/core/OwnerAlerts');

const logger = createLogger('Main');
const clients = [];
const slashCommands = new Collection();
const prefixCommands = new Collection();

const loadCommands = (dir, collection) => {
    const cmdPath = path.join(__dirname, 'src', 'commands', dir);

    if (!fs.existsSync(cmdPath)) return;

    const files = fs.readdirSync(cmdPath).filter(f => f.endsWith('.js'));

    for (const file of files) {
        const cmd = require(path.join(cmdPath, file));

        if (cmd.name) {
            collection.set(cmd.name, cmd);
        }

        logger.info(`Loaded ${dir} command: ${cmd.name}`);
    }
};
loadCommands('slash', slashCommands);
loadCommands('prefix', prefixCommands);

const loadEvents = (client) => {
    const eventsPath = path.join(__dirname, 'src', 'events');

    if (!fs.existsSync(eventsPath)) {
        logger.warn('Events folder not found.');
        return;
    }

    const files = fs.readdirSync(eventsPath)
        .filter(file => file.endsWith('.js'));

    for (const file of files) {
        const event = require(path.join(eventsPath, file));

        if (!event.name || typeof event.execute !== 'function') {
            logger.warn(`Invalid event file: ${file}`);
            continue;
        }

        const runEvent = (...args) => {
            Promise.resolve(
                event.execute(client, config, logger, ...args)
            ).catch(error => {
                logger.error(
                    `Event ${event.name} failed: ${error.stack || error.message}`
                );
            });
        };

        // 'ready' was renamed to 'clientReady' in newer discord.js v14 (and is the only name in v15)
        const eventName = event.name === 'ready' ? (Events.ClientReady || 'ready') : event.name;

        if (event.once) {
            client.once(eventName, runEvent);
        } else {
            client.on(eventName, runEvent);
        }

        logger.info(`Loaded event: ${event.name}`);
    }
};

const registerSlash = async (client) => {
    const body = [];

    for (const [, cmd] of slashCommands) {
        if (cmd.data) body.push(cmd.data);
    }

    if (!body.length) return;

    try {
        const rest = new REST({ version: '10' })
            .setToken(client.token);

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body }
        );

        logger.info(`✅ Registered ${body.length} slash command(s)`);
    } catch (e) {
        logger.error(`Slash registration failed: ${e.message}`);
    }
};

const initClients = async () => {
    logger.info('Initializing clients...');

    if (!config.bot.tokens?.length) {
        logger.warn('No bot tokens configured. Set BOT_TOKEN (main bot) and optionally BOT_TOKEN_2..BOT_TOKEN_5 in the environment variables. Running idle until tokens are added.');
        return false;
    }

    for (const token of config.bot.tokens) {
        if (!token) {
            logger.warn('Empty token skipped');
            continue;
        }

        const client = createClient();
        client.isSecondary = clients.length > 0;
        client.botIndex = clients.length + 1;
        loadEvents(client);
        attachListeners(client);

        try {
            await client.login(token);

            clients.push(client);
            await flushPendingOwnerAlerts(clients);

            logger.info(
                `Logged in: ${client.user.tag} (${clients.length}/${config.bot.tokens.length})`
            );
        } catch (e) {
            const tokenNumber = config.bot.tokens.indexOf(token) + 1;
            logger.error(
                `Login failed for token #${tokenNumber}: ${e.message}`
            );
            void notifyEnvironmentOwners(clients, {
                title: 'فشل تشغيل بوت',
                details: `تعذر تسجيل الدخول للبوت رقم #${tokenNumber}. سبب الخطأ: ${String(e.message || e).slice(0, 500)}`,
                dedupeKey: `login-failed:${tokenNumber}`
            });
        }
    }

    if (!clients.length) {
        logger.error('No clients logged in.');
        process.exit(1);
    }

    const engine = require('./src/core/BroadcastEngine');

    await engine.initialize(clients);
    await registerSlash(clients[0]);
    runtime.setAddTokenHandler(addRuntimeToken);
    await engine.resumeCheckpoint();

    logger.info(`${clients.length} client(s) ready`);
    return true;
};

const hasBcPermission = async (guild, member, userId) => {
    if (!guild) return false;

    let targetMember = member;
    if (!targetMember && userId) {
        targetMember = await guild.members.fetch(userId).catch(() => null);
    }

    return canUse(targetMember);
};

const createClient = () => new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const addRuntimeToken = async (token) => {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.startsWith('TOKEN_')) {
        return { ok: false, code: 'invalid', reason: 'التوكن غير صالح.' };
    }
    if (config.bot.tokens.includes(normalized)) {
        return { ok: false, code: 'duplicate', reason: 'هذا التوكن مضاف مسبقًا.' };
    }

    const client = createClient();
    client.isSecondary = clients.length > 0;
    client.botIndex = clients.length + 1;
    loadEvents(client);
    attachListeners(client);
    let addedToClients = false;
    let addedToConfig = false;
    try {
        await client.login(normalized);
        clients.push(client);
        addedToClients = true;
        await flushPendingOwnerAlerts(clients);
        config.bot.tokens.push(normalized);
        addedToConfig = true;
        const engine = require('./src/core/BroadcastEngine');
        await engine.initialize(clients);
        logger.info(`Runtime bot added: ${client.user.tag}`);
        return { ok: true, tag: client.user.tag, count: clients.length };
    } catch (error) {
        if (addedToClients) clients.splice(clients.indexOf(client), 1);
        if (addedToConfig) config.bot.tokens = config.bot.tokens.filter(value => value !== normalized);
        client.destroy();
        logger.warn(`Runtime token rejected: ${error.code || error.name || 'login_failed'}`);
        void notifyEnvironmentOwners(clients, {
            title: 'فشل تشغيل بوت تمت إضافته',
            details: `تعذر تسجيل دخول بوت جديد أثناء التشغيل. نوع الخطأ: ${error.code || error.name || 'login_failed'}.`,
            dedupeKey: `runtime-login-failed:${error.code || error.name || 'login_failed'}`
        });
        const invalidToken = error.code === 'TokenInvalid'
            || error.name === 'TokenInvalid'
            || /invalid token/i.test(String(error.message || ''));
        if (addedToClients) {
            const engine = require('./src/core/BroadcastEngine');
            await engine.initialize(clients).catch(() => {});
        }
        return {
            ok: false,
            code: invalidToken ? 'invalid' : 'failed',
            reason: invalidToken ? 'التوكن غير صالح أو تم إلغاؤه.' : 'تعذر تشغيل البوت بسبب خطأ اتصال أو تشغيل.'
        };
    }
};

const attachListeners = (client) => {

    client.once(Events.ClientReady || 'ready', () => {
        void flushPendingOwnerAlerts(clients);
    });

    client.on('error', (e) => {
        logger.error(`[${client.user?.tag}] error:`, e);
        void notifyEnvironmentOwners(clients, {
            title: 'خطأ في أحد البوتات',
            details: `واجه ${client.user?.tag || `البوت رقم #${client.botIndex}`} خطأً: ${String(e?.message || e).slice(0, 500)}`,
            dedupeKey: `client-error:${client.user?.id || client.botIndex}`
        });
    });

    client.on('shardDisconnect', (closeEvent, shardId) => {
        const code = closeEvent?.code ?? 'غير معروف';
        const reason = closeEvent?.reason?.toString?.() || 'لا يوجد سبب مرفق';
        void notifyEnvironmentOwners(clients, {
            title: 'انقطع اتصال بوت',
            details: `${client.user?.tag || `البوت رقم #${client.botIndex}`} — shard ${shardId} — رمز الإغلاق ${code}. قد يحاول Discord إعادة الاتصال تلقائيًا. السبب: ${reason.slice(0, 300)}`,
            dedupeKey: `shard-disconnect:${client.user?.id || client.botIndex}:${shardId}`
        });
    });

    client.on('shardError', (error, shardId) => {
        void notifyEnvironmentOwners(clients, {
            title: 'خطأ في اتصال بوت',
            details: `${client.user?.tag || `البوت رقم #${client.botIndex}`} — shard ${shardId}: ${String(error?.message || error).slice(0, 500)}`,
            dedupeKey: `shard-error:${client.user?.id || client.botIndex}:${shardId}`
        });
    });

    client.on('guildDelete', (guild) => {
        if (client.intentionalGuildLeaves?.delete(guild.id)) return;
        void notifyEnvironmentOwners(clients, {
            title: 'تمت إزالة بوت من سيرفر',
            details: `${client.user?.tag || `البوت رقم #${client.botIndex}`} لم يعد في السيرفر **${guild.name || 'غير معروف'}** (${guild.id}). قد يكون طردًا أو حظرًا من السيرفر.`,
            dedupeKey: `guild-delete:${client.user?.id || client.botIndex}:${guild.id}`
        });
    });

    client.on('shardResume', () => {
        void flushPendingOwnerAlerts(clients);
    });

    client.on('warn', (w) => {
        logger.warn(`[${client.user?.tag}] warn: ${w}`);
    });


    client.on('messageCreate', async (msg) => {

        if (clients[0] && client !== clients[0]) return;

        if (msg.author.bot) return;

        if (client.user && msg.mentions.users.has(client.user.id)) {
            await msg.reply(`My Prefix \`${config.prefix}\``);
            return;
        }

        const prefix = config.prefix;
        if (!msg.content.startsWith(prefix)) return;

        const authorized = await hasBcPermission(
            msg.guild,
            msg.member,
            msg.author?.id
        );

        if (!authorized) return;

        const args = msg.content
            .slice(prefix.length)
            .trim()
            .split(/\s+/);

        const command = args.shift()?.toLowerCase();

        if (!command) return;

        const cmd = prefixCommands.get(command);

        if (cmd) {
            try {
                await cmd.run(msg, args);
            } catch (e) {
                logger.error(
                    `Prefix command ${command} failed: ${e.message}`
                );
            }
        }
    });


    client.on('interactionCreate', async (interaction) => {

        if (clients[0] && client !== clients[0]) return;

        const authorized = await hasBcPermission(
            interaction.guild,
            interaction.member,
            interaction.user?.id
        );

        if (!authorized) return;


        if (interaction.isChatInputCommand()) {

            const cmd = slashCommands.get(
                interaction.commandName
            );

            if (cmd) {
                try {
                    await cmd.run(interaction);
                } catch (e) {
                    logger.error(
                        `Slash command ${interaction.commandName} failed: ${e.message}`
                    );
                }
            }

            return;
        }


        if (interaction.isButton()) {
            await router.handleButton(interaction);
        }

        if (interaction.isStringSelectMenu()) {
            await router.handleSelect(interaction);
        }

        if (interaction.isModalSubmit()) {
            await router.handleModal(interaction);
        }
    });
};

process.on('uncaughtException', (e) => {
    logger.error('UncaughtException:', e);
});

process.on('unhandledRejection', (r) => {
    logger.error('UnhandledRejection:', r);
});

(async () => {

    logger.info('Starting Nova Realm™ Broadcast v3.0...');

    try {

        const started = await initClients();

        if (!started) {
            // No tokens: stay alive and idle instead of crashing / restart-looping.
            setInterval(() => {}, 1 << 30);
            return;
        }

        const engine = require('./src/core/BroadcastEngine');

        const bots = clients.length;
        const speed = engine.requestsPerSecond * bots;

        console.log(`
┌───[ Nova Realm™ // BROADCAST CORE ]──────────────────────────────────────────────────────┐
│                                                                                          │
│   ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗     ██████╗ ███████╗ █████╗ ██╗     ███╗   ███╗™   │
│   ████╗  ██║██╔═══██╗██║   ██║██╔══██╗    ██╔══██╗██╔════╝██╔══██╗██║     ████╗ ████║    │
│   ██╔██╗ ██║██║   ██║██║   ██║███████║    ██████╔╝█████╗  ███████║██║     ██╔████╔██║    │
│   ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║    ██╔══██╗██╔══╝  ██╔══██║██║     ██║╚██╔╝██║    │
│   ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║    ██║  ██║███████╗██║  ██║███████╗██║ ╚═╝ ██║    │
│   ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝    ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝    │
│                                                                                          │
│                                STATUS       : ONLINE                                     │
│                                SYSTEM       : BROADCAST v3.0                             │
│                   ────────────────────────────────────────────────────────               │
│                               🤖 BOTS     : ${String(bots).padEnd(35)}          │
│                               ⚡ SPEED    : ~${String(speed).padEnd(34)}          │
│                               📨 PREFIX   : ${config.prefix}cp │ ${config.prefix}help │ ${config.prefix}add │ ${config.prefix}left                   │
│                               🔷 SLASH    : /cp │ /help │ /add │ /left                   │
│                              💻 ENGINE   : discord.js v14                                │
│                                                                                          │
│                              [ Nova Realm™ ] :: BROADCAST CORE ACTIVE                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        `);

    } catch (e) {

        logger.error('Boot failed:', e);
        process.exit(1);

    }
})();
