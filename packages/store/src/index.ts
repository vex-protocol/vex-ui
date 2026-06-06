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
    $activeCalls,
    $currentCallID,
    $incomingCalls,
    $latestCallEvent,
} from "./domains/calls.ts";
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

export { createCachedLinkPreviewLoader } from "./link-preview-cache.ts";
export type {
    CachedLinkPreviewLoader,
    LinkPreviewCacheRecord,
    LinkPreviewCacheSnapshot,
    LinkPreviewCacheStorage,
    LinkPreviewLoaderOptions,
} from "./link-preview-cache.ts";
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
export { MemoryStorage } from "./memory-storage.ts";

export {
    applyEmoji,
    applyMessageDeleteEvent,
    applyMessageReactionEvent,
    applyMessageUpdateEvent,
    avatarHue,
    buildMessageReplyReference,
    chunkMessages,
    createDeleteBatchEventExtra,
    createDeleteEventExtra,
    createReactionEventExtra,
    createReplyExtra,
    createReplyReferenceExtra,
    createUnicodeReactionEmoji,
    createUpdateEventExtra,
    emojiReactionKey,
    emojiReactionLabel,
    foldMessageEvents,
    foldMessageReactionEvents,
    formatFileAttachmentMarkdown,
    formatFileSize,
    formatTime,
    isImageType,
    messageDeleteEvent,
    messageDeleteEventTargetMailIDs,
    messageEmbed,
    messageFirstAttachment,
    messageReactionEvent,
    messageReactions,
    messageReply,
    messageReplyPreviewText,
    messageUpdateEvent,
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
    MessageDeleteEvent,
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
    MessageReplyReference,
    MessageUpdateEvent,
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
    PasskeyCeremonyDriver,
    PasskeyDeviceRestoreResult,
    PasskeySignInBegin,
    PushNotificationChannel,
    PushNotificationEvent,
    ResumeNetworkStatus,
    SendMessageOptions,
    ServerOptions,
    SessionInfo,
    VoiceCallResult,
} from "./service.ts";
export {
    decodeVexDbAtRestKey,
    deriveLegacyMobileAtRestAesKey,
    encodeVexDbAtRestKey,
    generateVexDbAtRestKey,
    rewrapVexSqliteAtRestKey,
} from "./sqlite-at-rest-migration.ts";
