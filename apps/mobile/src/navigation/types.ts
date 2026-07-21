import type { CameraCaptureSource } from "../lib/cameraCaptureResult";
import type { NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type AppScreenProps<T extends keyof AppStackParamList> =
    NativeStackScreenProps<AppStackParamList, T>;

// ── App (content) stack ─────────────────────────────────────────────────────
export type AppStackParamList = {
    AddServer: undefined;
    Appearance: undefined;
    AvatarCrop: {
        requestId: number;
        sourceHeight: number;
        sourceUri: string;
        sourceWidth: number;
        title?: string;
    };
    CameraCapture: { source: CameraCaptureSource };
    Channel: { channelID: string; channelName: string; serverID: string };
    ChannelList: { serverID: string; serverName?: string };
    Conversation: { userID: string; username: string };
    DeviceDetails: { deviceID: string; deviceName?: string };
    DeviceManager: undefined;
    DeviceRequests: undefined;
    Devices: undefined;
    DMList: undefined;
    Invite: { serverID: string; serverName?: string };
    InvitePreview: { inviteID: string };
    JoinGroup: undefined | { inviteID?: string };
    OnboardingEmpty: undefined;
    Passkeys:
        | undefined
        | {
              reason?: "cross_platform_passkey" | "password_login";
              startSetup?: boolean;
              suggestedName?: string;
          };
    Password: undefined;
    ServerSettings: { serverID: string; serverName?: string };
    SessionDetails: undefined;
    Settings: undefined;
    SettingsSection: {
        section:
            | "about"
            | "account"
            | "billing"
            | "connection"
            | "data"
            | "developer"
            | "notifications";
    };
    ShareComposer: undefined;
};

// ── Screen prop helpers ─────────────────────────────────────────────────────
export type AuthScreenProps<T extends keyof AuthStackParamList> =
    NativeStackScreenProps<AuthStackParamList, T>;

// ── Auth stack ──────────────────────────────────────────────────────────────
export type AuthStackParamList = {
    AccountSelector: undefined | { error?: string };
    Authenticate:
        | undefined
        | { requestID?: string; signKey?: string; username?: string };
    HangTight:
        | undefined
        | {
              force?: boolean;
              fromAccountPicker?: boolean;
              mode?: "signin" | "signup";
              notice?: string;
              username?: string;
          };
    ProvisionDevice: {
        hasLocalDevice: boolean;
        userID?: string;
        username: string;
    };
    RecoverPassword: undefined | { username?: string };
    Welcome: undefined;
};

// ── DMsStack (legacy, used in DMsStack.tsx) ─────────────────────────────────
export type DMsStackParamList = {
    Conversation: { userID: string; username: string };
    DMList: undefined;
};

// ── Root stack (switches between Auth and App) ──────────────────────────────
export type RootStackParamList = {
    App: NavigatorScreenParams<AppStackParamList>;
    Auth: NavigatorScreenParams<AuthStackParamList>;
};

// ── ServersStack (legacy, used in ServersStack.tsx) ─────────────────────────
export type ServersStackParamList = {
    Channel: { channelID: string; channelName: string; serverID: string };
    ChannelList: { serverID: string; serverName?: string };
    ServerList: undefined;
};

// ── Global declaration so useNavigation() and navigationRef are typed ────────
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace ReactNavigation {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- React Navigation requires declaration merging
        interface RootParamList extends RootStackParamList {}
    }
}
