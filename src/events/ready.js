const { applyTo } = require('../core/BotState');
const { getBotAvatarColor } = require('../core/Toolkit');

module.exports = {
    name: 'clientReady',
    once: true,

    async execute(client, config, logger) {
        logger.info(`Ready: ${client.user.tag}`);

        const avatarColor = await getBotAvatarColor(client, config.colors.main);
        for (const key of ['main', 'success', 'warning', 'error', 'canceled']) {
            config.colors[key] = avatarColor;
        }
        logger.info(`Avatar color applied: ${avatarColor}`);

        applyTo(client);

        if (client.presenceInterval) {
            clearInterval(client.presenceInterval);
        }

        client.presenceInterval = setInterval(() => {
            try {
                applyTo(client);
            } catch (error) {
                logger.error(`[${client.user?.tag}] Presence error: ${error.message}`);
            }
        }, 10_000);
    }
};
