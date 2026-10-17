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

const logger = createLogger('Main');
const PREFIX = config.prefix;

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
        loadEvents(client);
        attachListeners(client);

        try {
            await client.login(token);

            clients.push(client);

            logger.info(
                `Logged in: ${client.user.tag} (${clients.length}/${config.bot.tokens.length})`
            );
        } catch (e) {
            logger.error(
                `Login failed for token #${config.bot.tokens.indexOf(token) + 1}: ${e.message}`
            );
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
        return { ok: false, reason: 'التوكن غير صالح.' };
    }
    if (config.bot.tokens.includes(normalized)) {
        return { ok: false, reason: 'هذا التوكن مضاف مسبقًا.' };
    }

    const client = createClient();
    client.isSecondary = clients.length > 0;
    loadEvents(client);
    attachListeners(client);
    try {
        await client.login(normalized);
        clients.push(client);
        config.bot.tokens.push(normalized);
        const engine = require('./src/core/BroadcastEngine');
        await engine.initialize(clients);
        logger.info(`Runtime bot added: ${client.user.tag}`);
        return { ok: true, tag: client.user.tag, count: clients.length };
    } catch (error) {
        client.destroy();
        logger.warn(`Runtime token rejected: ${error.code || error.name || 'login_failed'}`);
        return { ok: false, reason: 'تعذر تسجيل الدخول بهذا التوكن.' };
    }
};

const attachListeners = (client) => {

    client.on('error', (e) => {
        logger.error(`[${client.user?.tag}] error:`, e);
    });

    client.on('warn', (w) => {
        logger.warn(`[${client.user?.tag}] warn: ${w}`);
    });


    client.on('messageCreate', async (msg) => {

        if (clients[0] && client !== clients[0]) return;

        if (msg.author.bot) return;

        if (!msg.content.startsWith(PREFIX)) return;

        const authorized = await hasBcPermission(
            msg.guild,
            msg.member,
            msg.author?.id
        );

        if (!authorized) return;

        const args = msg.content
            .slice(PREFIX.length)
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
│                               📨 PREFIX   : ${PREFIX}cp │ ${PREFIX}help │ ${PREFIX}add │ ${PREFIX}left                   │
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
