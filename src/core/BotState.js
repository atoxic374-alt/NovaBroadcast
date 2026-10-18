const { ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const SETTINGS_FILE = process.env.BOT_SETTINGS_FILE || path.join(__dirname, '..', '..', 'data', 'bot-settings.json');

// Keep mutable settings outside config.json, which may be read-only or replaced
// during deployment. Point BOT_SETTINGS_FILE at a mounted volume to survive redeploys.
let persistedSettings = {};
try {
    persistedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (persistedSettings.activity && typeof persistedSettings.activity === 'object') {
        config.bot.activity = { ...config.bot.activity, ...persistedSettings.activity };
    }
    if (typeof persistedSettings.prefix === 'string' && persistedSettings.prefix.trim()) {
        config.prefix = persistedSettings.prefix;
    }
    if (typeof persistedSettings.namePrefix === 'string') {
        config.bot.namePrefix = persistedSettings.namePrefix;
    }
} catch {
    persistedSettings = {};
}

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
const persistSettings = (changes) => {
    try {
        persistedSettings = {
            ...persistedSettings,
            ...changes,
            ...(changes.activity ? {
                activity: { ...(persistedSettings.activity || {}), ...changes.activity }
            } : {})
        };
        fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
        const temporaryFile = `${SETTINGS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, `${JSON.stringify(persistedSettings, null, 2)}\n`);
        fs.renameSync(temporaryFile, SETTINGS_FILE);
    } catch (error) {
        // Keep the running bot usable, but make failed persistence visible.
        console.warn(`[BotState] Could not persist settings to ${SETTINGS_FILE}: ${error.message}`);
    }
};
const setActivity = (text, type = 'custom') => {
    state.activity = buildActivity(text, type);
    config.bot.activity.name = text;
    config.bot.activity.type = type.toUpperCase();
    persistSettings({ activity: { name: text, type: type.toUpperCase() } });
};
const setPrefix = (prefix) => {
    config.prefix = prefix;
    persistSettings({ prefix });
};
const setNamePrefix = (prefix) => {
    config.bot.namePrefix = prefix;
    persistSettings({ namePrefix: prefix });
};
const applyName = async (client) => {
    const prefix = config.bot.namePrefix?.trim();
    const index = Number(client?.botIndex);
    if (!client?.user || !prefix || !Number.isInteger(index) || index < 1) return;
    await client.user.setUsername(`${prefix} ${index}`.slice(0, 32));
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
module.exports = { state, ACTIVITY_TYPES, setActivity, setPrefix, setNamePrefix, applyName, applyTo };
