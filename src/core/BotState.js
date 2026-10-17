const { ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const CONFIG_FILE = path.join(__dirname, '..', '..', 'config.json');

// Shared presence for all bots. Set by /status all, read by the ready event loop.
const state = { activity: null };

const ACTIVITY_TYPES = ['custom', 'playing', 'streaming', 'listening', 'watching', 'competing'];
const TYPE_MAP = {
    playing: ActivityType.Playing,
    streaming: ActivityType.Streaming,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing
};

const buildActivity = (text, type = 'custom') => {
    if (type === 'custom') return { name: 'Custom Status', type: ActivityType.Custom, state: text };
    const activity = { name: text, type: TYPE_MAP[type] ?? ActivityType.Playing };
    if (type === 'streaming') activity.url = config.bot.activity.url || 'https://www.twitch.tv/nochannel';
    return activity;
};

const currentActivity = () => state.activity || buildActivity(
    config.bot.activity.name || 'Nova Realm™',
    (config.bot.activity.type || 'streaming').toLowerCase()
);

const setActivity = (text, type = 'custom') => {
    state.activity = buildActivity(text, type);
    config.bot.activity.name = text;
    config.bot.activity.type = type.toUpperCase();
    persistConfig(config.bot.activity);
};

const setNamePrefix = (prefix) => {
    config.bot.namePrefix = prefix;
    persistConfig({ namePrefix: prefix });
};

const applyName = async (client) => {
    const prefix = config.bot.namePrefix?.trim();
    const index = Number(client?.botIndex);
    if (!client?.user || !prefix || !Number.isInteger(index) || index < 1) return;
    await client.user.setUsername(`${prefix} ${index}`.slice(0, 32));
};

const persistConfig = (changes) => {
    try {
        const diskConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        diskConfig.bot = diskConfig.bot || {};
        diskConfig.bot.activity = diskConfig.bot.activity || {};
        if (changes.name) diskConfig.bot.activity.name = changes.name;
        if (changes.type) diskConfig.bot.activity.type = changes.type;
        if (changes.namePrefix !== undefined) diskConfig.bot.namePrefix = changes.namePrefix;
        fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(diskConfig, null, 2)}\n`);
    } catch {
        // Runtime environment may provide a read-only config file.
    }
};

const applyTo = (client) => {
    if (!client?.user) return;
    if (client.isSecondary) {
        client.user.setPresence({ status: 'invisible', activities: [] });
        return;
    }
    client.user.setPresence({
        status: config.bot.activity.status || 'online',
        activities: [currentActivity()]
    });
};

module.exports = { state, ACTIVITY_TYPES, setActivity, setNamePrefix, applyName, applyTo };
