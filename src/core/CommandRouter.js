const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    SectionBuilder,
    ThumbnailBuilder
} = require('discord.js');

const config = require('../../config');
const { canUse } = require('./Access');
const engine = require('./BroadcastEngine');
const history = require('./BroadcastHistory');
const { botStatusContainer } = require('./Branding');
const { createLogger, buildContainer, txt, sep, headerSection } = require('./Toolkit');

const logger = createLogger('CommandRouter');
const MAX_BC_LEN = 2000;
const MAX_PREV_LEN = 200;
const SESSION_TTL = 10 * 60 * 1000;

const formatCooldown = (milliseconds) => {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours ? `${hours}h ` : ''}${minutes}m ${seconds}s`;
};

class CommandRouter {
    constructor() {
        this.broadcasts = new Map();
        this.sessions = new Map();
        this._timers = new Map();
        setInterval(() => logger.debug(`Active sessions: ${this.broadcasts.size}`), 5 * 60 * 1000);
    }

    setBroadcastSession(userId, text, data = {}) {
        this.broadcasts.set(userId, text);
        this.sessions.set(userId, { ...data, ownerId: data.ownerId || userId });
        clearTimeout(this._timers.get(userId));
        this._timers.set(userId, setTimeout(() => {
            this.broadcasts.delete(userId);
            this.sessions.delete(userId);
            this._timers.delete(userId);
            logger.debug(`Session auto-expired: ${userId}`);
        }, SESSION_TTL));
    }

    clearBroadcastSession(userId) {
        this.broadcasts.delete(userId);
        this.sessions.delete(userId);
        clearTimeout(this._timers.get(userId));
        this._timers.delete(userId);
    }

    getBroadcastText(userId) {
        return this.broadcasts.get(userId);
    }

    getSession(userId) {
        return this.sessions.get(userId);
    }

    ownsSession(userId) {
        return this.getSession(userId)?.ownerId === userId;
    }

    buildTypePicker(text, guild) {
        return buildContainer(config.colors.main,
            headerSection(guild, `**## Choose Message Type**`, '- اختر طريقة إرسال الرسالة. يمكنك إرسال نص عادي أو Embed منسق بعنوان ولون صورة البوت.'),
            sep(),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bc_type_normal').setEmoji(config.emojis.msg).setLabel('Normal').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('bc_type_embed').setEmoji(config.emojis.emmsg).setLabel('Embed').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('bc_cancel').setEmoji(config.emojis.cancel).setLabel('Cancel').setStyle(ButtonStyle.Danger)
            )
        );
    }

    buildBcPanel(text, msgType = 'normal', guild) {
        return buildContainer(config.colors.main,
            headerSection(guild, `**## Broadcast Control**`, '- اختر الفئة المستهدفة.'),
            sep(),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('target_all').setEmoji(config.emojis.members).setLabel('All Members').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('target_online').setEmoji(config.emojis.online).setLabel('Online').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('target_offline').setEmoji(config.emojis.offline).setLabel('Offline').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('target_person').setEmoji(config.emojis.person).setLabel('User').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('target_role').setLabel('Role').setStyle(ButtonStyle.Secondary)
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('target_exclude_role').setLabel('Exclude Role').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('bc_cancel').setEmoji(config.emojis.cancel).setLabel('Cancel').setStyle(ButtonStyle.Danger)
            )
        );
    }

    buildConfirmPanel(text, targetLabel, count, msgType = 'normal', guild) {
        return buildContainer(config.colors.main,
            headerSection(guild, `**## Broadcast Preview**`, `- راجع المعاينة ثم أكد الإرسال.`),
            sep(false),
            txt(`**الفئة المستهدفة:** ${targetLabel}
**عدد المستلمين:** ${count}
**نوع الرسالة:** ${msgType === 'embed' ? 'Embed' : 'Normal'}

**المعاينة:**
${String(text).slice(0, 600)}`),
            sep(),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bc_edit').setLabel('Edit').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('bc_confirm').setEmoji(config.emojis.done).setLabel('Confirm').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('bc_cancel').setEmoji(config.emojis.cancel).setLabel('Cancel').setStyle(ButtonStyle.Danger)
            )
        );
    }

    buildFinalConfirmPanel(guild, count) {
        return buildContainer(config.colors.warning,
            headerSection(guild, '**## Final Confirmation**', `- سيتم إرسال الرسالة إلى **${count}** عضو. لا يمكن التراجع بعد البدء.`),
            sep(),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bc_confirm_final').setLabel('Start Broadcast').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('bc_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
            )
        );
    }

    async handleButton(interaction) {
        try {
            const id     = interaction.customId;
            const userId = interaction.user.id;

            if (!canUse(interaction.member)) {
                return interaction.reply({ content: 'هذا التحكم متاح للمالكين فقط.', flags: MessageFlags.Ephemeral }).catch(() => null);
            }

            if (id === 'cp_bc') {
                if (!canUse(interaction.member)) return;

                return interaction.showModal(
                    new ModalBuilder()
                        .setCustomId('modal_bc')
                        .setTitle('Broadcast Message')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('bc_text')
                                    .setLabel('رسالتك')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('اكتب رسالة الإرسال هنا...')
                                    .setMaxLength(MAX_BC_LEN)
                                    .setRequired(true)
                            ),
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('bc_image')
                                    .setLabel('رابط الصورة (اختياري)')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('https://example.com/image.png')
                                    .setMaxLength(512)
                                    .setRequired(false)
                            )
                        )
                );
            }

            if (id === 'cp_Nova_Realm') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                return interaction.editReply({
                    components: [await botStatusContainer(interaction.guild)],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            if (id === 'cp_history') {
                const entries = history.list().slice(0, 10);
                const body = entries.length
                    ? entries.map(entry => `**${entry.id}** — ${entry.status}\nالإجمالي: ${entry.total} | نجاح: ${entry.success} | فشل: ${entry.failed}`).join('\n\n')
                    : 'لا يوجد سجل عمليات حتى الآن.';
                return interaction.reply({ components: [buildContainer(config.colors.main, headerSection(interaction.guild, '**## History**', body))], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (id === 'bc_close') {
                return interaction.update({ components: [], flags: MessageFlags.IsComponentsV2 });
            }

            if (id === 'bc_details') {
                const result = engine.lastResult;
                if (!result) return interaction.reply({ content: 'لا توجد تفاصيل محفوظة لهذه العملية.', flags: MessageFlags.Ephemeral });
                const reasons = Object.entries(result.failureReasons || {}).map(([reason, count]) => `- ${reason}: ${count}`).join('\n') || 'لا يوجد';
                return interaction.reply({ content: `**Operation Details**\nرقم العملية: \`${result.operationId}\`\nتم الإرسال: ${result.successCount}\nالفشل: ${result.failureCount}\n\n**الأسباب:**\n${reasons}`, flags: MessageFlags.Ephemeral });
            }

            if (id === 'bc_retry_failed') {
                const context = engine.lastContext;
                const result = engine.lastResult;
                if (!context || !result || context.ownerId !== userId) return interaction.reply({ content: 'لا يمكنك إعادة إرسال هذه العملية.', flags: MessageFlags.Ephemeral });
                const failed = new Set(result.failedMembers || []);
                const members = new Map(context.members.filter(member => failed.has(member.id)).map(member => [member.id, member]));
                if (!members.size) return interaction.reply({ content: 'لا توجد أعضاء فاشلون لإعادة الإرسال.', flags: MessageFlags.Ephemeral });
                if (engine.isBusy()) {
                    return interaction.reply({ content: 'توجد عملية أخرى قيد التنفيذ؛ لن يتم تشغيل محاولة مكررة.', flags: MessageFlags.Ephemeral });
                }
                await interaction.deferUpdate();
                return engine.startBroadcast({ ...context, interaction, members, bypassCooldown: true });
            }

            if (id === 'bc_pause' || id === 'bc_resume' || id === 'bc_cancel_active' || id === 'bc_refresh') {
                const operation = engine.getOperation();
                if (!operation || operation.ownerId !== userId) return interaction.reply({ content: 'لا توجد عملية نشطة تخصك.', flags: MessageFlags.Ephemeral });
                if (id === 'bc_pause') engine.pause();
                if (id === 'bc_resume') engine.resume();
                if (id === 'bc_cancel_active') engine.cancel();
                return interaction.reply({ content: id === 'bc_refresh' ? 'تم تحديث الإحصائيات.' : 'تم تحديث حالة العملية.', flags: MessageFlags.Ephemeral });
            }

            if (id === 'bc_cancel') {
                if (!this.ownsSession(userId)) {
                    return interaction.reply({ content: 'هذه الجلسة ليست لك أو انتهت صلاحيتها.', flags: MessageFlags.Ephemeral });
                }
                this.clearBroadcastSession(userId);
                return interaction.update({
                    components: [buildContainer(config.colors.canceled, txt('Done canceled'))],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const broadcastText = this.getBroadcastText(userId);
            if (!broadcastText)
                return interaction.reply({ content: ' انتهت الجلسة. يرجى البدء من جديد.', flags: MessageFlags.Ephemeral });

            if (!this.ownsSession(userId)) {
                return interaction.reply({ content: 'هذه الجلسة ليست لك أو انتهت صلاحيتها.', flags: MessageFlags.Ephemeral });
            }

            if (id === 'bc_edit') {
                return interaction.showModal(new ModalBuilder()
                    .setCustomId('modal_bc_edit')
                    .setTitle('Edit Broadcast')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('bc_text').setLabel('رسالتك').setStyle(TextInputStyle.Paragraph).setMaxLength(MAX_BC_LEN).setRequired(true)
                    )));
            }

            if (id === 'bc_confirm') {
                const session = this.getSession(userId);
                return interaction.update({
                    components: [this.buildFinalConfirmPanel(interaction.guild, session.targetMembers.size)],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            if (id === 'bc_confirm_final') {
                return this._handleConfirm(interaction);
            }

            if (id === 'bc_type_normal') {
                const prev = this.getSession(userId) || {};
                this.setBroadcastSession(userId, broadcastText, { ...prev, msgType: 'normal' });
                return interaction.update({
                    components: [this.buildBcPanel(broadcastText, 'normal', interaction.guild)],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            if (id === 'bc_type_embed') {
                return interaction.showModal(
                    new ModalBuilder()
                        .setCustomId('modal_embed_opts')
                        .setTitle('Embed Options')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('embed_title')
                                    .setLabel('عنوان الـ Embed')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g. Announcement')
                                    .setMaxLength(256)
                                    .setRequired(true)
                            ),
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('embed_footer')
                                    .setLabel('نص التذييل (اختياري)')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('اكتب نص التذييل')
                                    .setMaxLength(256)
                                    .setRequired(false)
                            ),
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('embed_link')
                                    .setLabel('رابط الزر (اختياري)')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g. https://discord.gg/z77Akyq2EE')
                                    .setMaxLength(512)
                                    .setRequired(false)
                            ),
                        )
                );
            }

            if (id === 'target_role' || id === 'target_exclude_role') {
                return interaction.showModal(new ModalBuilder()
                    .setCustomId(id === 'target_role' ? 'modal_target_role' : 'modal_exclude_role')
                    .setTitle(id === 'target_role' ? 'Select Role' : 'Exclude Role')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('role_input').setLabel('اسم الدور أو معرّفاته مفصولة بفاصلة').setPlaceholder('Role 1, Role 2').setStyle(TextInputStyle.Short).setRequired(true)
                    )));
            }

            if (id === 'target_person') {
                return interaction.showModal(
                    new ModalBuilder()
                        .setCustomId('modal_target_person')
                        .setTitle('User')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('person_user')
                                    .setLabel('المستخدم (المعرّف أو الاسم)')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('أدخل معرّف المستخدم أو اسمه...')
                                    .setMaxLength(100)
                                    .setRequired(true)
                            )
                        )
                );
            }

            if (id.startsWith('target_')) {
                await this._handleTargetSelect(interaction, id.replace('target_', ''), broadcastText);
                return;
            }

        } catch (e) {
            logger.error(`handleButton: ${e.message}`, e);
            if (!interaction.replied && !interaction.deferred)
                interaction.reply({ content: ' حدث خطأ. يرجى المحاولة مرة أخرى.', flags: MessageFlags.Ephemeral });
        }
    }

    async handleModal(interaction) {
        try {
            if (!canUse(interaction.member)) {
                return interaction.reply({ content: 'هذا التحكم متاح للمالكين فقط.', flags: MessageFlags.Ephemeral }).catch(() => null);
            }

            if (interaction.customId === 'modal_bc') {
                const text   = interaction.fields.getTextInputValue('bc_text').trim();
                const imageUrl = interaction.fields.getTextInputValue('bc_image').trim() || null;
                const userId = interaction.user.id;

                if (!text)
                    return interaction.reply({ content: ' لا يمكن أن تكون الرسالة فارغة.', flags: MessageFlags.Ephemeral });
                if (text.length > MAX_BC_LEN)
                    return interaction.reply({ content: ` Message too long! Max is **${MAX_BC_LEN}** chars. Yours is **${text.length}**.`, flags: MessageFlags.Ephemeral });
                if (imageUrl && !/^https?:\/\/.+\.(?:png|jpe?g|gif|webp)(?:\?.*)?$/i.test(imageUrl))
                    return interaction.reply({ content: ' رابط الصورة غير صالح. استخدم رابط صورة مباشر ينتهي بـ png أو jpg أو gif أو webp.', flags: MessageFlags.Ephemeral });

                this.setBroadcastSession(userId, text, { guildId: interaction.guild?.id, imageUrl });

                await interaction.reply({ components: [this.buildTypePicker(text, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
                logger.info(`Modal bc by ${interaction.user.tag}`);
                return;
            }

            if (interaction.customId === 'modal_bc_edit') {
                const userId = interaction.user.id;
                if (!this.ownsSession(userId)) return interaction.reply({ content: 'هذه الجلسة ليست لك أو انتهت صلاحيتها.', flags: MessageFlags.Ephemeral });
                const text = interaction.fields.getTextInputValue('bc_text').trim();
                if (!text) return interaction.reply({ content: 'لا يمكن أن تكون الرسالة فارغة.', flags: MessageFlags.Ephemeral });
                const session = this.getSession(userId) || {};
                this.setBroadcastSession(userId, text, session);
                await interaction.deferUpdate();
                return interaction.message.edit({ components: [this.buildBcPanel(text, session.msgType || 'normal', interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            }

            if (interaction.customId === 'modal_target_role' || interaction.customId === 'modal_exclude_role') {
                const userId = interaction.user.id;
                if (!this.ownsSession(userId)) return interaction.reply({ content: 'هذه الجلسة ليست لك أو انتهت صلاحيتها.', flags: MessageFlags.Ephemeral });
                const text = this.getBroadcastText(userId);
                const session = this.getSession(userId) || {};
                const inputs = interaction.fields.getTextInputValue('role_input').split(',').map(value => value.trim().replace(/[<@&>]/g, '')).filter(Boolean);
                const roles = inputs.map(input => interaction.guild.roles.cache.get(input) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === input.toLowerCase())).filter(Boolean);
                if (!roles.length || roles.length !== inputs.length) return interaction.reply({ content: 'لم أجد واحدًا أو أكثر من الأدوار في السيرفر.', flags: MessageFlags.Ephemeral });
                await interaction.guild.members.fetch();
                const all = interaction.guild.members.cache.filter(m => !m.user.bot);
                const members = interaction.customId === 'modal_target_role'
                    ? all.filter(m => roles.some(role => m.roles.cache.has(role.id)))
                    : all.filter(m => roles.every(role => !m.roles.cache.has(role.id)));
                const roleNames = roles.map(role => role.name).join(', ');
                this.setBroadcastSession(userId, text, { ...session, targetMembers: members, targetLabel: interaction.customId === 'modal_target_role' ? `Role: ${roleNames}` : `All Members (excluding ${roleNames})` });
                await interaction.deferUpdate();
                return interaction.message.edit({ components: [this.buildConfirmPanel(text, this.getSession(userId).targetLabel, members.size, session.msgType || 'normal', interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            }

            if (interaction.customId === 'modal_embed_opts') {
                const userId      = interaction.user.id;
                if (!this.ownsSession(userId)) {
                    return interaction.reply({ content: 'هذه الجلسة ليست لك أو انتهت صلاحيتها.', flags: MessageFlags.Ephemeral });
                }
                const embedTitle  = interaction.fields.getTextInputValue('embed_title').trim();
                const embedFooter = interaction.fields.getTextInputValue('embed_footer').trim() || null;
                const embedLink   = interaction.fields.getTextInputValue('embed_link').trim() || null;
                const embedColor  = config.colors.main;

                if (embedLink && !/^https?:\/\/.+/.test(embedLink)) {
                    return interaction.reply({ content: ' الرابط غير صالح. يجب أن يبدأ بـ `https://` أو `http://`.', flags: MessageFlags.Ephemeral });
                }
                const broadcastText = this.getBroadcastText(userId);
                if (!broadcastText)
                    return interaction.reply({ content: ' انتهت الجلسة. يرجى البدء من جديد.', flags: MessageFlags.Ephemeral });

                const prev = this.getSession(userId) || {};
                this.setBroadcastSession(userId, broadcastText, {
                    ...prev,
                    msgType:    'embed',
                    embedTitle,
                    embedColor,
                    embedFooter,
                    embedLink,
                    embedImage: prev.imageUrl || null
                });

                await interaction.deferUpdate();
                await interaction.message.edit({
                    components: [this.buildBcPanel(broadcastText, 'embed', interaction.guild)],
                    flags: MessageFlags.IsComponentsV2
                });
                logger.info(`Embed opts set by ${interaction.user.tag}: "${embedTitle}" footer="${embedFooter}" link="${embedLink}"`);
                return;
            }

            if (interaction.customId === 'modal_target_person') {
                const userId = interaction.user.id;
                if (!this.ownsSession(userId)) {
                    return interaction.reply({ content: 'هذه الجلسة ليست لك أو انتهت صلاحيتها.', flags: MessageFlags.Ephemeral });
                }
                const broadcastText = this.getBroadcastText(userId);
                if (!broadcastText) {
                    return interaction.reply({ content: ' انتهت الجلسة. يرجى البدء من جديد.', flags: MessageFlags.Ephemeral });
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const input = interaction.fields.getTextInputValue('person_user').trim();
                const cleanId = input.replace(/[<@!>]/g, '');

                let targetMember = null;
                if (/^\d{17,20}$/.test(cleanId)) {
                    targetMember = await interaction.guild.members.fetch(cleanId).catch(() => null);
                }

                if (!targetMember) {
                    try {
                        const searchResults = await interaction.guild.members.search({ query: input, limit: 5 });
                        if (searchResults?.size > 0) {
                            targetMember = searchResults.find(m =>
                                m.user.username.toLowerCase() === input.toLowerCase() ||
                                m.user.tag.toLowerCase() === input.toLowerCase() ||
                                m.displayName.toLowerCase() === input.toLowerCase()
                            ) || searchResults.first();
                        }
                    } catch (e) {
                        logger.debug(`Member search failed: ${e.message}`);
                    }
                }

                if (!targetMember) {
                    targetMember = interaction.guild.members.cache.find(m =>
                        m.id === cleanId ||
                        m.user.username.toLowerCase() === input.toLowerCase() ||
                        m.user.tag.toLowerCase() === input.toLowerCase() ||
                        m.displayName.toLowerCase() === input.toLowerCase()
                    );
                }

                if (!targetMember) {
                    return interaction.editReply({
                        components: [buildContainer(config.colors.error,
                            headerSection(interaction.guild, `**## User Not Found**`, `- Please check the server and enter the correct user.`),
                            sep()
                        )],
                        flags: MessageFlags.IsComponentsV2
                    });
                }

                if (targetMember.user.bot) {
                    return interaction.editReply({
                        components: [buildContainer(config.colors.error,
                            headerSection(interaction.guild, `**## Invalid User**`, `- Cannot send a direct message to a bot.`),
                            sep()
                        )],
                        flags: MessageFlags.IsComponentsV2
                    });
                }

                const session     = this.getSession(userId) || {};
                const msgType     = session.msgType || 'normal';
                const embedTitle  = session.embedTitle || null;
                const embedColor  = session.embedColor || config.colors.main;
                const embedFooter = session.embedFooter || null;
                const embedLink   = session.embedLink || null;

                const payload = engine._buildPayload(
                    broadcastText,
                    msgType,
                    embedTitle,
                    embedColor,
                    embedFooter,
                    interaction.guild,
                    embedLink
                );

                let sent = false;
                let sendError = null;

                try {
                    await engine._sendToMember(targetMember, payload);
                    sent = true;
                } catch (err) {
                    sendError = engine._failureReason(err);
                }

                if (sent) {
                    this.clearBroadcastSession(userId);

                    if (interaction.message?.editable) {
                        await interaction.message.edit({
                            components: [buildContainer(config.colors.success,
                                headerSection(interaction.guild, `**## Message Delivered**`, `- The broadcast message has been sent successfully to **<@${targetMember.id}>**. The recipient has been notified, and the broadcast process has been completed successfully.`),
                                sep(false),
                                txt(`**Recipient:** <@${targetMember.id}>\n**Type:** ${msgType === 'embed' ? 'Embed' : 'Normal'}`),
                                sep()
                            )],
                            flags: MessageFlags.IsComponentsV2
                        }).catch(() => null);
                    }

                    return interaction.editReply({
                        components: [buildContainer(config.colors.success,
                            headerSection(interaction.guild, `**## Message Sent**`, `- Message successfully sent to **<@${targetMember.id}>**!`),
                            sep()
                        )],
                        flags: MessageFlags.IsComponentsV2
                    });
                } else {
                    return interaction.editReply({
                        components: [buildContainer(config.colors.error,
                            headerSection(interaction.guild, `**## Delivery Failed**`, `- Could not send message to **<@${targetMember.id}>**. Their DMs may be closed or all connected bots were rejected.`),
                            sep(false),
                            txt(`**Recipient:** <@${targetMember.id}>\n**Error:** ${sendError || 'DMs closed'}`),
                            sep()
                        )],
                        flags: MessageFlags.IsComponentsV2
                    });
                }
            }

        } catch (e) { logger.error(`handleModal: ${e.message}`, e); }
    }

    async handleSelect(interaction) {
        logger.debug(`Select menu: ${interaction.customId}`);
    }

    async _handleTargetSelect(interaction, target, broadcastText) {
        await interaction.guild.members.fetch({ withPresences: true });
        const all = interaction.guild.members.cache.filter(m => !m.user.bot);

        let targetMembers, targetLabel;
        switch (target) {
            case 'all':
                targetMembers = all;
                targetLabel   = `All Members`;
                break;
            case 'online':
                targetMembers = all.filter(m => m.presence && ['online', 'idle', 'dnd'].includes(m.presence.status));
                targetLabel   = `Online Members`;
                break;
            case 'offline':
                targetMembers = all.filter(m => !m.presence || m.presence.status === 'offline');
                targetLabel   = `Offline Members`;
                break;
            default: return;
        }

        const prev    = this.getSession(interaction.user.id) || {};
        const msgType = prev.msgType || 'normal';
        this.setBroadcastSession(interaction.user.id, broadcastText, { ...prev, targetMembers, targetLabel });

        await interaction.update({
            components: [this.buildConfirmPanel(broadcastText, targetLabel, targetMembers.size, msgType, interaction.guild)],
            flags: MessageFlags.IsComponentsV2
        });
        logger.info(`الهدف: ${targetLabel} (${targetMembers.size}) by ${interaction.user.tag}`);
    }

    async _handleConfirm(interaction) {
        const userId  = interaction.user.id;
        const text    = this.getBroadcastText(userId);
        const session = this.getSession(userId);

        if (!text || !session?.targetMembers) {
            return interaction.update({
                components: [buildContainer(config.colors.error,
                    headerSection(interaction.guild, `**## Session Expired**`, '- Your session has expired. Please start over from the control panel.')
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const cooldown = engine.getBroadcastCooldown(interaction.guild?.id);
        if (cooldown > 0) {
            return interaction.update({
                components: [buildContainer(config.colors.warning,
                    headerSection(interaction.guild, '**## Broadcast Cooldown**'),
                    txt(`لا يمكنك بدء برودكاست جديد الآن. الوقت المتبقي: **${formatCooldown(cooldown)}**.`)
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        await interaction.update({
            components: [buildContainer(config.colors.warning,
                headerSection(interaction.guild, `**## Processing Broadcast**`, `- Starting broadcast to **${session.targetMembers.size}** أعضاء...`)
            )],
            flags: MessageFlags.IsComponentsV2
        });

        const savedText    = text;
        const savedMembers = session.targetMembers;
        const savedType    = session.msgType     || 'normal';
        const embedTitle   = session.embedTitle  || null;
        const embedColor   = session.embedColor  || config.colors.main;
        const embedFooter  = session.embedFooter || null;
        const embedLink    = session.embedLink   || null;
        this.clearBroadcastSession(userId);

        const result = await engine.startBroadcast({
            interaction,
            members: savedMembers,
            message: savedText,
            msgType: savedType,
            embedTitle,
            embedColor,
            embedFooter,
            embedLink,
            embedImage: session.embedImage || session.imageUrl || null,
            ownerId: userId,
            targetLabel: session.targetLabel || 'الفئة المستهدفة'
        });

        if (result?.busy) {
            return interaction.message?.edit({ components: [buildContainer(config.colors.warning, headerSection(interaction.guild, '**## Broadcast Busy**', '- توجد عملية برودكاست قيد التنفيذ بالفعل.'))], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
        }

        if (result?.cooldown) {
            await interaction.message?.edit({
                components: [buildContainer(config.colors.warning,
                    headerSection(interaction.guild, '**## Broadcast Cooldown**'),
                    txt(`لا يمكنك بدء برودكاست جديد الآن. الوقت المتبقي: **${formatCooldown(result.remaining)}**.`)
                )],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => null);
        }
    }
}

module.exports = new CommandRouter();
