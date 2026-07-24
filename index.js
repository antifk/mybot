const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AuditLogEvent, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const config = require('./config.json');
let stories = require('./stories.json');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User]
});

// Variável para Anti-Raid
const recentJoins = [];

// Trackers para Anti-Move e Anti-Disconnect
const moveTracker = new Map(); // { executorId: [timestamps] }
const disconnectTracker = new Map(); // { executorId: [timestamps] }

// Helper para salvar a config
const saveConfig = () => {
    try {
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
    } catch (err) {
        // console.error("Erro ao salvar config:", err);
    }
};

// Helper para salvar stories
const saveStories = () => {
    try {
        fs.writeFileSync(path.join(__dirname, 'stories.json'), JSON.stringify(stories, null, 2));
    } catch (err) {
        // console.error("Erro ao salvar stories:", err);
    }
};

// Helper para limpar stories antigos (mais de 30 dias)
const cleanOldStories = () => {
    const now = Date.now();
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000; // 30 dias em milissegundos
    let cleanedCount = 0;

    Object.keys(stories).forEach(storyId => {
        const story = stories[storyId];
        if (story.createdAt && (now - story.createdAt) > thirtyDaysInMs) {
            // Deleta o arquivo local se existir
            if (story.localPath && fs.existsSync(story.localPath)) {
                try {
                    fs.unlinkSync(story.localPath);
                    cleanedCount++;
                } catch (err) {
                    // console.error("Erro ao deletar arquivo antigo:", err);
                }
            }
            // Remove do banco de dados
            delete stories[storyId];
        }
    });

    if (cleanedCount > 0) {
        saveStories();
        console.log(`${cleanedCount} stories antigos foram limpos.`);
    }
};

// Helper para criar mensagens em container (Components v2)
const createContainerMessage = (content, ephemeral = false) => ({
    "components": [
        {
            "type": 17,
            "accent_color": null,
            "spoiler": false,
            "components": [
                {
                    "type": 10,
                    "content": content
                }
            ]
        }
    ],
    "flags": ephemeral ? 32832 : 32768 // 32768 (v2) | 64 (ephemeral) = 32832
});

client.once('ready', async () => {
    console.log(`Bot online como ${client.user.tag}`);

    // Limpa stories antigos (mais de 30 dias) ao iniciar
    cleanOldStories();

    // Configura limpeza automática a cada 30 minutos
    setInterval(() => {
        cleanOldStories();
    }, 30 * 60 * 1000); // 30 minutos

    // 🔐 Painel de verificação automático
    try {
        const channel = await client.channels.fetch(config.verifyPanelChannelId);
        if (!channel) return;

        // evita duplicar painel ao reiniciar
        const messages = await channel.messages.fetch({ limit: 10 });
        const alreadySent = messages.some(m => m.author.id === client.user.id);

        if (!alreadySent) {
            await channel.send(verificationPanel);
        }
    } catch (err) {
        // erro silencioso (canal inexistente / permissão)
    }
});

const verificationPanel = {
  components: [
    {
      type: 17,
      components: [
        {
          type: 10,
          content:
            "> **Sistema de Verificação**\n" +
            "> Para iniciar sua verificação, clique no botão abaixo."
        },
        {
          type: 14,
          divider: true
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: "Solicitar verificação",
              custom_id: "verify_start"
            }
          ]
        }
      ]
    }
  ],
  flags: 32768
};

const selectVerifierPanel = {
  components: [
    {
      type: 17,
      components: [
        {
          type: 10,
          content: "> Selecione quem irá te verificar:"
        },
        {
          type: 14,
          divider: true
        },
        {
          type: 1,
          components: [
            {
              type: 7,
              custom_id: "verify_select",
              placeholder: "Selecione alguém ou um cargo",
              min_values: 1,
              max_values: 1
            }
          ]
        }
      ]
    }
  ],
  flags: 32832 // ephemeral
};


// Comando por prefixo para enviar o painel de suporte
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(config.prefix)) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Comando: gde!nuke (Nuke)
    if (command === 'nuke') {
        // Verifica permissão (Administrator ou ManageChannels)
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(createContainerMessage('Você não tem permissão para usar este comando.', true));
        }

        try {
            // Clona o canal com todas as configurações
            const newChannel = await message.channel.clone();
            
            // Deleta o canal antigo
            await message.channel.delete();

            // Envia a mensagem no novo canal
            await newChannel.send(createContainerMessage(`> O usuário **${message.author.username}** deu nuke no chat`));

        } catch (error) {
            // console.error(error);
        }
        return;
    }

    // Comando: gde!cl (Clear)
    if (command === 'clear') {
        // Verifica permissão (ManageMessages)
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(createContainerMessage('Você não tem permissão para usar este comando.', true));
        }

        try {
            // Apaga até 100 mensagens
            await message.channel.bulkDelete(100, true);
            
            // Envia mensagem de confirmação e apaga depois de 5s
            const msg = await message.channel.send(createContainerMessage(`> O chat foi limpo por ${message.author}`));
            setTimeout(() => msg.delete().catch(() => {}), 3000);

        } catch (error) {
            // console.error(error);
            message.reply(createContainerMessage('Erro ao limpar mensagens. Verifique se as mensagens têm mais de 14 dias.', true));
        }
        return;
    }

    // Comando: gde!ban <id> <motivo>
    if (command === 'ban') {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply(createContainerMessage('Você não tem permissão para banir membros.', true));
        }

        let userId = args[0]?.replace(/[<@!>]/g, '');

        const reason = args.slice(1).join(' ') || 'Sem motivo especificado';

        if (!userId) {
            return message.reply(createContainerMessage('Por favor, forneça o ID do usuário.', true));
        }

        // Tenta buscar o usuário para mostrar o nome (opcional, pode falhar se não estiver no cache/servidor)
        let userTag = userId;
        try {
            const user = await client.users.fetch(userId);
            userTag = `${user.tag} (${user.id})`;
        } catch (e) {
            userTag = userId;
        }

        const confirmPanel = {
            "components": [
                {
                    "type": 17,
                    "accent_color": null,
                    "spoiler": false,
                    "components": [
                        {
                            "type": 10,
                            "content": `>  **Confirmação de Banimento**\n> **Usuário:** ${userTag}\n> **Solicitado por:** ${message.author.tag}\n> **Motivo:** ${reason}\n> Deseja realmente banir este usuário?`
                        },
                        {
                            "type": 14,
                            "spacing": 1,
                            "divider": true
                        },
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "style": 3, // Green
                                    "label": "Confirmar",
                                    "custom_id": "ban_confirm",
                                    "emoji": { "name": "✅", "id": null }
                                },
                                {
                                    "type": 2,
                                    "style": 4, // Red
                                    "label": "Cancelar",
                                    "custom_id": "ban_cancel",
                                    "emoji": { "name": "✖️", "id": null }
                                }
                            ]
                        }
                    ]
                }
            ],
            "flags": 32768
        };

        const msg = await message.reply(confirmPanel);

const filter = i =>
    (i.customId === 'ban_confirm' || i.customId === 'ban_cancel') &&
    i.user.id === message.author.id;

const collector = msg.createMessageComponentCollector({
    filter,
    time: 60000,
    max: 1
});

