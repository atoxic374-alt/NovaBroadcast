const {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const config = require('../../config');

const COOLDOWN_TIME      = 900;
const MEMBER_COOLDOWN    = 100;
const MIN_CLIENT_DELAY   = 900;
const MAX_CLIENT_DELAY   = 6000;
const PREFETCH_PER_CLIENT = 4;
const START_CLIENT_CONCURRENCY = 3;
const REQUESTS_PER_SECOND = 1000 / (COOLDOWN_TIME + MEMBER_COOLDOWN);
const { sleep, createLogger, createProgressBar, buildContainer, txt, sep, headerSection } = require('./Toolkit');

const logger = createLogger('BroadcastEngine');

class BroadcastEngine {
    constructor() {
        this.clients       = [];
        this.clientLoadMap = new Map();
        this.clientRateState = new Map();
        this.cooldownTime      = COOLDOWN_TIME;
        this.memberCooldown    = MEMBER_COOLDOWN;
        this.requestsPerSecond = REQUESTS_PER_SECOND;
    }

    async initialize(clients) {
        logger.info(`Initializing BroadcastEngine with ${clients.length} client(s)`);
        const valid = [];

        for (const client of clients) {
            if (!client?.user) { logger.warn('Skipping invalid client'); continue; }
            this.clientLoadMap.set(client.user.id, 0);
            if (!this.clientRateState.has(client.user.id)) {
                this.clientRateState.set(client.user.id, {
                    delay: COOLDOWN_TIME + MEMBER_COOLDOWN,
                    nextAt: 0,
                    successStreak: 0,
                    rateLimits: 0,
                    concurrency: START_CLIENT_CONCURRENCY,
                    inFlight: 0
                });
            }
            try {
                valid.push(client);
                logger.info(`Client validated: ${client.user.tag}`);
            } catch (e) {
                logger.warn(`${client.user.tag} guild access issue — keeping anyway`);
                valid.push(client);
            }
        }

        this.clients = valid;
        if (!this.clients.length) logger.error('No valid clients — broadcasting will fail!');
        else logger.info(`BroadcastEngine ready with ${this.clients.length} client(s)`);
        return this;
    }

    _incLoad(client) {
        this.clientLoadMap.set(client.user.id, (this.clientLoadMap.get(client.user.id) || 0) + 1);
    }
    _decLoad(client) {
        const n = this.clientLoadMap.get(client.user.id) || 0;
        if (n > 0) this.clientLoadMap.set(client.user.id, n - 1);
    }

    _rateState(client) {
        return this.clientRateState.get(client.user.id);
    }

    async _waitForClient(client) {
        const wait = Math.max(0, this._rateState(client).nextAt - Date.now());
        if (wait) await sleep(wait);
    }

    async _acquireSendSlot(client) {
        const state = this._rateState(client);
        while (state.inFlight >= state.concurrency) await sleep(50);
        state.inFlight++;
    }

    _releaseSendSlot(client) {
        const state = this._rateState(client);
        state.inFlight = Math.max(0, state.inFlight - 1);
    }

    _markSuccess(client) {
        const state = this._rateState(client);
        state.successStreak++;
        if (state.successStreak >= 20) {
            state.delay = Math.max(MIN_CLIENT_DELAY, state.delay - 25);
            state.successStreak = 0;
        }
        state.nextAt = Date.now() + state.delay;
    }

    _markRateLimit(client, retryAfter = 0) {
        const state = this._rateState(client);
        state.rateLimits++;
        state.successStreak = 0;
        state.concurrency = 1;
        state.delay = Math.min(MAX_CLIENT_DELAY, Math.max(state.delay + 500, retryAfter));
        state.nextAt = Date.now() + Math.max(state.delay, retryAfter);
    }

    _isRateLimit(error) {
        return error?.status === 429 || error?.code === 429 || error?.name === 'RateLimitError';
    }

    async _sendWithBackoff(client, user, payload) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await user.send(payload);
                this._markSuccess(client);
                return;
            } catch (error) {
                if (!this._isRateLimit(error) || attempt === 2) throw error;
                const retryAfter = Math.min(MAX_CLIENT_DELAY, Math.max(1000, Number(error.retryAfter) || 0));
                this._markRateLimit(client, retryAfter);
                await sleep(retryAfter);
            }
        }
    }

    async _resolveUser(client, member) {
        return client.users.cache.get(member.id)
            ?? await client.users.fetch(member.id).catch(() => null)
            ?? member.user;
    }

    _distribute(members, count) {
        const chunks = Array.from({ length: count }, () => []);
        members.forEach((m, i) => chunks[i % count].push(m));
        logger.info(`Distributed ${members.length} أعضاء → [${chunks.map(c => c.length).join(', ')}]`);
        return chunks;
    }

    _buildPayload(message, msgType, embedTitle, embedColor, embedFooter, guild, embedLink = null, embedImage = null) {
        if (msgType === 'embed') {
            const color = parseInt(config.colors.main.replace('#', ''), 16);
            const embed = new EmbedBuilder()
                .setTitle(embedTitle || 'Announcement')
                .setDescription(message)
                .setColor(color)
                .setTimestamp();

            if (guild?.iconURL()) {
                embed.setThumbnail(guild.iconURL({ dynamic: true, size: 512 }));
            }

            if (embedImage) embed.setImage(embedImage);

            if (embedFooter) {
                embed.setFooter({ text: embedFooter });
            }

            const payload = { embeds: [embed] };

            if (embedLink) {
                payload.components = [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Link')
                            .setURL(embedLink)
                            .setStyle(ButtonStyle.Link)
                    )
                ];
            }

            return payload;
        }
        if (embedImage) {
            return {
                content: message,
                files: [{ attachment: embedImage, name: 'broadcast-image' }]
            };
        }
        return { content: message };
    }

    async startBroadcast({ interaction, members, message, msgType = 'normal', embedTitle = null, embedColor = null, embedFooter = null, embedLink = null, embedImage = null }) {
        const queue = [...members.values()].filter(member => member?.id && !member.user?.bot);
        const uniqueMembers = [...new Map(queue.map(member => [member.id, member])).values()];
        const totalMembers = uniqueMembers.length;
        const valid        = this.clients.filter(c => c?.user?.id);
        const clientCount  = valid.length;

        if (!clientCount) { logger.error('No clients available'); return null; }

        const results = {
            totalMembers,
            successCount:   0,
            failureCount:   0,
            failedMembers:  [],
            startTime:      Date.now(),
            lastUIUpdate:   Date.now(),
            lastUIProcessed: 0,
            processedCount: 0
        };

        const rps    = REQUESTS_PER_SECOND * clientCount;
        const etaMs  = ((COOLDOWN_TIME + MEMBER_COOLDOWN) / clientCount) * totalMembers;
        const etaMin = Math.floor(etaMs / 60000);
        const etaSec = Math.floor((etaMs % 60000) / 1000);
        const typeLabel = msgType === 'embed' ? `Embed` : `Normal`;
        results.msgType = typeLabel;

        await this._updateUI(interaction, buildContainer(config.colors.main,
            headerSection(interaction.guild, `**## Processing Broadcast**`, `- Starting broadcast to **${totalMembers}** أعضاء. Please wait while the system delivers your message.`),
            sep(false),
            txt(`**[${createProgressBar(0, 20)}] 0%**`),
            txt([
                `✓ **Accepted:** 0   ✗ **Failed:** 0`,
                `**Processed:** 0 / ${totalMembers} أعضاء`,
                `**Time Left:** ${etaMin}m ${etaSec}s`,
                `**Speed:** ~${rps.toFixed(1)}/sec`,
                `**Bots:** ${clientCount}`,
                `**Type:** ${typeLabel}`
            ].join('\n')),
            sep()
        ));

        let cursor = 0;
        const claimed = new Set();
        const takeNext = () => {
            while (cursor < uniqueMembers.length) {
                const member = uniqueMembers[cursor++];
                if (claimed.has(member.id)) continue;
                claimed.add(member.id);
                return member;
            }
            return null;
        };

        await Promise.all(valid.map(client =>
            this._processQueue({ client, takeNext, message, results, interaction, msgType, embedTitle, embedColor, embedFooter, embedLink, embedImage })
        ));

        logger.info(`Broadcast done —  ${results.successCount}   ${results.failureCount}`);
        return this._finalize({ interaction, results, message, msgType, embedFooter, embedLink });
    }

    async _processQueue(args) {
        await Promise.all(
            Array.from({ length: START_CLIENT_CONCURRENCY }, () => this._processLane(args))
        );
    }

    async _processLane({ client, takeNext, message, results, interaction, msgType, embedTitle, embedColor, embedFooter, embedLink, embedImage }) {
        if (!client?.user) return;

        const pending = [];
        const fillPrefetch = () => {
            while (pending.length < PREFETCH_PER_CLIENT) {
                const nextMember = takeNext();
                if (!nextMember) return;
                pending.push({ member: nextMember, userPromise: this._resolveUser(client, nextMember) });
            }
        };

        fillPrefetch();
        while (pending.length) {
            const task = pending.shift();
            const member = task.member;
            fillPrefetch();
            let slotAcquired = false;
            try {
                await this._acquireSendSlot(client);
                slotAcquired = true;
                await this._waitForClient(client);
                this._incLoad(client);

                const user = await task.userPromise;

                if (!user) throw Object.assign(new Error('Cannot fetch user'), { code: -1 });

                const guild   = member.guild;
                const payload = this._buildPayload(message, msgType, embedTitle, embedColor, embedFooter, guild, embedLink, embedImage);
                await this._sendWithBackoff(client, user, payload);
                results.successCount++;
            } catch (e) {
                results.failureCount++;
                results.failedMembers.push(member.id);
                const reason = { 50007: 'DMs closed', 50013: 'No permission', 10003: 'Unknown user' }[e.code]
                    || e.message?.slice(0, 80);
                logger.error(`${client.user.tag} ✗ ${member.user?.tag ?? member.id}: ${reason}`);
            } finally {
                if (slotAcquired) this._releaseSendSlot(client);
                this._decLoad(client);
                results.processedCount++;
                const state = this._rateState(client);
                if (state.nextAt < Date.now()) state.nextAt = Date.now() + state.delay;

                const pct = results.totalMembers ? Math.floor(results.processedCount / results.totalMembers * 100) : 100;
                const now = Date.now();
                if (results.processedCount - results.lastUIProcessed >= 10 || results.processedCount === results.totalMembers) {
                    results.lastUIUpdate = now;
                    results.lastUIProcessed = results.processedCount;
                    await this._progressUI(interaction, results, pct);
                }

            }
        }
    }

    async _progressUI(interaction, results, pct) {
        const elapsed   = Date.now() - results.startTime;
        const processed = results.processedCount;
        const remaining = results.totalMembers - processed;
        const avgMs     = processed > 0 ? elapsed / processed : 0;
        const etaMs     = avgMs * remaining;
        const etaMin    = Math.floor(etaMs / 60000);
        const etaSec    = Math.floor((etaMs % 60000) / 1000);
        const curSpeed  = processed > 0 ? Math.round(processed / (elapsed / 1000)) : 0;
        const bar       = createProgressBar(pct, 20);

        await this._updateUI(interaction, buildContainer(config.colors.main,
            headerSection(interaction.guild, `**## Processing Broadcast**`, `- جاري تنفيذ الإرسال. يتم تحديث الإحصائيات تلقائيًا.`),
            sep(false),
            txt(`**[${bar}] ${pct}%**`),
            txt([
                `✓ **Accepted:** ${results.successCount}   ✗ **Failed:** ${results.failureCount}`,
                `**Processed:** ${processed} / ${results.totalMembers}   **Remaining:** ${remaining}`,
                `**Time Left:** ${etaMin}m ${etaSec}s`,
                `**Elapsed:** ${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`,
                `**Speed:** ~${curSpeed}/sec   **Bots:** ${this.clients.length}`,
                `**Type:** ${results.msgType || 'Broadcast'}`
            ].join('\n')),
            sep()
        ));
    }

    async _finalize({ interaction, results, message, msgType = 'normal', embedFooter = null, embedLink = null }) {
        const elapsed   = Date.now() - results.startTime;
        const avgSpeed  = elapsed > 0 ? Math.round(results.totalMembers / (elapsed / 1000)) : 0;
        const pct       = results.totalMembers ? Math.floor(results.successCount / results.totalMembers * 100) : 0;
        const bar       = createProgressBar(pct, 20);
        const typeLabel = msgType === 'embed' ? `Embed` : `Normal`;
        const footerLabel = embedFooter ? `Footer: ${embedFooter}` : '';
        const guild     = interaction.guild;

        const reportChannelId = process.env.REPORT_CHANNEL_ID || interaction.channelId;
        if (reportChannelId) {
            try {
                const ch = await this.clients[0].channels.fetch(reportChannelId);
                if (ch) await ch.send({
                    components: [this._reportContainer(results, message, msgType, embedFooter, embedLink, guild)],
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (e) { logger.error(`Report channel failed: ${e.message}`); }
        }

        await this._updateUI(interaction, buildContainer(config.colors.success,
            headerSection(guild, '**## Broadcast Completed**', '- اكتمل الإرسال بنجاح. تم إرسال التقرير التفصيلي إلى قناة التقارير.'),
            sep(false),
            txt([
                `**[${bar}] ${pct}%**`,
                `✓ **Accepted:** ${results.successCount}`,
                `✗ **Failed:** ${results.failureCount}`,
                `**Processed:** ${results.processedCount} / ${results.totalMembers}`,
                `**Total Time:** ${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`,
                `**Avg Speed:** ~${avgSpeed}/sec`,
                `**Type:** ${typeLabel}`
            ].join('\n')),
            sep()
        ));

        return results;
    }

    _reportContainer(results, message, msgType = 'normal', embedFooter = null, embedLink = null, guild = null) {
        const preview   = message.length > 200 ? message.slice(0, 200) + '…' : message;
        const pct       = results.totalMembers ? Math.floor(results.successCount / results.totalMembers * 100) : 0;
        const typeLabel = msgType === 'embed' ? `Embed` : `Normal`;

        const container = buildContainer(config.colors.warning,
            headerSection(guild, `## Broadcast Report`),
            sep(false),
            txt(`**Message:**\n\`\`\`${preview}\`\`\``),
            txt([
                `**Total:** ${results.totalMembers}`,
                `**Success:** ${results.successCount}`,
                `**Failed:** ${results.failureCount}`,
                `**Rate:** ${pct}%`,
                `**Type:** ${typeLabel}`
            ].join('\n'))
        );

        if (embedFooter) {
            container.addSeparatorComponents(sep());
            container.addTextDisplayComponents(txt(`**Footer:** ${embedFooter}`));
        }

        if (embedLink) {
            container.addSeparatorComponents(sep());
            container.addTextDisplayComponents(txt(`**Link Button:** ${embedLink}`));
        }

        if (results.failedMembers.length) {
            const PER_CHUNK  = 30;
            const MAX_CHUNKS = 5;
            const names      = results.failedMembers.map(id => {
                const u = this.clients[0].users.cache.get(id);
                return u ? u.tag : `<@${id}>`;
            });

            const chunks = [];
            for (let i = 0; i < names.length; i += PER_CHUNK)
                chunks.push(names.slice(i, i + PER_CHUNK));

            const displayChunks = chunks.slice(0, MAX_CHUNKS);
            const leftover      = names.length - displayChunks.flat().length;

            container.addSeparatorComponents(sep());
            displayChunks.forEach((ch, idx) =>
                container.addTextDisplayComponents(
                    txt(`**Failed Members${idx > 0 ? ` (cont. ${idx + 1})` : ''}:**\n${ch.join(', ')}`)
                )
            );
            if (leftover > 0)
                container.addTextDisplayComponents(txt(`*...and ${leftover} more. Check console logs.*`));
        }

        return container;
    }

    async _updateUI(interaction, container) {
        try {
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (e) { logger.error('UI update failed:', e); }
    }
}

module.exports = new BroadcastEngine();
