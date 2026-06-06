const {
    withAndroidManifest,
    withAppDelegate,
    withInfoPlist,
} = require("expo/config-plugins");

const CALLKEEP_CONNECTION_SERVICE = "io.wazo.callkeep.VoiceConnectionService";
const CALLKEEP_BACKGROUND_SERVICE =
    "io.wazo.callkeep.RNCallKeepBackgroundMessagingService";
const IOS_PUSHKIT_MARKER = "vex-native-calls-pushkit";

function addUnique(list, value) {
    return list.includes(value) ? list : [...list, value];
}

function withAndroidCallKeepServices(config) {
    return withAndroidManifest(config, (cfg) => {
        const application = cfg.modResults.manifest.application?.[0];
        if (!application) {
            return cfg;
        }
        application.service = application.service ?? [];

        const hasConnectionService = application.service.some(
            (service) =>
                service?.$?.["android:name"] === CALLKEEP_CONNECTION_SERVICE,
        );
        if (!hasConnectionService) {
            application.service.push({
                $: {
                    "android:exported": "true",
                    "android:label": "Vex",
                    "android:name": CALLKEEP_CONNECTION_SERVICE,
                    "android:permission":
                        "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
                },
                "intent-filter": [
                    {
                        action: [
                            {
                                $: {
                                    "android:name":
                                        "android.telecom.ConnectionService",
                                },
                            },
                        ],
                    },
                ],
            });
        }

        const hasBackgroundService = application.service.some(
            (service) =>
                service?.$?.["android:name"] === CALLKEEP_BACKGROUND_SERVICE,
        );
        if (!hasBackgroundService) {
            application.service.push({
                $: {
                    "android:exported": "false",
                    "android:name": CALLKEEP_BACKGROUND_SERVICE,
                },
            });
        }

        return cfg;
    });
}

function withIosVoipBackgroundMode(config) {
    return withInfoPlist(config, (cfg) => {
        const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
            ? cfg.modResults.UIBackgroundModes
            : [];
        cfg.modResults.UIBackgroundModes = addUnique(
            addUnique(modes, "remote-notification"),
            "voip",
        );
        return cfg;
    });
}

function addObjcImport(contents, statement) {
    if (contents.includes(statement)) {
        return contents;
    }
    const appDelegateImport = '#import "AppDelegate.h"';
    if (contents.includes(appDelegateImport)) {
        return contents.replace(
            appDelegateImport,
            `${appDelegateImport}\n${statement}`,
        );
    }
    return `${statement}\n${contents}`;
}

function addSwiftImport(contents, statement) {
    if (contents.includes(`${statement}\n`)) {
        return contents;
    }
    const importLines = contents.match(/^import .+$/gm);
    if (!importLines || importLines.length === 0) {
        return `${statement}\n${contents}`;
    }
    const lastImport = importLines[importLines.length - 1];
    const index = contents.indexOf(lastImport) + lastImport.length;
    return `${contents.slice(0, index)}\n${statement}${contents.slice(index)}`;
}

function completionIDObjcSource() {
    return [
        '    NSString *completionID = payload.dictionaryPayload[@"uuid"];',
        "    if (![completionID isKindOfClass:[NSString class]] || completionID.length == 0) {",
        '        completionID = payload.dictionaryPayload[@"callID"];',
        "    }",
        "    if (![completionID isKindOfClass:[NSString class]] || completionID.length == 0) {",
        "        completionID = [[NSUUID UUID] UUIDString];",
        "    }",
    ].join("\n");
}

function insertObjcVoipRegistration(contents) {
    if (
        contents.includes("[RNVoipPushNotificationManager voipRegistration];")
    ) {
        return contents;
    }
    return contents.replace(
        /(-\s*\(BOOL\)application:\(UIApplication \*\)application\s+didFinishLaunchingWithOptions:\(NSDictionary \*\)launchOptions\s*\{)/,
        `$1\n    [RNVoipPushNotificationManager voipRegistration];`,
    );
}

function insertSwiftVoipRegistration(contents) {
    if (contents.includes("vexRegisterVoipPushIfAvailable()")) {
        return contents;
    }
    return contents.replace(
        "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
        "    vexRegisterVoipPushIfAvailable()\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
    );
}

function patchObjcAppDelegate(contents) {
    let next = contents;
    next = addObjcImport(next, "#import <PushKit/PushKit.h>");
    next = addObjcImport(next, '#import "RNVoipPushNotificationManager.h"');
    next = insertObjcVoipRegistration(next);
    if (next.includes(IOS_PUSHKIT_MARKER)) {
        return next;
    }
    const methods = `
// ${IOS_PUSHKIT_MARKER}: forward PushKit callbacks to react-native-voip-push-notification.
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type
{
    [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:(NSString *)type];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type
{
}

- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(PKPushType)type withCompletionHandler:(void (^)(void))completion
{
${completionIDObjcSource()}
    [RNVoipPushNotificationManager addCompletionHandler:completionID completionHandler:completion];
    [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
}

`;
    return next.replace(/@end\s*$/, `${methods}@end\n`);
}

function patchSwiftAppDelegate(contents) {
    let next = addSwiftImport(contents, "import PushKit");
    next = insertSwiftVoipRegistration(next);
    if (next.includes(IOS_PUSHKIT_MARKER)) {
        return next;
    }
    const extension = `

// ${IOS_PUSHKIT_MARKER}: forward PushKit callbacks to react-native-voip-push-notification.
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    vexInvokeVoipPushManager("didUpdatePushCredentials:forType:", credentials, type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
  }

  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    vexInvokeVoipPushManager("didReceiveIncomingPushWithPayload:forType:", payload, type.rawValue)
    completion()
  }

  private func vexRegisterVoipPushIfAvailable() {
    vexInvokeVoipPushManager("voipRegistration")
  }

  private func vexInvokeVoipPushManager(_ selectorName: String) {
    guard let managerClass = NSClassFromString("RNVoipPushNotificationManager") as? NSObject.Type else {
      return
    }
    let selector = NSSelectorFromString(selectorName)
    guard managerClass.responds(to: selector) else {
      return
    }
    _ = managerClass.perform(selector)
  }

  private func vexInvokeVoipPushManager(_ selectorName: String, _ first: Any, _ second: Any) {
    guard let managerClass = NSClassFromString("RNVoipPushNotificationManager") as? NSObject.Type else {
      return
    }
    let selector = NSSelectorFromString(selectorName)
    guard managerClass.responds(to: selector) else {
      return
    }
    _ = managerClass.perform(selector, with: first, with: second)
  }
}
`;
    next = `${next.trimEnd()}${extension}\n`;
    return next;
}

function withIosPushKitDelegate(config) {
    return withAppDelegate(config, (cfg) => {
        const language = cfg.modResults.language;
        if (language === "swift") {
            cfg.modResults.contents = patchSwiftAppDelegate(
                cfg.modResults.contents,
            );
            return cfg;
        }
        if (language === "objc" || language === "objcpp") {
            cfg.modResults.contents = patchObjcAppDelegate(
                cfg.modResults.contents,
            );
            return cfg;
        }
        throw new Error(
            `Cannot configure Vex native calls for AppDelegate language: ${language}`,
        );
    });
}

module.exports = function withNativeCalls(config) {
    config = withAndroidCallKeepServices(config);
    config = withIosVoipBackgroundMode(config);
    config = withIosPushKitDelegate(config);
    return config;
};