collector.on('collect', async i => {
    if (i.customId === 'ban_confirm') {
        try {
            await message.guild.members.ban(userId, { reason });

            await i.update(
                createContainerMessage(
                    `> 🔨 **Banido!**\n> O usuário ${userTag} foi banido com sucesso.\n> **Motivo:** ${reason}`
                )
            );

            const banLogPanel = {
                components: [
                    {
                        type: 17,
                        accent_color: null,
                        spoiler: false,
                        components: [
                            {
                                type: 10,
                                content:
                                    `> **Log de Banimento**\n` +
                                    `> **Usuário:** ${userTag}\n` +
                                    `> **Responsável:** ${message.author.tag} (${message.author.id})\n` +
                                    `> **Motivo:** ${reason}\n` +
                                    `> **Data:** <t:${Math.floor(Date.now() / 1000)}:f>`
                            },
                            {
                                type: 14,
                                spacing: 1,
                                divider: true
                            }
                        ]
                    }
                ],
                flags: 32768
            };

            // log separado, sem interaction
            await sendLog(message.guild, banLogPanel, config.logs.ban);

        } catch (error) {
            console.error(error);

            if (!i.replied && !i.deferred) {
                await i.update(
                    createContainerMessage(
                        `> ❌ **Erro**\n> Não foi possível banir o usuário.\n> ${error.message || ''}`
                    )
                );
            }
        }
    } else {
        await i.update(
            createContainerMessage(
                `> 🚫 **Cancelado**\n> O banimento foi cancelado.`
            )
        );
    }

    setTimeout(() => msg.delete().catch(() => {}), 5000);
});


collector.on('end', collected => {
    if (collected.size === 0) {
        msg.edit(
            createContainerMessage(
                `> ⏰ **Tempo Esgotado**\n> A confirmação de banimento expirou.`
            )
        ).catch(() => {});
        setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
});
        return;
    }

    // Comando: gde!groles (Gerenciar Cargos)
    if (command === 'groles') {
        // Verifica se mencionou alguém ou passou ID para gerenciar
        let targetMember = message.mentions.members.first();

        if (!targetMember && args[0]) {
            try {
                // Tenta buscar pelo ID (args[0])
                targetMember = await message.guild.members.fetch(args[0]);
            } catch (error) {
                return message.reply(createContainerMessage('Usuário não encontrado com esse ID.', true));
            }
        }

        // Se não mencionou nem passou ID válido, usa o próprio autor
        if (!targetMember) {
            targetMember = message.member;
        }

        await sendRolesPanel(message, 0, targetMember);
        return;
    }

    // Comando: gde!unban <id>
    if (command === 'unban') {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply(createContainerMessage('Você não tem permissão para desbanir membros.', true));
        }

        const userId = args[0];

        if (!userId) {
            return message.reply(createContainerMessage('Por favor, forneça o ID do usuário.', true));
        }

        try {
            await message.guild.members.unban(userId);
            await message.reply(createContainerMessage(`> 🔓 Usuário ${userId} foi desbanido.`));
        } catch (error) {
            // console.error(error);
            await message.reply(createContainerMessage('Não foi possível desbanir o usuário. Verifique o ID ou se ele realmente está banido.', true));
        }
        return;
    }

    // Comando: gde!security ou gde!painel
    if (command === 'security' || command === 'painel') {
        // Check panel access permission
        const hasPanelAccess = message.member.permissions.has(PermissionFlagsBits.Administrator) || 
                               (config.security.roles_allowed_panel && message.member.roles.cache.some(r => config.security.roles_allowed_panel.includes(r.id)));

        if (!hasPanelAccess) {
            return message.reply(createContainerMessage('Você não tem permissão para usar este comando.'));
        }

        const statusAntiraid = config.security.antiraid ? "Ativado" : "Desativado";
        const statusAntiChannel = config.security.anti_channel_delete ? "Ativado" : "Desativado";
        const statusAntiInvite = config.security.anti_invite ? "Ativado" : "Desativado";
        
        // Helper to format lists
        const formatList = (list) => list.length > 0 ? list.map(id => { const r = message.guild.roles.cache.get(id); return r ? r.name : id; }).join(', ') : "Nenhum";

        const protectedRolesList = formatList(config.security.protected_roles);
        const allowedDeleteList = formatList(config.security.roles_allowed_delete_channels);
        const allowedEveryoneList = formatList(config.security.roles_allowed_mention_everyone);
        const allowedPanelList = formatList(config.security.roles_allowed_panel);

        const panel = {
            "components": [
                {
                    "type": 17,
                    "accent_color": null,
                    "spoiler": false,
                    "components": [
                        {
                            "type": 10,
                            "content": `> ## Painel de Segurança\n> **Anti-Raid:** ${statusAntiraid}\n> **Anti-Delete Canal:** ${statusAntiChannel}\n> **Anti-Invite:** ${statusAntiInvite}\n> **Cargos Protegidos (Anti-Role):**\n> ${protectedRolesList}\n> **Permitidos Excluir Canais:**\n> ${allowedDeleteList}\n> **Permitidos Mention Everyone:**\n> ${allowedEveryoneList}\n> **Acesso ao Painel:**\n> ${allowedPanelList}`
                        },
                        {
                            "type": 14,
                            "spacing": 1,
                            "divider": true
                        },
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "style": config.security.antiraid ? 4 : 3, 
                                    "custom_id": "toggle_antiraid",
                                    "label": "Anti-Raid",
                                    "emoji": null,
                                    "disabled": false
                                },
                                {
                                    "type": 2,
                                    "style": config.security.anti_channel_delete ? 4 : 3, 
                                    "custom_id": "toggle_antichannel",
                                    "label": "Anti-Delete Canal",
                                    "emoji": null,
                                    "disabled": false
                                },
                                {
                                    "type": 2,
                                    "style": config.security.anti_invite ? 4 : 3, 
                                    "custom_id": "toggle_antiinvite",
                                    "label": "Anti-Invite",
                                    "emoji": null,
                                    "disabled": false
                                },
                                {
                                    "type": 2,
                                    "style": 1,
                                    "custom_id": "manage_security_menu",
                                    "label": "Gerenciar Cargos",
                                    "emoji": null,
                                    "disabled": false
                                }
                            ]
                        }
                    ]
                }
            ],
            "flags": 32768
        };

        await message.reply(panel);
        return;
    }
    
    // Comando: gde!protect <role_id>
    if (command === 'protect') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const roleId = args[0];
        if (!roleId) return message.reply(createContainerMessage('Forneça o ID do cargo.'));
        
        if (!config.security.protected_roles.includes(roleId)) {
            config.security.protected_roles.push(roleId);
            saveConfig();
            const role = message.guild.roles.cache.get(roleId);
            message.reply(createContainerMessage(`> 🛡️ Cargo ${role ? role.name : roleId} agora está protegido.`));
        } else {
            message.reply(createContainerMessage(`> O cargo já está protegido.`));
        }
        return;
    }
    
    // Comando: gde!whitelist <user_id>
    if (command === 'whitelist') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const userId = args[0];
        if (!userId) return message.reply(createContainerMessage('Forneça o ID do usuário.'));
        
        if (!config.security.whitelist.includes(userId)) {
            config.security.whitelist.push(userId);
            saveConfig();
            message.reply(createContainerMessage(`> 🛡️ Usuário ${userId} adicionado à whitelist.`));
        } else {
            message.reply(createContainerMessage(`> O usuário já está na whitelist.`));
        }
        return;
    }

    // Comando: gde!setup
    if (command === 'setup') {
        // Verifica permissão de administrador
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(createContainerMessage('Você não tem permissão para usar este comando.'));
        }

        // Painel 1 com JSON customizado
        const messageData = {
            "components": [
                {
                    "type": 17,
                    "accent_color": null,
                    "spoiler": false,
                    "components": [
                        {
                            "type": 10,
                            "content": "> ## ant  - helper"
                        },
                        {
                            "type": 14,
                            "spacing": 1,
                            "divider": true
                        },
                        {
                            "type": 12,
                            "items": [
                                {
                                    "media": {
                                        "url": "https://media.discordapp.net/attachments/1478059984322564265/1478061881070452826/5614.webp?ex=69a707e5&is=69a5b665&hm=3125346e5b741c81a5709d70bf445a6607882e07961df77e6d99e98bba917d72&=&format=webp&width=629&height=353   "
                                    },
                                    "description": null,
                                    "spoiler": false
                                }
                            ]
                        },
                        {
                            "type": 14,
                            "spacing": 1,
                            "divider": true
                        },
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "style": 2,
                                    "custom_id": "open_ticket",
                                    "label": "Support",
                                    "emoji": null,
                                    "disabled": false
                                }
                            ]
                        }
                    ]
                }
            ],
            "flags": 32768
        };

        await message.channel.send(messageData);
        await message.delete().catch(() => {}); // Tenta deletar a mensagem do comando
        return;
    }

    // Se o comando não for reconhecido, apaga a mensagem
    await message.delete().catch(() => {});
});

