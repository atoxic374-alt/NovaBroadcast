const { applyTo } = require('../core/BotState');

module.exports = {
    name: 'clientReady',
    once: true,

    async execute(client, config, logger) {
        logger.info(`Ready: ${client.user.tag}`);

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
