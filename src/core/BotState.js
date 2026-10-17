const { ActivityType } = require('discord.js');
const config = require('../../config');

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

const currentActivity = () => state.activity || {
    name: config.bot.activity.name || 'Nova Realm™',
    type: ActivityType.Streaming,
    url: config.bot.activity.url || 'https://www.twitch.tv/nochannel'
};

const setActivity = (text, type = 'custom') => {
    state.activity = buildActivity(text, type);
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

module.exports = { state, ACTIVITY_TYPES, setActivity, applyTo };
