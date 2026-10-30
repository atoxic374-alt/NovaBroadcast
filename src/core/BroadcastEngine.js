const {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const config = require('../../config');
const checkpoint = require('./Checkpoint');
const broadcastCooldown = require('./BroadcastCooldown');

const COOLDOWN_TIME      = 900;
const MEMBER_COOLDOWN    = 100;
const MIN_CLIENT_DELAY   = 900;
const MAX_CLIENT_DELAY   = 6000;
const PREFETCH_PER_CLIENT = 4;
const START_CLIENT_CONCURRENCY = 3;
const REQUESTS_PER_SECOND = 1000 / (COOLDOWN_TIME + MEMBER_COOLDOWN);
const { sleep, createLogger, createProgressBar, buildContainer, txt, sep } = require('./Toolkit');
const history = require('./BroadcastHistory');

const logger = createLogger('BroadcastEngine');

class BroadcastEngine {
    constructor() {
        this.clients       = [];
        this.clientLoadMap = new Map();
        this.clientRateState = new Map();
        this.cooldownTime      = COOLDOWN_TIME;
        this.memberCooldown    = MEMBER_COOLDOWN;
        this.requestsPerSecond = REQUESTS_PER_SECOND;
        this.uiUpdateQueues    = new WeakMap();
        this.activeOperation   = null;
        this.lastResult        = null;
        this.lastContext       = null;
    }

    async initialize(clients) {
        logger.info(`Initializing BroadcastEngine with ${clients.length} client(s)`);
        const valid = [];

        for (const client of clients) {
            if (!client?.user) { logger.warn('Skipping invalid client'); continue; }
            client.botIndex = valid.length + 1;
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

    _isTransient(error) {
        return this._isRateLimit(error)
            || [500, 502, 503, 504].includes(error?.status)
            || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENETUNREACH'].includes(error?.code);
    }

    _failureReason(error) {
        const code = error?.rawError?.code ?? error?.code ?? error?.status;
        return {
            50007: 'DMs closed or bot blocked',
            50013: 'Missing permission',
            10003: 'User unavailable',
            429: 'Rate limited after retries',
            500: 'Discord server error',
            502: 'Discord gateway error',
            503: 'Discord temporarily unavailable',
            504: 'Discord request timeout',
            '-1': 'User fetch failed'
        }[String(code)] || (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENETUNREACH'].includes(code)
            ? 'Network error'
            : `Unknown send error${code !== undefined ? ` (code ${code})` : ''}`);
    }

    async _sendWithBackoff(client, user, payload) {
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await user.send(payload);
                this._markSuccess(client);
                return;
            } catch (error) {
                const code = error?.rawError?.code ?? error?.code ?? error?.status;
                const permanent = [10003, 10013, 50007].includes(Number(code));
                const retryable = this._isTransient(error) || !permanent;
                if (!retryable || attempt === 4) throw error;
                const retryAfter = this._isRateLimit(error)
                    ? Math.min(MAX_CLIENT_DELAY, Math.max(1000, Number(error.retryAfter) || 0))
                    : Math.min(MAX_CLIENT_DELAY, 500 * (2 ** attempt));
                if (this._isRateLimit(error)) this._markRateLimit(client, retryAfter);
                else this._rateState(client).nextAt = Date.now() + retryAfter;
                await sleep(retryAfter);
            }
        }
    }

    async _sendToMember(member, payload) {
        let lastError = null;
        const clients = [...this.clients].sort((a, b) =>
            (this.clientLoadMap.get(a.user.id) || 0) - (this.clientLoadMap.get(b.user.id) || 0)
        );

        // Try every connected bot. A recipient may block one bot while another
        // bot can still deliver, and transient API errors get retried above.
        for (const client of clients) {
            let slotAcquired = false;
            try {
                await this._acquireSendSlot(client);
                slotAcquired = true;
                await this._waitForClient(client);
                this._incLoad(client);
                const user = await this._resolveUser(client, member);
                if (!user) throw Object.assign(new Error('Cannot fetch user'), { code: -1 });
                await this._sendWithBackoff(client, user, payload);
                return client;
            } catch (error) {
                lastError = error;
                logger.warn(`${client.user.tag} could not deliver to ${member.id}; trying another bot: ${this._failureReason(error)}`);
            } finally {
                if (slotAcquired) this._releaseSendSlot(client);
                this._decLoad(client);
            }
        }

        throw lastError || Object.assign(new Error('No connected bot could send'), { code: -1 });
    }

    async _resolveUser(client, member) {
        const cached = client.users.cache.get(member.id);
        if (cached) return cached;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await client.users.fetch(member.id) || member.user;
            } catch (error) {
                if (!this._isTransient(error) || attempt === 2) return member.user || null;
                await sleep(Math.min(MAX_CLIENT_DELAY, 500 * (2 ** attempt)));
            }
        }
        return member.user || null;
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

    isBusy() {
        return Boolean(this.activeOperation && ['running', 'paused'].includes(this.activeOperation.status));
    }

    pause() {
        if (!this.isBusy()) return { ok: false, reason: 'لا توجد عملية نشطة.' };
        this.activeOperation.paused = true;
        this.activeOperation.status = 'paused';
        return { ok: true };
    }

    resume() {
        if (!this.activeOperation || this.activeOperation.status !== 'paused') return { ok: false, reason: 'العملية ليست متوقفة مؤقتًا.' };
        this.activeOperation.paused = false;
        this.activeOperation.status = 'running';
        return { ok: true };
    }

    cancel() {
        if (!this.isBusy()) return { ok: false, reason: 'لا توجد عملية نشطة.' };
        this.activeOperation.cancelRequested = true;
        this.activeOperation.paused = false;
        this.activeOperation.status = 'canceled';
        return { ok: true };
    }

    getOperation() {
        return this.activeOperation;
    }

    async _waitForOperation() {
        while (this.activeOperation?.paused && !this.activeOperation.cancelRequested) await sleep(250);
        return !this.activeOperation?.cancelRequested;
    }

    getBroadcastCooldown(guildId) {
        return broadcastCooldown.remaining(guildId);
    }

    _controlRow() {
        const paused = this.activeOperation?.status === 'paused';
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(paused ? 'bc_resume' : 'bc_pause').setLabel(paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('bc_refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('bc_cancel_active').setLabel('Cancel').setStyle(ButtonStyle.Danger)
        );
    }

    async startBroadcast({ interaction, members, message, msgType = 'normal', embedTitle = null, embedColor = null, embedFooter = null, embedLink = null, embedImage = null, bypassCooldown = false, ownerId = null, targetLabel = 'الفئة المستهدفة' }) {
        if (!bypassCooldown && this.isBusy()) return { busy: true };
        const operationId = `BC-${Date.now().toString(36).toUpperCase()}`;
        this.activeOperation = {
            id: operationId, ownerId, guildId: interaction?.guild?.id || null,
            status: 'running', paused: false, cancelRequested: false,
            startedAt: Date.now(), targetLabel
        };
        const timeout = setTimeout(() => {
            if (this.isBusy()) {
                this.activeOperation.cancelRequested = true;
                this.activeOperation.status = 'expired';
                logger.warn(`Broadcast ${operationId} expired after the safety timeout.`);
            }
        }, 30 * 60 * 1000);
        const queue = [...members.values()].filter(member => member?.id && !member.user?.bot);
        const uniqueMembers = [...new Map(queue.map(member => [member.id, member])).values()];
        const totalMembers = uniqueMembers.length;
        const valid        = this.clients.filter(c => c?.user?.id);
        const clientCount  = valid.length;

        if (!clientCount) { logger.error('No clients available'); this.activeOperation = null; clearTimeout(timeout); return null; }

        const guildId = interaction?.guild?.id || uniqueMembers[0]?.guild?.id;
        if (!bypassCooldown && guildId) {
            const claim = broadcastCooldown.claim(guildId);
            if (!claim.claimed) {
                logger.warn(`Broadcast blocked by cooldown for guild ${guildId}: ${claim.remaining}ms remaining`);
                this.activeOperation = null;
                clearTimeout(timeout);
                return { cooldown: true, remaining: claim.remaining };
            }
        }

        const checkpointState = {
            version: 1,
            guildId,
            message,
            msgType,
            embedTitle,
            embedColor,
            embedFooter,
            embedLink,
            embedImage,
            memberIds: uniqueMembers.map(member => member.id),
            completedMemberIds: [],
            savedAt: new Date().toISOString()
        };
        if (checkpointState.guildId) checkpoint.save(checkpointState);

        const results = {
            totalMembers,
            successCount:   0,
            failureCount:   0,
            failedMembers:  [],
            failureReasons: {},
            startTime:      Date.now(),
            lastUIUpdate:   Date.now(),
            lastUIProcessed: 0,
            processedCount: 0,
            checkpoint: checkpointState,
            operationId,
            targetLabel
        };

        const rps    = REQUESTS_PER_SECOND * clientCount;
        const etaMs  = ((COOLDOWN_TIME + MEMBER_COOLDOWN) / clientCount) * totalMembers;
        const etaMin = Math.floor(etaMs / 60000);
        const etaSec = Math.floor((etaMs % 60000) / 1000);
        const typeLabel = msgType === 'embed' ? 'مضمنة (Embed)' : 'عادية (Normal)';
        results.msgType = typeLabel;

        await this._updateUI(interaction, buildContainer(config.colors.main,
            txt(`**## جاري إرسال البرودكاست**\nسيتم تحديث هذه الرسالة باستمرار حتى اكتمال الإرسال.`),
            sep(false),
            txt(`**[${createProgressBar(0, 20)}] 0%**`),
            txt([
                `تم الإرسال بنجاح : 0`,
                `تعذر الإرسال : 0`,
                `تمت المعالجة : 0 / ${totalMembers}`,
                `المتبقي : ${totalMembers}`,
                `الوقت المتوقع : ${etaMin} د ${etaSec} ث`,
                `سرعة الإرسال : ~${rps.toFixed(1)} رسالة / ثانية`,
                `البوتات المستخدمة : ${clientCount}`,
                `نوع الرسالة : ${typeLabel}`
            ].join('\n')),
            sep()
        ), [this._controlRow()]);

        let cursor = 0;
        const claimed = new Set();
        const takeNext = () => {
            if (this.activeOperation?.cancelRequested) return null;
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

        clearTimeout(timeout);
        if (this.activeOperation?.status === 'running') this.activeOperation.status = 'completed';
        logger.info(`Broadcast done —  ${results.successCount}   ${results.failureCount}`);
        this.lastContext = { interaction, members: uniqueMembers, message, msgType, embedTitle, embedColor, embedFooter, embedLink, embedImage, ownerId, targetLabel };
        const finalResult = await this._finalize({ interaction, results, message, msgType, embedFooter, embedLink });
        this.lastResult = finalResult;
        this.activeOperation = null;
        return finalResult;
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
                pending.push({ member: nextMember });
            }
        };

        fillPrefetch();
        while (pending.length) {
            const task = pending.shift();
            const member = task.member;
            if (!(await this._waitForOperation())) break;
            fillPrefetch();
            try {
                const guild   = member.guild;
                const payload = this._buildPayload(message, msgType, embedTitle, embedColor, embedFooter, guild, embedLink, embedImage);
                await this._sendToMember(member, payload);
                results.successCount++;
            } catch (e) {
                results.failureCount++;
                results.failedMembers.push(member.id);
                const reason = this._failureReason(e);
                results.failureReasons[reason] = (results.failureReasons[reason] || 0) + 1;
                logger.error(`${client.user.tag} ✗ ${member.id}: ${reason}`);
            } finally {
                results.processedCount++;
                if (results.checkpoint) {
                    if (!results.failedMembers.includes(member.id)) {
                        results.checkpoint.completedMemberIds.push(member.id);
                    }
                    if (results.processedCount % 5 === 0 || results.processedCount === results.totalMembers) {
                        results.checkpoint.savedAt = new Date().toISOString();
                        checkpoint.save(results.checkpoint);
                    }
                }
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
            txt('**## جاري إرسال البرودكاست**\nهذه الرسالة تعرض آخر إحصائيات الإرسال.'),
            sep(false),
            txt(`**[${bar}] ${pct}%**`),
            txt([
                `تم الإرسال بنجاح : ${results.successCount}`,
                `تعذر الإرسال : ${results.failureCount}`,
                `تمت المعالجة : ${processed} / ${results.totalMembers}`,
                `المتبقي : ${remaining}`,
                `الوقت المتوقع : ${etaMin} د ${etaSec} ث`,
                `الوقت المنقضي : ${Math.floor(elapsed / 60000)} د ${Math.floor((elapsed % 60000) / 1000)} ث`,
                `سرعة الإرسال : ~${curSpeed} رسالة / ثانية`,
                `البوتات المستخدمة : ${this.clients.length}`,
                `نوع الرسالة : ${results.msgType || 'البرودكاست'}`,
                `رقم العملية : ${results.operationId}`,
                `الحالة : ${this.activeOperation?.status === 'paused' ? 'متوقفة مؤقتًا' : 'قيد التنفيذ'}`
            ].join('\n')),
            sep()
        ), [this._controlRow()]);
    }

    async resumeCheckpoint() {
        const saved = checkpoint.load();
        if (!saved || !this.clients[0]) return false;

        try {
            const client = this.clients[0];
            const guild = client.guilds.cache.get(saved.guildId)
                || await client.guilds.fetch(saved.guildId);
            await guild.members.fetch();

            const completed = new Set(saved.completedMemberIds || []);
            const members = new Map();
            for (const id of saved.memberIds) {
                if (completed.has(id)) continue;
                const member = guild.members.cache.get(id);
                if (member && !member.user.bot) members.set(id, member);
            }

            if (!members.size) {
                checkpoint.clear();
                logger.info('Checkpoint found with no pending members; cleared.');
                return true;
            }

            logger.info(`Resuming broadcast checkpoint: ${members.size} pending member(s)`);
            await this.startBroadcast({
                interaction: {
                    guild,
                    editReply: async () => {}
                },
                members,
                message: saved.message,
                msgType: saved.msgType,
                embedTitle: saved.embedTitle,
                embedColor: saved.embedColor,
                embedFooter: saved.embedFooter,
                embedLink: saved.embedLink,
                embedImage: saved.embedImage,
                bypassCooldown: true
            });
            return true;
        } catch (error) {
            logger.error(`Checkpoint resume failed: ${error.message}`);
            return false;
        }
    }

    async _finalize({ interaction, results, message, msgType = 'normal', embedFooter = null, embedLink = null }) {
        const elapsed   = Date.now() - results.startTime;
        const avgSpeed  = elapsed > 0 ? Math.round(results.totalMembers / (elapsed / 1000)) : 0;
        const successPct = results.totalMembers ? Math.floor(results.successCount / results.totalMembers * 100) : 0;
        const bar       = createProgressBar(100, 20);
        const typeLabel = msgType === 'embed' ? 'مضمنة (Embed)' : 'عادية (Normal)';
        const failureSummary = Object.entries(results.failureReasons || {})
            .map(([reason, count]) => `- ${reason} : ${count}`)
            .join('\n') || 'لا يوجد';
        const duration = `${Math.floor(elapsed / 60000)} د ${Math.floor((elapsed % 60000) / 1000)} ث`;
        const operationStatus = this.activeOperation?.status || 'completed';
        const preview = String(message || '').slice(0, 200);
        const summary = [
            '**ملخص النتائج**',
            `رقم العملية : ${results.operationId}`,
            `الحالة : ${operationStatus === 'expired' ? 'انتهت بالمهلة' : operationStatus === 'canceled' ? 'تم الإلغاء' : 'اكتملت'}`,
            `الفئة المستهدفة : ${results.targetLabel || 'غير محددة'}`,
            `إجمالي الأعضاء : ${results.totalMembers}`,
            `تم الإرسال بنجاح : ${results.successCount}`,
            `تعذر الإرسال : ${results.failureCount}`,
            `نسبة النجاح : ${successPct}%`,
            `تمت المعالجة : ${results.processedCount} / ${results.totalMembers}`,
            '',
            '**الأداء**',
            `مدة الإرسال : ${duration}`,
            `متوسط السرعة : ~${avgSpeed} رسالة / ثانية`,
            `نوع الرسالة : ${typeLabel}`,
            '',
            '**أسباب التعذر**',
            failureSummary
        ];
        if (preview) summary.push('', `**معاينة الرسالة :** ${preview}${String(message).length > 200 ? '…' : ''}`);
        if (embedFooter) summary.push(`تذييل التضمين : ${embedFooter}`);
        if (embedLink) summary.push(`رابط الزر : ${embedLink}`);

        const failedMembers = results.failedMembers || [];
        const failedNames = failedMembers.slice(0, 30).map(id => `<@${id}>`);
        if (failedMembers.length > 30) failedNames.push(`و ${failedMembers.length - 30} آخرون`);

        await this._updateUI(interaction, buildContainer(config.colors.success,
            txt(`**## ${operationStatus === 'completed' ? 'Broadcast Completed' : operationStatus === 'expired' ? 'Broadcast Expired' : 'Broadcast Canceled'}**\nالملخص النهائي وتفاصيل الإرسال في هذه الرسالة.`),
            sep(false),
            txt(`**[${bar}] ${results.processedCount >= results.totalMembers ? '100' : Math.floor(results.processedCount / Math.max(1, results.totalMembers) * 100)}% مكتمل**\n\n${summary.join('\n')}`),
            ...(failedNames.length ? [sep(false), txt(`**الأعضاء الذين تعذر الإرسال لهم (${failedMembers.length}) :**\n${failedNames.join('\n')}`)] : []),
            sep()
        ), failedNames.length ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('bc_retry_failed').setLabel('Retry Failed').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('bc_details').setLabel('Details').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('bc_close').setLabel('Close').setStyle(ButtonStyle.Danger)
        )] : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bc_close').setLabel('Close').setStyle(ButtonStyle.Secondary))]);

        checkpoint.clear();
        history.add({
            id: results.operationId, status: operationStatus, guildId: interaction?.guild?.id || null,
            total: results.totalMembers, success: results.successCount, failed: results.failureCount,
            startedAt: new Date(results.startTime).toISOString(), finishedAt: new Date().toISOString(),
            failureReasons: results.failureReasons
        });

        return results;
    }

    async _updateUI(interaction, container, extraComponents = []) {
        const edit = interaction?.message?.edit
            ? (payload) => interaction.message.edit(payload)
            : interaction?.editReply
                ? (payload) => interaction.editReply(payload)
                : null;
        if (!edit) return;
        const previous = this.uiUpdateQueues.get(interaction) || Promise.resolve();
        const next = previous.catch(() => null).then(() => edit({
            components: [container, ...extraComponents],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        })).catch((e) => logger.error('UI update failed:', e));
        this.uiUpdateQueues.set(interaction, next);
        await next;
    }
}

module.exports = new BroadcastEngine();