// Interação com Botões, Modais e Menus
client.on('interactionCreate', async interaction => {
    // if (!interaction.isButton()) return; // Removido para suportar Modais e Menus

    // 1. Abrir Ticket
    if (interaction.customId === 'open_ticket') {
        // Verifica se já tem ticket aberto
        const existingChannel = interaction.guild.channels.cache.find(c => c.topic === interaction.user.id);
        if (existingChannel) {
            return interaction.reply(createContainerMessage(`Você já possui um ticket aberto em ${existingChannel}`, true));
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Cria o canal de ticket
            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: '1478061541998985236', // Define a categoria do ticket
                topic: interaction.user.id, // Salva o ID do usuário no tópico para controle
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
                    },
                    {
                        id: config.staffRoleId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                    }
                ],
            });

            // Envia as menções separadamente
            await channel.send({ content: ` || <@${interaction.user.id}> | <@&${config.staffRoleId}>||` });

            // Painel 2 com JSON customizado
            const controlData = {
                "components": [
                    {
                        "type": 17,
                        "accent_color": null,
                        "spoiler": false,
                        "components": [
                            {
                                "type": 10,
                                "content": "> Utilize esse canal privado para solucionar seus problemas ou dúvidas dentro do servidor, seja breve e aguarde."
                            },
                            {
                                "type": 14,
                                "spacing": 1,
                                "divider": true
                            },
                            {
                                "type": 12,
                                "items": [
                                    {
                                        "media": {
                                            "url": "https://cdn.discordapp.com/attachments/1458189898136813807/1461758171747192842/84_Sem_Titulo9_20251221071708.png?ex=696bb7e2&is=696a6662&hm=4156ddd336a275a79125d3b0747a4d4ee29ee33593b78e7720d122df5344a9f7&"
                                        },
                                        "description": null,
                                        "spoiler": false
                                    }
                                ]
                            },
                            {
                                "type": 14,
                                "spacing": 1,
                                "divider": true
                            },
                            {
                                "type": 1,
                                "components": [
                                    {
                                        "type": 2,
                                        "style": 2,
                                        "custom_id": "claim_ticket",
                                        "label": "Assumir",
                                        "emoji": null,
                                        "disabled": false
                                    },
                                    {
                                        "type": 2,
                                        "style": 2,
                                        "custom_id": "close_ticket",
                                        "label": "Excluir",
                                        "emoji": null,
                                        "disabled": false
                                    }
                                ]
                            }
                        ]
                    }
                ],
                "flags": 32768
            };

            await channel.send(controlData);

            await interaction.editReply(createContainerMessage(`Seu ticket foi criado com sucesso: ${channel}`));

        } catch (error) {
            // console.error(error);
            await interaction.editReply(createContainerMessage('Ocorreu um erro ao criar o ticket. Verifique as permissões do bot.'));
        }
    }

    // 2. Assumir Ticket
    if (interaction.customId === 'claim_ticket') {
        // Verifica se quem clicou é staff (tem permissão de ver o canal ou tem o cargo)
        if (!interaction.member.roles.cache.has(config.staffRoleId) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply(createContainerMessage('Apenas a equipe pode assumir tickets.', true));
        }

        await interaction.reply(createContainerMessage(`Ticket assumido por ${interaction.user}.`));

        // Atualiza o painel para desabilitar o botão "Assumir"
        const disabledControlData = {
            "components": [
                {
                    "type": 17,
                    "accent_color": null,
                    "spoiler": false,
                    "components": [
                        {
                            "type": 10,
                            "content": "> Utilize esse canal privado para solucionar seus problemas ou dúvidas dentro do servidor, seja breve e aguarde."
                        },
                        {
                            "type": 14,
                            "spacing": 1,
                            "divider": true
                        },
                        {
                            "type": 12,
                            "items": [
                                {
                                    "media": {
                                        "url": "https://cdn.discordapp.com/attachments/1458189898136813807/1461758171747192842/84_Sem_Titulo9_20251221071708.png?ex=696bb7e2&is=696a6662&hm=4156ddd336a275a79125d3b0747a4d4ee29ee33593b78e7720d122df5344a9f7&"
                                    },
                                    "description": null,
                                    "spoiler": false
                                }
                            ]
                        },
                        {
                            "type": 14,
                            "spacing": 1,
                            "divider": true
                        },
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "style": 2,
                                    "custom_id": "claim_ticket",
                                    "label": `Assumido por ${interaction.user.username}`, // Mostra quem assumiu no botão
                                    "emoji": null,
                                    "disabled": true // Desabilita o botão
                                },
                                {
                                    "type": 2,
                                    "style": 2,
                                    "custom_id": "close_ticket",
                                    "label": "Excluir",
                                    "emoji": null,
                                    "disabled": false
                                }
                            ]
                        }
                    ]
                }
            ],
            "flags": 32768
        };
        
        await interaction.message.edit(disabledControlData);
    }

    // 3. Toggle Anti-Raid
    if (interaction.customId === 'toggle_antiraid') {
        // Verifica se o usuário tem permissão (Administrator OU Cargo Permitido no Painel)
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                              interaction.member.roles.cache.some(role => config.security.roles_allowed_panel.includes(role.id));

        if (!hasPermission) {
            return interaction.reply(createContainerMessage('Você não tem permissão para usar este painel.', true));
        }

        config.security.antiraid = !config.security.antiraid;
        saveConfig();
        
        // Re-render panel (simplified for brevity, ideally reuse the render function)
        await interaction.reply(createContainerMessage(`Anti-Raid ${config.security.antiraid ? 'Ativado' : 'Desativado'}. Use o comando novamente para atualizar o painel.`, true));
    }

    // 3.1 Toggle Anti-Channel Delete
    if (interaction.customId === 'toggle_antichannel') {
        // Verifica se o usuário tem permissão (Administrator OU Cargo Permitido no Painel)
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                              interaction.member.roles.cache.some(role => config.security.roles_allowed_panel.includes(role.id));

        if (!hasPermission) {
            return interaction.reply(createContainerMessage('Você não tem permissão para usar este painel.', true));
        }

        config.security.anti_channel_delete = !config.security.anti_channel_delete;
        saveConfig();
        
        await interaction.reply(createContainerMessage(`Anti-Delete Canal ${config.security.anti_channel_delete ? 'Ativado' : 'Desativado'}. Use o comando novamente para atualizar o painel.`, true));
    }

    // 3.4 Toggle Anti-Invite
    if (interaction.customId === 'toggle_antiinvite') {
        // Verifica se o usuário tem permissão (Administrator OU Cargo Permitido no Painel)
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                              interaction.member.roles.cache.some(role => config.security.roles_allowed_panel.includes(role.id));

        if (!hasPermission) {
            return interaction.reply(createContainerMessage('Você não tem permissão para usar este painel.', true));
        }

        config.security.anti_invite = !config.security.anti_invite;
        saveConfig();
        
        await interaction.reply(createContainerMessage(`Anti-Invite ${config.security.anti_invite ? 'Ativado' : 'Desativado'}. Use o comando novamente para atualizar o painel.`, true));
    }

    // 3.2 Manage Security Menu
    if (interaction.customId === 'manage_security_menu') {
        // Verifica se o usuário tem permissão (Administrator OU Cargo Permitido no Painel)
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                              interaction.member.roles.cache.some(role => config.security.roles_allowed_panel.includes(role.id));

        if (!hasPermission) {
            return interaction.reply(createContainerMessage('Você não tem permissão para usar este painel.', true));
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_security_action')
            .setPlaceholder('O que você deseja configurar?')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Adicionar Cargo Protegido').setValue('add_protected_role').setDescription('Impede que este cargo seja dado a alguém.'),
                new StringSelectMenuOptionBuilder().setLabel('Remover Cargo Protegido').setValue('remove_protected_role').setDescription('Remove da lista de proteção.'),
                new StringSelectMenuOptionBuilder().setLabel('Permitir Excluir Canais').setValue('allow_delete_channel').setDescription('Autoriza cargo a excluir canais.'),
                new StringSelectMenuOptionBuilder().setLabel('Permitir Mention Everyone').setValue('allow_mention_everyone').setDescription('Autoriza cargo a marcar @everyone.'),
                new StringSelectMenuOptionBuilder().setLabel('Permitir Acesso ao Painel').setValue('allow_panel_access').setDescription('Autoriza cargo a usar este painel.'),
                new StringSelectMenuOptionBuilder().setLabel('Remover Acesso ao Painel').setValue('remove_panel_access').setDescription('Remove permissão de usar este painel.'),
                new StringSelectMenuOptionBuilder().setLabel('Configurar Gerente de Cargos').setValue('setup_role_manager').setDescription('Define quais cargos um gerente pode atribuir.')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: '> Selecione uma ação:', components: [row], ephemeral: true });
    }

    // 3.3 Handle Security Action Selection
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_security_action') {
        const action = interaction.values[0];

        if (action === 'add_protected_role') {
            // Show Modal
            const modal = new ModalBuilder().setCustomId('submit_protected_role').setTitle('Proteger Cargo');
            const input = new TextInputBuilder().setCustomId('role_id_input').setLabel("ID do Cargo").setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } else if (action === 'remove_protected_role') {
             // Show Menu to Remove
             if (config.security.protected_roles.length === 0) return interaction.reply(createContainerMessage('Lista vazia.', true));
             const menu = new StringSelectMenuBuilder().setCustomId('select_remove_role').setPlaceholder('Selecione para remover').addOptions(config.security.protected_roles.map(id => ({ label: id, value: id })));
             await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        } else if (action === 'allow_delete_channel') {
            const modal = new ModalBuilder().setCustomId('submit_allow_delete').setTitle('Autorizar Excluir Canal');
            const input = new TextInputBuilder().setCustomId('role_id_input').setLabel("ID do Cargo").setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } else if (action === 'allow_mention_everyone') {
            const modal = new ModalBuilder().setCustomId('submit_allow_everyone').setTitle('Autorizar Mention Everyone');
            const input = new TextInputBuilder().setCustomId('role_id_input').setLabel("ID do Cargo").setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } else if (action === 'allow_panel_access') {
            const modal = new ModalBuilder().setCustomId('submit_allow_panel').setTitle('Autorizar Acesso Painel');
            const input = new TextInputBuilder().setCustomId('role_id_input').setLabel("ID do Cargo").setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } else if (action === 'remove_panel_access') {
             if (config.security.roles_allowed_panel.length === 0) return interaction.reply(createContainerMessage('Lista vazia.', true));
             
             const options = config.security.roles_allowed_panel.map(id => {
                 const role = interaction.guild.roles.cache.get(id);
                 return { label: role ? role.name : id, value: id };
             });

             const menu = new StringSelectMenuBuilder().setCustomId('select_remove_panel_access').setPlaceholder('Selecione para remover').addOptions(options);
             await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        } else if (action === 'setup_role_manager') {
            const modal = new ModalBuilder().setCustomId('submit_role_manager_id').setTitle('Configurar Gerente');
            const input = new TextInputBuilder().setCustomId('manager_role_id').setLabel("ID do Cargo Gerente").setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
    }

    // 4. Adicionar Cargo Protegido (Modal)
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'submit_role_manager_id') {
            const managerRoleId = interaction.fields.getTextInputValue('manager_role_id');
            const role = interaction.guild.roles.cache.get(managerRoleId);
            if (!role) return interaction.reply(createContainerMessage('Cargo não encontrado.', true));

            // Lista os primeiros 25 cargos para selecionar (limitação do Discord)
            // Idealmente, deveria ter paginação ou busca, mas para simplificar:
            const roles = interaction.guild.roles.cache
                .filter(r => r.id !== interaction.guild.id && r.id !== managerRoleId) // Remove @everyone e o próprio cargo
                .sort((a, b) => b.position - a.position)
                .first(25);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select_managed_roles_${managerRoleId}`)
                .setPlaceholder(`Quais cargos ${role.name} pode gerenciar?`)
                .setMinValues(1)
                .setMaxValues(roles.length)
                .addOptions(roles.map(r => ({ label: r.name, value: r.id, description: `ID: ${r.id}` })));

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({ content: `> Selecione os cargos que **${role.name}** poderá adicionar/remover:`, components: [row], ephemeral: true });
            return;
        }

        const securityModals = ['submit_protected_role', 'submit_allow_delete', 'submit_allow_everyone', 'submit_allow_panel'];
        if (securityModals.includes(interaction.customId)) {
            const roleId = interaction.fields.getTextInputValue('role_id_input');
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply(createContainerMessage('Cargo não encontrado.', true));

            if (interaction.customId === 'submit_protected_role') {
                if (!config.security.protected_roles.includes(roleId)) {
                    config.security.protected_roles.push(roleId);
                    saveConfig();
                    await interaction.reply(createContainerMessage(`Cargo ${role.name} protegido.`, true));
                }
            } else if (interaction.customId === 'submit_allow_delete') {
                if (!config.security.roles_allowed_delete_channels.includes(roleId)) {
                    config.security.roles_allowed_delete_channels.push(roleId);
                    saveConfig();
                    await interaction.reply(createContainerMessage(`Cargo ${role.name} autorizado a excluir canais.`, true));
                }
            } else if (interaction.customId === 'submit_allow_everyone') {
                if (!config.security.roles_allowed_mention_everyone.includes(roleId)) {
                    config.security.roles_allowed_mention_everyone.push(roleId);
                    saveConfig();
                    await interaction.reply(createContainerMessage(`Cargo ${role.name} autorizado a marcar everyone.`, true));
                }
            } else if (interaction.customId === 'submit_allow_panel') {
                if (!config.security.roles_allowed_panel.includes(roleId)) {
                    config.security.roles_allowed_panel.push(roleId);
                    saveConfig();
                    await interaction.reply(createContainerMessage(`Cargo ${role.name} autorizado a acessar o painel.`, true));
                }
            }
        }
    }

    // 5. Remover Cargo Protegido (Menu)
    if (interaction.customId === 'remove_protected_role_menu') {
        if (config.security.protected_roles.length === 0) {
            return interaction.reply(createContainerMessage('Não há cargos protegidos para remover.', true));
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_remove_role')
            .setPlaceholder('Selecione o cargo para remover a proteção')
            .addOptions(
                config.security.protected_roles.map(roleId => {
                    const role = interaction.guild.roles.cache.get(roleId);
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(role ? role.name : `Cargo ID: ${roleId}`)
                        .setValue(roleId)
                        .setDescription(`ID: ${roleId}`);
                })
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: '> Selecione o cargo que deseja remover da lista de proteção:',
            components: [row],
            ephemeral: true
        });
    }

    // 7. Submit Menu (Remover Cargo)
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_remove_role') {
        const roleId = interaction.values[0];
        
        config.security.protected_roles = config.security.protected_roles.filter(id => id !== roleId);
        saveConfig();

        await interaction.update({
            content: `> Proteção removida do cargo <@&${roleId}>.`,
            components: []
        });
    }

    // 8. Submit Menu (Remover Acesso Painel)
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_remove_panel_access') {
        const roleId = interaction.values[0];
        
        config.security.roles_allowed_panel = config.security.roles_allowed_panel.filter(id => id !== roleId);
        saveConfig();

        await interaction.update({
            content: `> Acesso ao painel removido do cargo <@&${roleId}>.`,
            components: []
        });
    }

    // 9. Submit Menu (Salvar Regras de Gerenciamento)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_managed_roles_')) {
        const managerRoleId = interaction.customId.split('_')[3];
        const selectedRoles = interaction.values;

        if (!config.security.role_manager) config.security.role_manager = {};
        config.security.role_manager[managerRoleId] = selectedRoles;
        saveConfig();

        await interaction.update({
            content: `> Regra salva! O cargo <@&${managerRoleId}> agora pode gerenciar: ${selectedRoles.map(id => `<@&${id}>`).join(', ')}`,
            components: []
        });
    }

    // 3. Excluir Ticket
    if (interaction.customId === 'close_ticket') {
        // Verifica permissão (opcional, pode deixar qualquer um fechar ou só staff/dono)
        await interaction.reply(createContainerMessage('O ticket será excluído em 5 segundos...'));
        
        setTimeout(() => {
            interaction.channel.delete().catch(() => {});
        }, 5000);
    }
});

// --- SISTEMA DE LOGS REMOVIDO ---
const sendLog = async (guild, content, channelId) => {
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    // 🧠 Se já for payload v2 (container / components)
    if (
        typeof content === 'object' &&
        content !== null &&
        Array.isArray(content.components)
    ) {
        await channel.send(content).catch(console.error);
        return;
    }

    // 📝 Qualquer outra coisa vira container de texto
    await channel
        .send(createContainerMessage(String(content)))
        .catch(console.error);
};


// 1. Log de Cargo Adicionado/Removido
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    const now = new Date().toLocaleString('pt-BR');

    if (addedRoles.size > 0) {
        addedRoles.forEach(async role => {
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: 25, limit: 1 });
            const logEntry = auditLogs.entries.first();
            const executor = logEntry && logEntry.target.id === newMember.id && logEntry.createdTimestamp > (Date.now() - 5000) 
                ? logEntry.executor 
                : null;
            const executorTag = executor ? `${executor.tag} (${executor.id})` : 'Desconhecido';

            await sendLog(newMember.guild, `> **Cargo Adicionado**\n> **Membro:** ${newMember.user.tag} (${newMember.id})\n> **Executor:** ${executorTag}\n\n> **Cargo:**\n> ${role.name} (${role.id})\n\n> ${now}`, config.logs.role);
        });
    }

    if (removedRoles.size > 0) {
        removedRoles.forEach(async role => {
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: 25, limit: 1 });
            const logEntry = auditLogs.entries.first();
            const executor = logEntry && logEntry.target.id === newMember.id && logEntry.createdTimestamp > (Date.now() - 5000)
                ? logEntry.executor 
                : null;
            const executorTag = executor ? `${executor.tag} (${executor.id})` : 'Desconhecido';

            await sendLog(newMember.guild, `> **Cargo Removido**\n> **Membro:** ${newMember.user.tag} (${newMember.id})\n> **Executor:** ${executorTag}\n\n> **Cargo:**\n> ${role.name} (${role.id})\n\n> ${now}`, config.logs.role);
        });
    }
});

// 2. Log de Saída do Servidor
client.on('guildMemberRemove', async member => {
    await sendLog(member.guild, `> **Saiu do Servidor**\n> **Usuário:** ${member.user.tag} (${member.id})`, config.logs.leave);
});

// 3. Log de Voz (Entrou/Saiu) - APENAS ANTI-MOVE/DISCONNECT
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member) return;

    // --- SEGURANÇA: Anti-Move e Anti-Disconnect ---
    const isMove = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
    const isDisconnect = oldState.channelId && !newState.channelId;

    if ((isMove && config.security.anti_move) || (isDisconnect && config.security.anti_disconnect)) {
        // Executa verificação em background para não travar o resto do evento
        (async () => {
            try {
                // Pequeno delay para garantir que o audit log foi criado
                await new Promise(r => setTimeout(r, 1500));
                
                const auditType = isMove ? AuditLogEvent.MemberMove : AuditLogEvent.MemberDisconnect;
                const logs = await member.guild.fetchAuditLogs({ type: auditType, limit: 1 });
                const entry = logs.entries.first();

                // Verifica se o log corresponde à ação recente no usuário
                if (entry && entry.target.id === member.id && entry.createdTimestamp > (Date.now() - 5000)) {
                    const executor = entry.executor;
                    
                    // Ignora se foi o próprio usuário, o bot, whitelist ou dono
                    if (executor && executor.id !== member.id && executor.id !== client.user.id && !config.security.whitelist.includes(executor.id) && executor.id !== member.guild.ownerId) {
                        
                        const tracker = isMove ? moveTracker : disconnectTracker;
                        const limit = isMove ? config.security.anti_move_limit : config.security.anti_disconnect_limit;
                        const timeWindow = isMove ? config.security.anti_move_time : config.security.anti_disconnect_time;
                        const actionName = isMove ? "Move" : "Disconnect";

                        if (!tracker.has(executor.id)) tracker.set(executor.id, []);
                        const timestamps = tracker.get(executor.id);
                        timestamps.push(Date.now());

                        // Remove timestamps antigos da janela de tempo
                        const validTimestamps = timestamps.filter(t => t > Date.now() - timeWindow);
                        tracker.set(executor.id, validTimestamps);

                        if (validTimestamps.length > limit) {
                            // PUNIÇÃO: Remove todos os cargos
                            const executorMember = await member.guild.members.fetch(executor.id).catch(() => null);
                            if (executorMember) {
                                const rolesToRemove = executorMember.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
                                await executorMember.roles.remove(rolesToRemove, `Anti-${actionName} Limit Exceeded`);
                                
                                // Log removido
                            }
                            // Limpa o tracker para não spammar punição repetida
                            tracker.delete(executor.id);
                        }
                    }
                }
            } catch (err) {
                // console.error("Erro no Anti-Move/Disconnect:", err);
            }
        })();
    }
});



// Anti-Raid System & Anti-Bot
client.on('guildMemberAdd', async member => {
    // Anti-Bot: Kick bots on join
    if (member.user.bot) {
        try {
            await member.kick('Anti-Bot: Bots não são permitidos.');
            // Log removido
            return; // Stop processing for this member
        } catch (err) {
            console.error(`Failed to kick bot: ${err}`);
        }
    }

    if (!config.security.antiraid) return;

    const now = Date.now();
    recentJoins.push(now);

    // Remove joins older than the time window
    while (recentJoins.length > 0 && recentJoins[0] < now - config.security.antiraid_time) {
        recentJoins.shift();
    }

    if (recentJoins.length > config.security.antiraid_threshold) {
        // Raid detected!
        try {
            await member.kick('Anti-Raid: Join rate limit exceeded');
            // Log removido
        } catch (err) {
            // console.error(`Failed to kick member during raid: ${err}`);
        }
    }
});

// Role Protection System
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Check if roles were added
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    
    if (addedRoles.size === 0) return;

    // Check if any added role is protected
    const protectedRolesAdded = addedRoles.filter(role => config.security.protected_roles.includes(role.id));
    
    if (protectedRolesAdded.size === 0) return;

    // Find who added the role
    let executor = null;
    try {
        const fetchedLogs = await newMember.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberRoleUpdate,
        });
        const roleLog = fetchedLogs.entries.first();
        
        if (roleLog && roleLog.target.id === newMember.id && roleLog.createdTimestamp > (Date.now() - 5000)) {
            executor = roleLog.executor;
        }
    } catch (e) {
        // console.error("Error fetching audit logs:", e);
    }

    // If we couldn't find the executor, or if the executor is the bot itself, ignore
    if (!executor || executor.id === client.user.id) return;

    // Check if executor is whitelisted or allowed manager
    const isWhitelisted = config.security.whitelist.includes(executor.id) || config.security.allowed_managers.includes(executor.id) || executor.id === newMember.guild.ownerId;

    if (!isWhitelisted) {
        // Unauthorized role addition! Revert it.
        try {
            await newMember.roles.remove(protectedRolesAdded);
            // Log removido
        } catch (err) {
            // console.error(`Failed to revert roles: ${err}`);
        }
    }
});

// Anti-Channel Delete System
client.on('channelDelete', async channel => {
    if (!config.security.anti_channel_delete) return;

    try {
        const fetchedLogs = await channel.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.ChannelDelete,
        });
        const deletionLog = fetchedLogs.entries.first();

        if (!deletionLog) return;
        
        const { executor, target } = deletionLog;

        // Check if the log is recent and matches the deleted channel
        if (target.id === channel.id && (Date.now() - deletionLog.createdTimestamp) < 5000) {
            
            // Check if executor is authorized
            const member = await channel.guild.members.fetch(executor.id).catch(() => null);
            if (!member) return;

            const isAuthorized = 
                executor.id === client.user.id || // Bot itself
                executor.id === channel.guild.ownerId || // Server Owner
                config.security.whitelist.includes(executor.id) || // Whitelisted User
                member.roles.cache.some(r => config.security.roles_allowed_delete_channels.includes(r.id)); // Authorized Role

            if (!isAuthorized) {
                // PUNISHMENT: Remove all roles
                const rolesToRemove = member.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
                await member.roles.remove(rolesToRemove, 'Anti-Channel Delete Protection');

                // Log removido
            }
        }
    } catch (error) {
        // console.error('Error in Anti-Channel Delete:', error);
    }
});

// Anti-Everyone Mention System & Anti-Invite
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    // Anti-Invite Link
    const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)/i;
    if (config.security.anti_invite && inviteRegex.test(message.content)) {
        const isAuthorized = 
            message.author.id === message.guild.ownerId ||
            config.security.whitelist.includes(message.author.id) ||
            message.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isAuthorized) {
            try {
                await message.delete();
                await message.channel.send(createContainerMessage(`🚫 ${message.author.tag}, é proibido enviar links de outros servidores aqui.`));
                // Log removido
                return; // Stop processing
            } catch (err) {
                // console.error('Error handling unauthorized invite:', err);
            }
        }
    }

    // Check for everyone/here mentions
    if (message.mentions.everyone) {
        const isAuthorized = 
            message.author.id === message.guild.ownerId ||
            config.security.whitelist.includes(message.author.id) ||
            message.member.roles.cache.some(r => config.security.roles_allowed_mention_everyone.includes(r.id));

        if (!isAuthorized) {
            try {
                await message.delete();
                const warningMsg = await message.channel.send(createContainerMessage(`🚫 ${message.author.tag}, você não tem permissão para mencionar everyone/here.`));
                setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
                // Log removido
            } catch (err) {
                // console.error('Error handling unauthorized mention:', err);
            }
        }
    }
});

// --- SISTEMA DE STORIES ---


// 1. Detectar upload de imagem/vídeo no canal de stories
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.id !== config.storyChannelId) return;

    // Verifica se tem o cargo permitido
    if (!message.member.roles.cache.has(config.storyRoleId) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.delete().catch(() => {});
        const msg = await message.channel.send(createContainerMessage(`> 🚫 ${message.author}, você não tem permissão para postar stories.`, true));
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
    }

    // Verifica se tem anexo (imagem ou vídeo)
    if (message.attachments.size === 0) {
        await message.delete().catch(() => {});
        const msg = await message.channel.send(createContainerMessage(`> ⚠️ ${message.author}, envie apenas imagens ou vídeos.`, true));
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
    }

    const attachment = message.attachments.first();
    const storyId = message.id;

    // Cria a pasta permanente para armazenar as imagens dos stories
    const storiesDir = path.join(__dirname, 'stories_media');
    if (!fs.existsSync(storiesDir)) {
        fs.mkdirSync(storiesDir);
    }

    const extension = path.extname(attachment.name);
    const permanentFilePath = path.join(storiesDir, `${storyId}${extension}`);

    try {
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(permanentFilePath, Buffer.from(buffer));
    } catch (err) {
        // console.error("Erro ao baixar imagem:", err);
        return message.channel.send(createContainerMessage("Erro ao processar a imagem.", true));
    }

    // Botões base iniciais
    const storyButtons = [
        {
            "type": 2,
            "style": 2,
            "custom_id": `story_like_${storyId}`,
            "label": "0",
            "emoji": { "name": "core11", "id": "1452331605908652114" }
        },
        {
            "type": 2,
            "style": 2,
            "custom_id": `story_info_${storyId}`,
            "label": "",
            "emoji": { "name": "addmzada", "id": "1452331607955603669" }
        },
        {
            "type": 2,
            "style": 2,
            "custom_id": `story_delete_${storyId}`,
            "label": "",
            "emoji": { "name": "errado", "id": "1448337198767145031" }
        }
    ];

    const storyComponents = [
        {
            "type": 17,
            "components": [
                { "type": 10, "content": `> **${message.author}**` },
                { "type": 14, "spacing": 1, "divider": true },
                {
                    "type": 12,
                    "items": [{ "media": { "url": `attachment://${path.basename(permanentFilePath)}` } }]
                },
                { "type": 14, "spacing": 1, "divider": true },
                { "type": 1, "components": storyButtons }
            ]
        }
    ];

    // Busca ou cria um Webhook para o canal
    const webhooks = await message.channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.owner.id === client.user.id);

    if (!webhook) {
        webhook = await message.channel.createWebhook({
            name: 'Story Bot',
            avatar: client.user.displayAvatarURL(),
        });
    }

    // Envia o story pelo Webhook simulando o usuário
    const storyMessage = await webhook.send({
        username: message.member.displayName,
        avatarURL: message.author.displayAvatarURL(),
        files: [permanentFilePath],
        components: storyComponents,
        flags: 32768
    });

    // PEGA A URL FINAL DA CDN (Isso impede que a imagem suma no edit)
    const finalImageUrl = storyMessage.attachments.first()?.url || attachment.url;

    // Salva no banco de dados com o caminho local do arquivo
    stories[storyId] = {
        authorId: message.author.id,
        messageId: storyMessage.id,
        likes: [],
        comments: [],
        url: finalImageUrl,
        localPath: permanentFilePath, // Caminho local do arquivo salvo
        createdAt: Date.now() // Timestamp de criação para limpeza automática
    };
    saveStories();

    await message.delete().catch(() => {});
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, type, storyId] = interaction.customId.split('_');
    if (action !== 'story') return;

    const storyData = stories[storyId];
    if (!storyData) {
        return interaction.reply({
            content: 'Story não encontrado.',
            ephemeral: true
        });
    }

    // =======================
    // ❤️ LIKE / UNLIKE
    // =======================
    if (type === 'like') {
        const userId = interaction.user.id;
        const wasLiked = storyData.likes.includes(userId);

        // Atualiza o array de likes
        if (wasLiked) {
            storyData.likes = storyData.likes.filter(id => id !== userId);
        } else {
            storyData.likes.push(userId);
        }

        saveStories();

        // Pega a mensagem completa atual
        const message = interaction.message;
        
        // Clona os componentes mantendo TODA a estrutura
        const newComponents = JSON.parse(JSON.stringify(message.components));

        // Procura e atualiza apenas o botão de like dentro do container
        for (const container of newComponents) {
            if (container.type === 17) { // Container
                for (const comp of container.components) {
                    if (comp.type === 1) { // ActionRow com botões
                        for (const button of comp.components) {
                            if (button.custom_id === `story_like_${storyId}`) {
                                button.label = `${storyData.likes.length}`;
                                button.style = 2; // Sempre cinza
                            }
                        }
                    }
                }
            }
        }

        // Busca webhook e edita
        const webhooks = await interaction.channel.fetchWebhooks();
        const webhook = webhooks.find(w => w.owner.id === client.user.id);

        if (webhook) {
            await webhook.editMessage(message.id, {
                components: newComponents
            }).catch(err => console.error('Erro ao editar:', err));
        }

        return interaction.deferUpdate();
    }

    // =======================
    // ℹ️ INFO
    // =======================
    if (type === 'info') {
        const likers = storyData.likes.length
            ? storyData.likes.map(id => `<@${id}>`).join(', ')
            : 'Ninguém curtiu ainda.';

        return interaction.reply({
            content: `**Curtidas (${storyData.likes.length}):**\n> ${likers}`,
            ephemeral: true
        });
    }

    // =======================
    // 🗑️ DELETE
    // =======================
    if (type === 'delete') {
        if (interaction.user.id !== storyData.authorId) {
            return interaction.reply({
                content: 'Você não tem permissão.',
                ephemeral: true
            });
        }

        delete stories[storyId];
        saveStories();

        await interaction.reply({
            content: 'Story excluído.',
            ephemeral: true
        });

        return interaction.message.delete().catch(() => {});
    }
});
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    // Verifica se a mensagem é "tomalerda"
    if (message.content.toLowerCase() !== 'tomalerda') return;

    const channel = message.channel;
    const userId = message.author.id;

    try {
        // Apaga a mensagem do comando imediatamente
        await message.delete().catch(() => {});

        let totalDeleted = 0;
        let fetched;
        
        do {
            // Busca mensagens do canal
            fetched = await channel.messages.fetch({ limit: 100 });
            
            // Filtra apenas as mensagens do usuário
            const userMessages = fetched.filter(msg => msg.author.id === userId);
            
            if (userMessages.size === 0) break;

            // Apaga em massa (instantâneo) - funciona para mensagens com menos de 14 dias
            if (userMessages.size > 1) {
                await channel.bulkDelete(userMessages, true).catch(() => {});
                totalDeleted += userMessages.size;
            } else if (userMessages.size === 1) {
                await userMessages.first().delete().catch(() => {});
                totalDeleted++;
            }
            
        } while (fetched.size >= 100);

        // Envia confirmação temporária
        if (totalDeleted > 0) {
            const confirmMsg = await channel.send(
                createContainerMessage(`> 🗑️ ${totalDeleted} mensagem(ns) de <@${userId}> foram apagadas.`, true)
            );
            setTimeout(() => confirmMsg.delete().catch(() => {}), 5000);
        }

    } catch (err) {
        console.error('Erro ao apagar mensagens:', err);
        const errorMsg = await channel.send(
            createContainerMessage('> ❌ Erro ao apagar mensagens.', true)
        );
        setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
    }
});


