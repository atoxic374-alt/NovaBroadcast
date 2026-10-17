const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { canUse } = require('../../core/Access');
const owners = require('../../core/Owners');

const send = (message, color, title, body) => message.reply({
    components: [buildContainer(color, headerSection(message.guild, `**## ${title}**`, body), sep())],
    flags: MessageFlags.IsComponentsV2
});

module.exports = {
    name: 'owners',

    // usage: +owners list | +owners add <id|@mention> | +owners remove <id|@mention>
    async run(message, args) {
        if (!canUse(message.member)) return;

        const sub = (args[0] || '').toLowerCase();
        if (sub === 'list') {
            const lines = owners.list().map(id => `<@${id}> (\`${id}\`)`).join('\n') || 'None';
            return send(message, config.colors.main, 'Owners', lines);
        }

        const id = (args[1] || '').replace(/[<@!>]/g, '');
        if (!['add', 'remove'].includes(sub) || !id)
            return send(message, config.colors.warning, 'Usage', `- \`${config.prefix}owners list\`\n- \`${config.prefix}owners add <id|@user>\`\n- \`${config.prefix}owners remove <id|@user>\``);

        const result = sub === 'add' ? owners.add(id) : owners.remove(id);
        if (!result.ok) return send(message, config.colors.error, 'Failed', `- ${result.reason}`);
        return send(message, config.colors.success, sub === 'add' ? 'Owner Added' : 'Owner Removed', `- <@${id}> (\`${id}\`)`);
    }
};
