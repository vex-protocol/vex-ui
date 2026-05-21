// ── VexService (primary API for apps) ───────────────────────────────────────

export {
    extractInviteID,
    formatInviteAppLink,
    formatInviteLink,
    parseInviteID,
    parseVexLink,
} from "./deeplink.ts";
export type { VexLink } from "./deeplink.ts";

// ── Domain atoms (readonly — apps can subscribe, not write) ─────────────────

export {
    $authStatus,
    $avatarHash,
    $avatarVersions,
    $devices,
    $familiars,
    $historyRecoveryStatus,
    $hydrationStatus,
    $keyReplaced,
    $pendingApprovalStage,
    $signedOutIntent,
    $user,
} from "./domains/identity.ts";
export type {
    AuthStatus,
    HistoryRecoveryStatus,
    HydrationStage,
    HydrationStatus,
    PendingApprovalStage,
} from "./domains/identity.ts";
export {
    $channelUnreadCounts,
    $dmUnreadCounts,
    $groupMessages,
    $messages,
    $totalChannelUnread,
    $totalDmUnread,
} from "./domains/messaging.ts";

export {
    $channels,
    $onlineLists,
    $permissions,
    $servers,
} from "./domains/servers.ts";

export {
    $localMessageRetentionDays,
    $localMessageRetentionDaysWritable,
    clampLocalMessageRetentionDays,
    MAX_LOCAL_MESSAGE_RETENTION_DAYS,
    setLocalMessageRetentionDaysPreference,
} from "./domains/settings.ts";

// ── Utilities (pure functions, no state) ────────────────────────────────────

export {
    extractLinkPreviewUrl,
    fetchLinkPreviewMetadata,
    normalizeLinkPreviewUrl,
    parseLinkPreviewHtml,
} from "./link-preview.ts";
export type {
    LinkPreviewHtmlFetcher,
    LinkPreviewHtmlResult,
    LinkPreviewMetadata,
} from "./link-preview.ts";

export {
    applyEmoji,
    applyMessageReactionEvent,
    avatarHue,
    chunkMessages,
    createReactionEventExtra,
    createUnicodeReactionEmoji,
    emojiReactionKey,
    emojiReactionLabel,
    foldMessageReactionEvents,
    formatFileAttachmentMarkdown,
    formatFileSize,
    formatTime,
    isImageType,
    messageEmbed,
    messageReactionEvent,
    messageReactions,
    parseFileExtra,
    parseMessageExtra,
    parseMessageMarkdown,
    parseVexFileUrl,
    serializeMessageExtra,
    toggleMessageReactionExtra,
} from "./message-utils.ts";
export type {
    EncryptedFileAttachment,
    FileAttachment,
    MarkdownInlineSegment,
    MessageChunk,
    MessageEmbed,
    MessageEmbedAction,
    MessageEmbedBlock,
    MessageEmbedField,
    MessageEmbedMediaItem,
    MessageEmbedSource,
    MessageEmoji,
    MessageExtra,
    MessageMarkdownNode,
    MessageReaction,
    MessageReactionEvent,
} from "./message-utils.ts";

export {
    formatDmNotificationSubtitle,
    formatGroupNotificationSubtitle,
    shouldNotify,
} from "./notifications.ts";
export type { NotificationPayload } from "./notifications.ts";

export { vexService } from "./service.ts";
export type {
    AuthProbeStatus,
    AuthResult,
    BackgroundNetworkFetchResult,
    BootstrapConfig,
    CreateServerResult,
    DeviceApprovalRequest,
    InvitePreview,
    JoinInviteResult,
    OperationResult,
    PasskeySignInBegin,
    ResumeNetworkStatus,
    ServerOptions,
    SessionInfo,
} from "./service.ts";