// Helper para obter permissões formatadas
const getRolePermissions = (role) => {
    const perms = [];
    if (role.permissions.has(PermissionFlagsBits.Administrator)) perms.push('Administrador');
    if (role.permissions.has(PermissionFlagsBits.ManageGuild)) perms.push('Gerenciar servidor');
    if (role.permissions.has(PermissionFlagsBits.ManageNicknames)) perms.push('Gerenciar apelidos');
    if (role.permissions.has(PermissionFlagsBits.ModerateMembers)) perms.push('Timeout');
    if (role.permissions.has(PermissionFlagsBits.MoveMembers)) perms.push('Mover membros');
    if (role.permissions.has(PermissionFlagsBits.MuteMembers)) perms.push('Mutar microfone');
    if (role.permissions.has(PermissionFlagsBits.DeafenMembers)) perms.push('Mutar fones');
    if (role.permissions.has(PermissionFlagsBits.ViewAuditLog)) perms.push('Ver Auditlog');
    
    return perms.length > 0 ? `- **${perms.join(', ')}**` : '- **Sem permissões administrativas**';
};

// Função para enviar/atualizar o painel de cargos
const sendRolesPanel = async (interactionOrMessage, page = 0, targetMember = null) => {
    const guild = interactionOrMessage.guild;
    const member = interactionOrMessage.member; // Quem está executando
    
    // Se não foi passado targetMember (ex: paginação), tenta recuperar ou usa o executor
    if (!targetMember) {
        // Se for interação, tenta pegar do customId se possível, ou usa o member
        // Mas aqui vamos assumir que quem chama deve passar.
        // Se for o comando inicial, passamos. Se for paginação, precisamos recuperar.
        targetMember = member; 
    }

    // Determina quais cargos o usuário pode gerenciar
    let manageableRoles = [];
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

    if (isAdmin) {
        // Admin vê todos
        manageableRoles = guild.roles.cache.map(r => r.id);
    } else {
        // Verifica regras de gerenciamento
        if (config.security.role_manager) {
            member.roles.cache.forEach(role => {
                if (config.security.role_manager[role.id]) {
                    manageableRoles.push(...config.security.role_manager[role.id]);
                }
            });
        }
    }

    // Filtra e ordena os cargos
    // Mostra todos os cargos, mas o botão controla a permissão
    const roles = guild.roles.cache
        .sort((a, b) => b.position - a.position)
        .map(r => r);

    if (roles.length === 0) {
        const msg = createContainerMessage('Nenhum cargo encontrado.');
        if (interactionOrMessage.update) await interactionOrMessage.update(msg);
        else await interactionOrMessage.reply(msg);
        return;
    }

    const itemsPerPage = 5;
    const totalPages = Math.ceil(roles.length / itemsPerPage);
    if (page < 0) page = 0;
    if (page >= totalPages && totalPages > 0) page = totalPages - 1;

    const start = page * itemsPerPage;
    const end = start + itemsPerPage;
    const currentRoles = roles.slice(start, end);

    const innerComponents = [];

    // Header
    innerComponents.push(
        { "type": 10, "content": "# Gerenciamento de Cargos" },
        { "type": 10, "content": `Usuário: ${targetMember.user.username} (${targetMember.id})` },
        { "type": 14, "spacing": 1, "divider": true }
    );

    // Roles
    for (const role of currentRoles) {
        const permString = getRolePermissions(role);
        const hasRole = targetMember.roles.cache.has(role.id);
        
        // Verifica se o usuário pode gerenciar ESTE cargo específico
        // Se for admin, pode tudo (exceto cargos maiores que o bot). Se não, verifica a lista.
        let canManageThisRole = isAdmin || manageableRoles.includes(role.id);

        // Segurança extra: Não permitir gerenciar cargos acima do bot ou do próprio usuário (se não for dono)
        if (role.position >= guild.members.me.roles.highest.position) {
            canManageThisRole = false;
        }

        innerComponents.push({
            "type": 10,
            "content": `<@&${role.id}>\n- **${role.members.size} usuários**\n${permString}`
        });

        innerComponents.push({
            "type": 1,
            "components": [
                {
                    "type": 2, 
                    "style": canManageThisRole ? (hasRole ? 4 : 3) : 2, // Vermelho/Verde se pode, Cinza se não pode
                    "label": canManageThisRole ? (hasRole ? "Remover Cargo" : "Adicionar Cargo") : "Sem Permissão",
                    "custom_id": `groles_toggle_${role.id}_${page}_${targetMember.id}`,
                    "disabled": !canManageThisRole
                }
            ]
        });

        innerComponents.push({ "type": 14, "divider": true, "spacing": 1 });
    }

    // Pagination
    innerComponents.push({
        "type": 1,
        "components": [
            {
                "type": 2,
                "style": 1,
                "custom_id": `groles_prev_${page}_${targetMember.id}`,
                "emoji": { "name": "◀", "id": null },
                "disabled": page === 0
            },
            {
                "type": 2,
                "style": 2,
                "custom_id": "groles_count",
                "label": `${page + 1}/${totalPages}`,
                "disabled": true
            },
            {
                "type": 2,
                "style": 1,
                "custom_id": `groles_next_${page}_${targetMember.id}`,
                "emoji": { "name": "▶", "id": null },
                "disabled": page >= totalPages - 1
            },
            {
                "type": 2,
                "style": 2,
                "custom_id": "groles_close",
                "emoji": { "name": "👁", "id": null }
            }
        ]
    });

    const payload = {
        components: [
            {
                "type": 17,
                "accent_color": null,
                "spoiler": false,
                "components": innerComponents
            }
        ],
        "flags": 32768
    };
    
    if (interactionOrMessage.update) {
        await interactionOrMessage.update(payload);
    } else {
        await interactionOrMessage.reply(payload);
    }
};

