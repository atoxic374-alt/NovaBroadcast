const { randomUUID } = require('node:crypto');
const {
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    SectionBuilder
} = require('discord.js');
const config = require('../../config');
const { canUse } = require('./Access');
const { buildContainer, txt } = require('./Toolkit');
const { createLogger } = require('./Toolkit');

const logger = createLogger('LeftPanel');
const COLLECTOR_TIME = 3 * 60 * 1000;

const resolveEntries = async (clients, guildId) => {
    const entries = [];
    for (const client of (clients || []).slice(1)) {
        if (!client?.user) continue;
        const guild = client.guilds.cache.get(guildId)
            ?? await client.guilds.fetch(guildId).catch(() => null);
        entries.push({
            client,
            id: client.user.id,
            name: client.user.username || client.user.tag || `Bot ${client.botIndex || ''}`.trim(),
            present: Boolean(guild),
            status: guild ? '' : 'غير موجود في هذا السيرفر'
        });
    }
    return entries;
};

const buildPanel = (entries, sessionId, disabled = false) => {
    const components = [];
    const sessionPrefix = `left:${sessionId}:`;
    const title = '**اختَر البوتات الفرعية التي تريد إخراجها**\nالبوت الأساسي سيبقى في السيرفر لتشغيل لوحة التحكم.';

    if (!entries.length) {
        components.push(txt(`${title}\nلا توجد بوتات فرعية مضافة.`));
    } else {
        entries.forEach((entry, index) => {
            const intro = index === 0 ? `${title}\n` : '';
            if (entry.present) {
                const section = new SectionBuilder()
                    .addTextDisplayComponents(txt(`${intro}<@${entry.id}>  ·  ${entry.name}${entry.status ? `\n${entry.status}` : ''}`))
                    .setButtonAccessory(
                        new ButtonBuilder()
                            .setCustomId(`${sessionPrefix}bot:${entry.id}`)
                            .setLabel('Left')
                            .setStyle(ButtonStyle.Danger)
                            .setDisabled(disabled)
                    );
                components.push(section);
            } else {
                // Deliberately render absent bots as plain text, never as a mention or button.
                components.push(txt(`${intro}${entry.name}  ·  ${entry.status || 'غير موجود في هذا السيرفر'}`));
            }
        });
    }

    const hasPresentBots = entries.some(entry => entry.present);
    const allSection = new SectionBuilder()
        .addTextDisplayComponents(txt('إخراج جميع البوتات الموجودة (باستثناء البوت الأساسي)'))
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId(`${sessionPrefix}all`)
                .setLabel('Left All')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled || !hasPresentBots)
        );
    components.push(allSection);
    return buildContainer(config.colors.error, ...components);
};

const leaveOne = async (entry, guildId) => {
    const client = entry.client;
    const guild = client.guilds.cache.get(guildId)
        ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        entry.present = false;
        entry.status = 'غير موجود في هذا السيرفر';
        return { ok: true, alreadyLeft: true };
    }

    client.intentionalGuildLeaves ||= new Set();
    client.intentionalGuildLeaves.add(guildId);
    try {
        await guild.leave();
        entry.present = false;
        entry.status = 'تمت المغادرة';
        logger.info(`${client.user.tag} left guild ${guildId} through Left panel`);
        return { ok: true };
    } catch (error) {
        client.intentionalGuildLeaves.delete(guildId);
        entry.status = `تعذرت المغادرة: ${String(error.message || error).slice(0, 100)}`;
        logger.error(`${client.user?.tag || entry.id} failed to leave guild ${guildId}: ${error.message}`);
        return { ok: false, error };
    }
};

const startLeftCollector = (message, entries, guildId, sessionId) => {
    const sessionPrefix = `left:${sessionId}:`;
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: COLLECTOR_TIME,
        filter: interaction => interaction.customId.startsWith(sessionPrefix)
    });
    let actionQueue = Promise.resolve();

    collector.on('collect', interaction => {
        actionQueue = actionQueue.then(async () => {
            if (!canUse(interaction.member)) {
                return interaction.reply({ content: 'هذه الأزرار مخصصة لمالكي البوت فقط.', flags: MessageFlags.Ephemeral });
            }
            await interaction.deferUpdate();
            const action = interaction.customId.slice(sessionPrefix.length);
            if (action === 'all') {
                for (const entry of entries) {
                    if (entry.present) await leaveOne(entry, guildId);
                }
            } else if (action.startsWith('bot:')) {
                const targetId = action.slice('bot:'.length);
                const target = entries.find(entry => entry.id === targetId);
                if (target?.present) await leaveOne(target, guildId);
            }
            await message.edit({
                components: [buildPanel(entries, sessionId)],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] }
            }).catch(error => logger.warn(`Could not refresh Left panel: ${error.message}`));
        }).catch(error => logger.error(`Left button handler failed: ${error.message}`));
    });

    collector.on('end', () => {
        message.edit({
            components: [buildPanel(entries, sessionId, true)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        }).catch(() => null);
    });
    return collector;
};

const createLeftPanel = async (clients, guildId) => {
    const sessionId = randomUUID();
    const entries = await resolveEntries(clients, guildId);
    return {
        entries,
        sessionId,
        container: buildPanel(entries, sessionId)
    };
};

module.exports = { createLeftPanel, startLeftCollector };
