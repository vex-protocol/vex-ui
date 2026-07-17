import type { AppScreenProps } from "../navigation/types";
import type { Permission, User } from "@vex-chat/libvex";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import {
    $channels,
    $permissions,
    $servers,
    $user,
    vexService,
} from "@vex-chat/store";

import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import * as ImagePicker from "expo-image-picker";

import { Avatar } from "../components/Avatar";
import { ChatHeader } from "../components/ChatHeader";
import { ServerIcon } from "../components/ServerIcon";
import {
    $avatarCropResult,
    nextAvatarCropRequestId,
} from "../lib/avatarCropResult";
import { prepareServerIcon } from "../lib/serverIconImage";
import { colors, typography, useAccentColors } from "../theme";

type BusyAction =
    | "channel"
    | "delete"
    | "icon"
    | "leave"
    | "member"
    | "name"
    | null;
type ServerRole = 0 | 50 | 100;
type SettingsTab = "channels" | "members" | "overview";

export function ServerSettingsScreen({
    navigation,
    route,
}: AppScreenProps<"ServerSettings">) {
    const accent = useAccentColors();
    const { serverID } = route.params;
    const channelsByServer = useStore($channels);
    const localPermissions = useStore($permissions);
    const servers = useStore($servers);
    const user = useStore($user);
    const cropResult = useStore($avatarCropResult);
    const server = servers[serverID];
    const channels = channelsByServer[serverID] ?? [];
    const serverName = server?.name ?? route.params.serverName ?? "Group";
    const firstChannelID = channels[0]?.channelID;

    const [activeTab, setActiveTab] = useState<SettingsTab>("overview");
    const [busy, setBusy] = useState<BusyAction>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [name, setName] = useState(serverName);
    const [newChannelName, setNewChannelName] = useState("");
    const [editingChannelID, setEditingChannelID] = useState<null | string>(
        null,
    );
    const [editingChannelName, setEditingChannelName] = useState("");
    const [members, setMembers] = useState<User[]>([]);
    const [memberPermissions, setMemberPermissions] = useState<Permission[]>(
        [],
    );
    const [membersLoading, setMembersLoading] = useState(false);
    const expectedCropRequestRef = useRef<null | number>(null);

    const myPower = useMemo(() => {
        if (!user?.userID) return 0;
        return Math.max(
            0,
            ...Object.values(localPermissions)
                .filter(
                    (permission) =>
                        permission.resourceID === serverID &&
                        permission.userID === user.userID,
                )
                .map((permission) => permission.powerLevel),
        );
    }, [localPermissions, serverID, user?.userID]);
    const canManage = myPower >= 50;
    const isOwner = myPower >= 100;
    const ownerCount = memberPermissions.filter(
        (permission) => permission.powerLevel >= 100,
    ).length;
    const canLeave = !isOwner || ownerCount > 1;

    useEffect(() => {
        setName(serverName);
    }, [serverName]);

    const clearStatus = useCallback(() => {
        setError("");
        setNotice("");
    }, []);

    const refreshPermissions = useCallback(async () => {
        try {
            setMemberPermissions(
                await vexService.getServerPermissions(serverID),
            );
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not load group roles.",
            );
        }
    }, [serverID]);

    const refreshMembers = useCallback(async () => {
        if (!firstChannelID) {
            setMembers([]);
            return;
        }
        setMembersLoading(true);
        try {
            const [nextMembers, nextPermissions] = await Promise.all([
                vexService.getChannelMembers(firstChannelID),
                vexService.getServerPermissions(serverID),
            ]);
            setMembers(nextMembers);
            setMemberPermissions(nextPermissions);
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not load group members.",
            );
        } finally {
            setMembersLoading(false);
        }
    }, [firstChannelID, serverID]);

    useEffect(() => {
        void refreshPermissions();
    }, [refreshPermissions]);

    useEffect(() => {
        if (activeTab === "members") {
            void refreshMembers();
        }
    }, [activeTab, refreshMembers]);

    const uploadIcon = useCallback(
        async (uri: string) => {
            setBusy("icon");
            clearStatus();
            try {
                const icon = await prepareServerIcon(uri);
                const result = await vexService.setServerIcon(serverID, icon);
                if (!result.ok) {
                    setError(
                        result.error ?? "Could not update the group icon.",
                    );
                    return;
                }
                setNotice("Group icon updated.");
            } catch (err: unknown) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not update the group icon.",
                );
            } finally {
                setBusy(null);
            }
        },
        [clearStatus, serverID],
    );

    useEffect(() => {
        if (
            !cropResult ||
            cropResult.requestId !== expectedCropRequestRef.current
        ) {
            return;
        }
        expectedCropRequestRef.current = null;
        $avatarCropResult.set(null);
        void uploadIcon(cropResult.uri);
    }, [cropResult, uploadIcon]);

    async function handlePickIcon(): Promise<void> {
        if (!canManage || busy) return;
        const permission =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            setError("Photo library permission is required.");
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.92,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset?.uri || (asset.type != null && asset.type !== "image")) {
            setError("Please select an image.");
            return;
        }
        if (
            typeof asset.width === "number" &&
            typeof asset.height === "number" &&
            Math.abs(asset.width - asset.height) > 1
        ) {
            const requestId = nextAvatarCropRequestId();
            expectedCropRequestRef.current = requestId;
            $avatarCropResult.set(null);
            navigation.navigate("AvatarCrop", {
                requestId,
                sourceHeight: asset.height,
                sourceUri: asset.uri,
                sourceWidth: asset.width,
                title: "Crop group icon",
            });
            return;
        }
        await uploadIcon(asset.uri);
    }

    async function removeIcon(): Promise<void> {
        if (!canManage || !server?.icon || busy) return;
        setBusy("icon");
        clearStatus();
        const result = await vexService.removeServerIcon(serverID);
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not remove the group icon.");
            return;
        }
        setNotice("Group icon removed.");
    }

    async function saveName(): Promise<void> {
        const nextName = name.trim();
        if (!canManage || !nextName || nextName === server?.name || busy)
            return;
        setBusy("name");
        clearStatus();
        const result = await vexService.updateServer(serverID, nextName);
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not rename this group.");
            return;
        }
        setNotice("Group name updated.");
    }

    async function createChannel(): Promise<void> {
        const nextName = newChannelName.trim();
        if (!canManage || !nextName || busy) return;
        setBusy("channel");
        clearStatus();
        const result = await vexService.createChannel(nextName, serverID);
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not create this channel.");
            return;
        }
        setNewChannelName("");
        setNotice(`#${nextName} created.`);
    }

    async function renameChannel(): Promise<void> {
        const nextName = editingChannelName.trim();
        if (!editingChannelID || !nextName || busy) return;
        setBusy("channel");
        clearStatus();
        const result = await vexService.updateChannel(
            editingChannelID,
            nextName,
        );
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not rename this channel.");
            return;
        }
        setEditingChannelID(null);
        setEditingChannelName("");
        setNotice("Channel renamed.");
    }

    function confirmDeleteChannel(channelID: string, channelName: string) {
        if (!canManage || channels.length <= 1 || busy) return;
        Alert.alert(
            `Delete #${channelName}?`,
            "Its message history will be removed for everyone.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void deleteChannel(channelID, channelName);
                    },
                    style: "destructive",
                    text: "Delete channel",
                },
            ],
        );
    }

    async function deleteChannel(channelID: string, channelName: string) {
        setBusy("channel");
        clearStatus();
        const result = await vexService.deleteChannel(channelID, serverID);
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not delete this channel.");
            return;
        }
        setNotice(`#${channelName} deleted.`);
    }

    function permissionFor(userID: string): Permission | undefined {
        return memberPermissions.find(
            (permission) => permission.userID === userID,
        );
    }

    function roleName(powerLevel: number): string {
        if (powerLevel >= 100) return "Owner";
        if (powerLevel >= 50) return "Moderator";
        return "Member";
    }

    function chooseRole(member: User, permission: Permission): void {
        if (!isOwner || member.userID === user?.userID || busy) return;
        const currentPower = permission.powerLevel;
        const choices: Array<{ label: string; powerLevel: ServerRole }> = [
            { label: "Member", powerLevel: 0 },
            { label: "Moderator", powerLevel: 50 },
            { label: "Owner", powerLevel: 100 },
        ];
        Alert.alert("Change role", member.username, [
            ...choices.map((choice) => ({
                onPress: () => {
                    if (choice.powerLevel !== currentPower) {
                        confirmRoleChange(member, permission, choice);
                    }
                },
                text:
                    choice.powerLevel === currentPower
                        ? `${choice.label} (current)`
                        : choice.label,
            })),
            { style: "cancel" as const, text: "Cancel" },
        ]);
    }

    function confirmRoleChange(
        member: User,
        permission: Permission,
        choice: { label: string; powerLevel: ServerRole },
    ): void {
        if (choice.powerLevel !== 100) {
            void updateRole(member, permission, choice.powerLevel);
            return;
        }
        Alert.alert(
            `Make ${member.username} an owner?`,
            "Owners can manage roles and permanently delete this group.",
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void updateRole(member, permission, 100);
                    },
                    text: "Make owner",
                },
            ],
        );
    }

    async function updateRole(
        member: User,
        permission: Permission,
        powerLevel: ServerRole,
    ): Promise<void> {
        setBusy("member");
        clearStatus();
        const result = await vexService.updateServerMemberRole(
            permission.permissionID,
            powerLevel,
        );
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not update this member's role.");
            return;
        }
        setMemberPermissions((current) =>
            current.map((candidate) =>
                candidate.permissionID === permission.permissionID
                    ? { ...candidate, powerLevel }
                    : candidate,
            ),
        );
        setNotice(`${member.username}'s role updated.`);
    }

    function confirmRemoveMember(member: User): void {
        if (busy) return;
        Alert.alert(
            `Remove ${member.username}?`,
            `They will need another invite to rejoin ${serverName}.`,
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => {
                        void removeMember(member);
                    },
                    style: "destructive",
                    text: "Remove member",
                },
            ],
        );
    }

    async function removeMember(member: User): Promise<void> {
        setBusy("member");
        clearStatus();
        const result = await vexService.kickServerMember(
            serverID,
            member.userID,
        );
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not remove this member.");
            return;
        }
        setMembers((current) =>
            current.filter((candidate) => candidate.userID !== member.userID),
        );
        setMemberPermissions((current) =>
            current.filter((permission) => permission.userID !== member.userID),
        );
        setNotice(`${member.username} removed.`);
    }

    function confirmLeave(): void {
        if (!canLeave || busy) return;
        Alert.alert(
            "Leave group?",
            `Leave ${serverName}? You will need an invite to return.`,
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => void leaveGroup(),
                    style: "destructive",
                    text: "Leave group",
                },
            ],
        );
    }

    async function leaveGroup(): Promise<void> {
        setBusy("leave");
        const result = await vexService.leaveServer(serverID);
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not leave this group.");
            return;
        }
        navigation.reset({ index: 0, routes: [{ name: "DMList" }] });
    }

    function confirmDeleteGroup(): void {
        if (!isOwner || busy) return;
        Alert.alert(
            "Delete group?",
            `Permanently delete ${serverName} and all of its channels?`,
            [
                { style: "cancel", text: "Cancel" },
                {
                    onPress: () => void deleteGroup(),
                    style: "destructive",
                    text: "Delete group",
                },
            ],
        );
    }

    async function deleteGroup(): Promise<void> {
        setBusy("delete");
        const result = await vexService.deleteServer(serverID);
        setBusy(null);
        if (!result.ok) {
            setError(result.error ?? "Could not delete this group.");
            return;
        }
        navigation.reset({ index: 0, routes: [{ name: "DMList" }] });
    }

    if (!server) {
        return (
            <View style={styles.container}>
                <ChatHeader
                    onBack={() => navigation.goBack()}
                    title="Group settings"
                />
                <View style={styles.missing}>
                    <Ionicons
                        color={colors.muted}
                        name="alert-circle-outline"
                        size={28}
                    />
                    <Text style={styles.emptyTitle}>Group unavailable</Text>
                    <Text style={styles.emptyText}>
                        It may have been deleted or your access changed.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ChatHeader
                onBack={() => navigation.goBack()}
                title="Group settings"
            />
            <View style={styles.groupHeader}>
                <ServerIcon
                    iconID={server.icon ?? null}
                    name={server.name}
                    serverID={server.serverID}
                    size={42}
                />
                <View style={styles.groupHeaderCopy}>
                    <Text numberOfLines={1} style={styles.groupName}>
                        {server.name}
                    </Text>
                    <Text style={styles.groupRole}>{roleName(myPower)}</Text>
                </View>
            </View>
            <View style={styles.tabs}>
                <TabButton
                    active={activeTab === "overview"}
                    label="Overview"
                    onPress={() => setActiveTab("overview")}
                />
                <TabButton
                    active={activeTab === "channels"}
                    label="Channels"
                    onPress={() => setActiveTab("channels")}
                />
                <TabButton
                    active={activeTab === "members"}
                    label="Members"
                    onPress={() => setActiveTab("members")}
                />
            </View>
            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {error ? (
                    <View style={[styles.status, styles.statusError]}>
                        <Ionicons
                            color={colors.dangerText}
                            name="alert-circle-outline"
                            size={18}
                        />
                        <Text style={styles.statusErrorText}>{error}</Text>
                    </View>
                ) : notice ? (
                    <View style={[styles.status, styles.statusSuccess]}>
                        <Ionicons
                            color={colors.successText}
                            name="checkmark-circle-outline"
                            size={18}
                        />
                        <Text style={styles.statusSuccessText}>{notice}</Text>
                    </View>
                ) : null}

                {activeTab === "overview" ? (
                    <>
                        <SectionHeading
                            description="The identity people see throughout Vex."
                            title="Overview"
                        />
                        <View style={styles.iconEditor}>
                            <ServerIcon
                                iconID={server.icon ?? null}
                                name={server.name}
                                serverID={server.serverID}
                                size={82}
                            />
                            <View style={styles.iconActions}>
                                <ActionButton
                                    disabled={!canManage || busy !== null}
                                    icon="camera-outline"
                                    label={
                                        server.icon ? "Change icon" : "Add icon"
                                    }
                                    onPress={() => void handlePickIcon()}
                                />
                                {server.icon ? (
                                    <ActionButton
                                        disabled={!canManage || busy !== null}
                                        icon="trash-outline"
                                        label="Remove"
                                        onPress={() => void removeIcon()}
                                        tone="quiet"
                                    />
                                ) : null}
                                <Text style={styles.helperText}>
                                    Square image, up to 5 MB
                                </Text>
                            </View>
                        </View>

                        <View style={styles.field}>
                            <Text style={styles.label}>GROUP NAME</Text>
                            <View style={styles.inputRow}>
                                <TextInput
                                    autoCapitalize="words"
                                    editable={canManage && busy === null}
                                    maxLength={100}
                                    onChangeText={setName}
                                    placeholder="Group name"
                                    placeholderTextColor={colors.mutedDark}
                                    style={styles.input}
                                    value={name}
                                />
                                <ActionButton
                                    disabled={
                                        !canManage ||
                                        busy !== null ||
                                        !name.trim() ||
                                        name.trim() === server.name
                                    }
                                    icon="checkmark"
                                    label="Save"
                                    onPress={() => void saveName()}
                                    tone="primary"
                                />
                            </View>
                        </View>

                        <View style={styles.actionRow}>
                            <View style={styles.actionCopy}>
                                <Text style={styles.actionTitle}>
                                    Invite people
                                </Text>
                                <Text style={styles.actionDescription}>
                                    Create and manage invite links.
                                </Text>
                            </View>
                            <ActionButton
                                icon="link-outline"
                                label="Invites"
                                onPress={() =>
                                    navigation.navigate("Invite", {
                                        serverID,
                                        serverName,
                                    })
                                }
                            />
                        </View>

                        <View style={styles.dangerSection}>
                            <View style={styles.actionRow}>
                                <View style={styles.actionCopy}>
                                    <Text style={styles.actionTitle}>
                                        Leave group
                                    </Text>
                                    <Text style={styles.actionDescription}>
                                        {canLeave
                                            ? "You will need an invite to return."
                                            : "Add another owner before leaving."}
                                    </Text>
                                </View>
                                <ActionButton
                                    disabled={!canLeave || busy !== null}
                                    icon="log-out-outline"
                                    label="Leave"
                                    onPress={confirmLeave}
                                    tone="danger"
                                />
                            </View>
                            {isOwner ? (
                                <View style={styles.actionRow}>
                                    <View style={styles.actionCopy}>
                                        <Text style={styles.actionTitle}>
                                            Delete group
                                        </Text>
                                        <Text style={styles.actionDescription}>
                                            Permanently removes all channels.
                                        </Text>
                                    </View>
                                    <ActionButton
                                        disabled={busy !== null}
                                        icon="trash-outline"
                                        label="Delete"
                                        onPress={confirmDeleteGroup}
                                        tone="dangerFilled"
                                    />
                                </View>
                            ) : null}
                        </View>
                    </>
                ) : activeTab === "channels" ? (
                    <>
                        <SectionHeading
                            description="Keep conversations focused and easy to find."
                            title="Channels"
                        />
                        {canManage ? (
                            <View style={styles.inputRow}>
                                <View style={styles.inputWithIcon}>
                                    <Ionicons
                                        color={colors.mutedDark}
                                        name="add"
                                        size={18}
                                    />
                                    <TextInput
                                        autoCapitalize="none"
                                        editable={busy === null}
                                        maxLength={100}
                                        onChangeText={setNewChannelName}
                                        onSubmitEditing={() =>
                                            void createChannel()
                                        }
                                        placeholder="new-channel"
                                        placeholderTextColor={colors.mutedDark}
                                        style={styles.inlineInput}
                                        value={newChannelName}
                                    />
                                </View>
                                <ActionButton
                                    disabled={
                                        busy !== null || !newChannelName.trim()
                                    }
                                    icon="add"
                                    label="Create"
                                    onPress={() => void createChannel()}
                                    tone="primary"
                                />
                            </View>
                        ) : null}
                        <View style={styles.rows}>
                            {channels.map((channel) => {
                                const editing =
                                    editingChannelID === channel.channelID;
                                return (
                                    <View
                                        key={channel.channelID}
                                        style={styles.channelRow}
                                    >
                                        {editing ? (
                                            <>
                                                <View
                                                    style={styles.inputWithIcon}
                                                >
                                                    <Text style={styles.hash}>
                                                        #
                                                    </Text>
                                                    <TextInput
                                                        autoCapitalize="none"
                                                        autoFocus
                                                        editable={busy === null}
                                                        maxLength={100}
                                                        onChangeText={
                                                            setEditingChannelName
                                                        }
                                                        onSubmitEditing={() =>
                                                            void renameChannel()
                                                        }
                                                        style={
                                                            styles.inlineInput
                                                        }
                                                        value={
                                                            editingChannelName
                                                        }
                                                    />
                                                </View>
                                                <IconButton
                                                    disabled={
                                                        busy !== null ||
                                                        !editingChannelName.trim()
                                                    }
                                                    icon="checkmark"
                                                    label="Save channel name"
                                                    onPress={() =>
                                                        void renameChannel()
                                                    }
                                                />
                                                <IconButton
                                                    icon="close"
                                                    label="Cancel rename"
                                                    onPress={() =>
                                                        setEditingChannelID(
                                                            null,
                                                        )
                                                    }
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <Text style={styles.hash}>
                                                    #
                                                </Text>
                                                <Text
                                                    numberOfLines={1}
                                                    style={styles.channelName}
                                                >
                                                    {channel.name}
                                                </Text>
                                                {canManage ? (
                                                    <>
                                                        <IconButton
                                                            icon="pencil-outline"
                                                            label={`Rename ${channel.name}`}
                                                            onPress={() => {
                                                                clearStatus();
                                                                setEditingChannelID(
                                                                    channel.channelID,
                                                                );
                                                                setEditingChannelName(
                                                                    channel.name,
                                                                );
                                                            }}
                                                        />
                                                        <IconButton
                                                            danger
                                                            disabled={
                                                                channels.length <=
                                                                    1 ||
                                                                busy !== null
                                                            }
                                                            icon="trash-outline"
                                                            label={
                                                                channels.length <=
                                                                1
                                                                    ? "Every group needs one channel"
                                                                    : `Delete ${channel.name}`
                                                            }
                                                            onPress={() =>
                                                                confirmDeleteChannel(
                                                                    channel.channelID,
                                                                    channel.name,
                                                                )
                                                            }
                                                        />
                                                    </>
                                                ) : null}
                                            </>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    </>
                ) : (
                    <>
                        <SectionHeading
                            description={`${String(members.length)} people currently have access.`}
                            title="Members"
                        />
                        <ActionButton
                            icon="person-add-outline"
                            label="Invite people"
                            onPress={() =>
                                navigation.navigate("Invite", {
                                    serverID,
                                    serverName,
                                })
                            }
                        />
                        <View style={styles.rows}>
                            {membersLoading && members.length === 0 ? (
                                <View style={styles.loadingRow}>
                                    <ActivityIndicator
                                        color={accent.accentText}
                                        size="small"
                                    />
                                    <Text style={styles.emptyText}>
                                        Loading members...
                                    </Text>
                                </View>
                            ) : members.length === 0 ? (
                                <View style={styles.loadingRow}>
                                    <Text style={styles.emptyText}>
                                        No members found.
                                    </Text>
                                </View>
                            ) : (
                                members.map((member) => {
                                    const memberPermission = permissionFor(
                                        member.userID,
                                    );
                                    const memberPower =
                                        memberPermission?.powerLevel ?? 0;
                                    const isMe = member.userID === user?.userID;
                                    return (
                                        <View
                                            key={member.userID}
                                            style={styles.memberRow}
                                        >
                                            <Avatar
                                                displayName={member.username}
                                                size={38}
                                                userID={member.userID}
                                            />
                                            <View style={styles.memberIdentity}>
                                                <Text
                                                    numberOfLines={1}
                                                    style={styles.memberName}
                                                >
                                                    {member.username}
                                                </Text>
                                                <Text style={styles.memberRole}>
                                                    {roleName(memberPower)}
                                                    {isMe ? " · You" : ""}
                                                </Text>
                                            </View>
                                            {!isMe &&
                                            isOwner &&
                                            memberPermission ? (
                                                <TouchableOpacity
                                                    accessibilityLabel={`Change role for ${member.username}`}
                                                    disabled={busy !== null}
                                                    onPress={() =>
                                                        chooseRole(
                                                            member,
                                                            memberPermission,
                                                        )
                                                    }
                                                    style={styles.roleButton}
                                                >
                                                    <Text
                                                        style={
                                                            styles.roleButtonText
                                                        }
                                                    >
                                                        {roleName(memberPower)}
                                                    </Text>
                                                    <Ionicons
                                                        color={colors.muted}
                                                        name="chevron-down"
                                                        size={14}
                                                    />
                                                </TouchableOpacity>
                                            ) : null}
                                            {!isMe && myPower > memberPower ? (
                                                <IconButton
                                                    danger
                                                    disabled={busy !== null}
                                                    icon="person-remove-outline"
                                                    label={`Remove ${member.username}`}
                                                    onPress={() =>
                                                        confirmRemoveMember(
                                                            member,
                                                        )
                                                    }
                                                />
                                            ) : null}
                                        </View>
                                    );
                                })
                            )}
                        </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function ActionButton({
    disabled = false,
    icon,
    label,
    onPress,
    tone = "default",
}: {
    disabled?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    tone?: "danger" | "dangerFilled" | "default" | "primary" | "quiet";
}) {
    const accent = useAccentColors();
    const danger = tone === "danger" || tone === "dangerFilled";
    return (
        <TouchableOpacity
            accessibilityLabel={label}
            activeOpacity={0.74}
            disabled={disabled}
            onPress={onPress}
            style={[
                styles.button,
                tone === "primary" && {
                    backgroundColor: accent.accent,
                    borderColor: accent.accent,
                },
                tone === "quiet" && styles.buttonQuiet,
                tone === "danger" && styles.buttonDanger,
                tone === "dangerFilled" && styles.buttonDangerFilled,
                disabled && styles.disabled,
            ]}
        >
            <Ionicons
                color={
                    tone === "primary"
                        ? accent.onAccent
                        : tone === "dangerFilled"
                          ? "#fff"
                          : danger
                            ? colors.error
                            : colors.textSecondary
                }
                name={icon}
                size={16}
            />
            <Text
                style={[
                    styles.buttonText,
                    tone === "primary" && { color: accent.onAccent },
                    tone === "dangerFilled" && styles.buttonTextFilled,
                    danger &&
                        tone !== "dangerFilled" &&
                        styles.buttonTextDanger,
                ]}
            >
                {label}
            </Text>
        </TouchableOpacity>
    );
}

function IconButton({
    danger = false,
    disabled = false,
    icon,
    label,
    onPress,
}: {
    danger?: boolean;
    disabled?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            style={[styles.iconButton, disabled && styles.disabled]}
        >
            <Ionicons
                color={danger ? colors.error : colors.muted}
                name={icon}
                size={18}
            />
        </TouchableOpacity>
    );
}

function SectionHeading({
    description,
    title,
}: {
    description: string;
    title: string;
}) {
    return (
        <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionDescription}>{description}</Text>
        </View>
    );
}

function TabButton({
    active,
    label,
    onPress,
}: {
    active: boolean;
    label: string;
    onPress: () => void;
}) {
    const accent = useAccentColors();
    return (
        <TouchableOpacity
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={onPress}
            style={[
                styles.tab,
                active && { backgroundColor: accent.accentSoft },
            ]}
        >
            <Text
                style={[styles.tabText, active && { color: accent.accentText }]}
            >
                {label}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    actionCopy: {
        flex: 1,
        gap: 3,
        minWidth: 0,
    },
    actionDescription: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        lineHeight: 17,
    },
    actionRow: {
        alignItems: "center",
        borderTopColor: colors.borderSubtle,
        borderTopWidth: 1,
        flexDirection: "row",
        gap: 14,
        minHeight: 70,
        paddingVertical: 14,
    },
    actionTitle: {
        ...typography.button,
        color: colors.textSecondary,
    },
    button: {
        alignItems: "center",
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 6,
        justifyContent: "center",
        minHeight: 38,
        paddingHorizontal: 12,
    },
    buttonDanger: {
        borderColor: colors.dangerBorder,
    },
    buttonDangerFilled: {
        backgroundColor: colors.error,
        borderColor: colors.error,
    },
    buttonQuiet: {
        borderColor: colors.transparent,
    },
    buttonText: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 13,
    },
    buttonTextDanger: {
        color: colors.error,
    },
    buttonTextFilled: {
        color: "#fff",
    },
    channelName: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
        fontSize: 14,
        minWidth: 0,
    },
    channelRow: {
        alignItems: "center",
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: 1,
        flexDirection: "row",
        gap: 7,
        minHeight: 56,
        paddingVertical: 8,
    },
    container: {
        backgroundColor: colors.bg,
        flex: 1,
    },
    content: {
        paddingBottom: 36,
        paddingHorizontal: 16,
        paddingTop: 22,
    },
    dangerSection: {
        borderTopColor: colors.dangerBorder,
        borderTopWidth: 1,
        marginTop: 22,
    },
    disabled: {
        opacity: 0.4,
    },
    emptyText: {
        ...typography.body,
        color: colors.muted,
        textAlign: "center",
    },
    emptyTitle: {
        ...typography.button,
        color: colors.text,
        fontSize: 16,
    },
    field: {
        gap: 8,
        marginBottom: 22,
    },
    groupHeader: {
        alignItems: "center",
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: 1,
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    groupHeaderCopy: {
        flex: 1,
        gap: 2,
        minWidth: 0,
    },
    groupName: {
        ...typography.button,
        color: colors.text,
        fontSize: 15,
    },
    groupRole: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        lineHeight: 16,
    },
    hash: {
        color: colors.mutedDark,
        fontSize: 18,
        fontWeight: "600",
    },
    helperText: {
        ...typography.body,
        color: colors.mutedDark,
        fontSize: 11,
        lineHeight: 15,
    },
    iconActions: {
        alignItems: "flex-start",
        flex: 1,
        gap: 7,
    },
    iconButton: {
        alignItems: "center",
        borderRadius: 8,
        height: 38,
        justifyContent: "center",
        width: 38,
    },
    iconEditor: {
        alignItems: "center",
        flexDirection: "row",
        gap: 18,
        marginBottom: 26,
    },
    inlineInput: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
        minWidth: 0,
        paddingVertical: 9,
    },
    input: {
        ...typography.body,
        backgroundColor: colors.input,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        color: colors.textSecondary,
        flex: 1,
        minHeight: 42,
        paddingHorizontal: 12,
    },
    inputRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        marginBottom: 18,
    },
    inputWithIcon: {
        alignItems: "center",
        backgroundColor: colors.input,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flex: 1,
        flexDirection: "row",
        gap: 6,
        minHeight: 42,
        minWidth: 0,
        paddingHorizontal: 10,
    },
    label: {
        ...typography.label,
        color: colors.muted,
    },
    loadingRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        justifyContent: "center",
        minHeight: 76,
    },
    memberIdentity: {
        flex: 1,
        gap: 2,
        minWidth: 0,
    },
    memberName: {
        ...typography.button,
        color: colors.textSecondary,
        fontSize: 13,
    },
    memberRole: {
        ...typography.body,
        color: colors.muted,
        fontSize: 11,
        lineHeight: 15,
    },
    memberRow: {
        alignItems: "center",
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: 1,
        flexDirection: "row",
        gap: 9,
        minHeight: 58,
        paddingVertical: 9,
    },
    missing: {
        alignItems: "center",
        flex: 1,
        gap: 9,
        justifyContent: "center",
        paddingHorizontal: 32,
    },
    roleButton: {
        alignItems: "center",
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 4,
        minHeight: 34,
        paddingHorizontal: 9,
    },
    roleButtonText: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 11,
        lineHeight: 15,
    },
    rows: {
        borderTopColor: colors.borderSubtle,
        borderTopWidth: 1,
        marginTop: 16,
    },
    sectionDescription: {
        ...typography.body,
        color: colors.muted,
        fontSize: 12,
        lineHeight: 17,
    },
    sectionHeading: {
        gap: 4,
        marginBottom: 20,
    },
    sectionTitle: {
        ...typography.headingSmall,
        color: colors.text,
        fontSize: 22,
        lineHeight: 27,
    },
    status: {
        alignItems: "center",
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        marginBottom: 18,
        padding: 10,
    },
    statusError: {
        backgroundColor: colors.dangerBg,
        borderColor: colors.dangerBorder,
    },
    statusErrorText: {
        ...typography.body,
        color: colors.dangerText,
        flex: 1,
        fontSize: 12,
    },
    statusSuccess: {
        backgroundColor: colors.successBg,
        borderColor: colors.successBorder,
    },
    statusSuccessText: {
        ...typography.body,
        color: colors.successText,
        flex: 1,
        fontSize: 12,
    },
    tab: {
        alignItems: "center",
        borderRadius: 7,
        flex: 1,
        justifyContent: "center",
        minHeight: 36,
    },
    tabs: {
        backgroundColor: colors.surface,
        borderBottomColor: colors.borderSubtle,
        borderBottomWidth: 1,
        flexDirection: "row",
        gap: 4,
        padding: 6,
    },
    tabText: {
        ...typography.button,
        color: colors.muted,
        fontSize: 12,
    },
});