// Handler de Interação para o Painel de Cargos
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('groles_')) return;

    const parts = interaction.customId.split('_');
    const action = parts[1];

    if (action === 'close') {
        await interaction.message.delete().catch(() => {});
        return;
    }

if (action === 'prev' || action === 'next') {
    let page = parseInt(parts[2]);
    const targetId = parts[3];
    
    let targetMember;
    try {
        targetMember = await interaction.guild.members.fetch(targetId);
    } catch (err) {
        return interaction.reply({
            content: 'Não foi possível encontrar o usuário. Tente novamente com o comando.',
            ephemeral: true
        });
    }
    
    if (action === 'prev') page--;
    if (action === 'next') page++;
    
    await sendRolesPanel(interaction, page, targetMember);
}
    if (action === 'toggle') {
        const roleId = parts[2];
        const page = parseInt(parts[3]);
        const targetId = parts[4];
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

        if (!targetMember) return interaction.reply(createContainerMessage('Usuário alvo não encontrado.', true));

        // Verifica permissão novamente por segurança
        const isManager = config.security.role_manager && interaction.member.roles.cache.some(r => config.security.role_manager[r.id] && config.security.role_manager[r.id].includes(roleId));
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isAdmin && !isManager) {
             return interaction.reply(createContainerMessage('Você não tem permissão para gerenciar este cargo.', true));
        }

        try {
            if (targetMember.roles.cache.has(roleId)) {
                await targetMember.roles.remove(roleId);
            } else {
                await targetMember.roles.add(roleId);
            }
            await sendRolesPanel(interaction, page, targetMember);
        } catch (err) {
            await interaction.reply(createContainerMessage('Erro ao alterar cargo. Verifique a hierarquia de cargos do bot.', true));
        }
    }
});
client.on('interactionCreate', async interaction => {

    // 🔘 Botão inicial
    if (interaction.isButton() && interaction.customId === "verify_start") {
        return interaction.reply(selectVerifierPanel);
    }

    // 📋 Select Mentionable
    if (interaction.isMentionableSelectMenu() && interaction.customId === "verify_select") {
        await interaction.deferUpdate();

        const requester = interaction.user;
        const selectedId = interaction.values[0];

        const staffChannel = interaction.guild.channels.cache.get(config.verifyStaffChannelId);
        if (!staffChannel) {
            return interaction.followUp(
                createContainerMessage("> ❌ Canal da staff não configurado.", true)
            );
        }

        const staffPanel = {
            components: [
                {
                    type: 17,
                    components: [
                        {
                            type: 10,
                            content:
                                `> **Pedido de Verificação**\n` +
                                `> **Membro:** ${requester.tag} (${requester.id})\n` +
                                `> **Verificador escolhido:** <@${selectedId}>`
                        },
                        {
                            type: 14,
                            divider: true
                        },
                        {
                            type: 1,
                            components: [
                                {
                                    type: 2,
                                    style: 3,
                                    label: "Aprovar",
                                    custom_id: `verify_approve_${requester.id}`
                                },
                                {
                                    type: 2,
                                    style: 4,
                                    label: "Recusar",
                                    custom_id: `verify_deny_${requester.id}`
                                }
                            ]
                        }
                    ]
                }
            ],
            flags: 32768
        };

        await staffChannel.send(staffPanel);

        return interaction.followUp(
            createContainerMessage("> Solicitação enviada para a equipe.", true)
        );
    }

    // ✅ Aprovar
    if (interaction.isButton() && interaction.customId.startsWith("verify_approve_")) {
        await interaction.deferUpdate();

        const userId = interaction.customId.split("_")[2];

        try {
            const member = await interaction.guild.members.fetch(userId);
            await member.roles.add(config.verifiedRoleId);
            await member.send("> Sua verificação foi **aprovada**.");

            return interaction.followUp(
                createContainerMessage("> Verificação aprovada e cargo aplicado.")
            );
        } catch {
            return interaction.followUp(
                createContainerMessage("> Erro ao aplicar o cargo.")
            );
        }
    }

    // ❌ Recusar
    if (interaction.isButton() && interaction.customId.startsWith("verify_deny_")) {
        await interaction.deferUpdate();

        const userId = interaction.customId.split("_")[2];

        try {
            const user = await client.users.fetch(userId);
            await user.send("> Sua verificação foi **recusada**.");
        } catch {}

        return interaction.followUp(
            createContainerMessage("> Verificação recusada. Usuário avisado por DM.")
        );
    }
});

client.login(config.token);
