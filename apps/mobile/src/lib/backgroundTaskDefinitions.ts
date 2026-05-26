import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

export const BACKGROUND_NETWORK_SYNC_TASK = "vex-background-network-sync";
export const BACKGROUND_PUSH_NOTIFICATION_TASK =
    "vex-background-push-notification";

if (!TaskManager.isTaskDefined(BACKGROUND_NETWORK_SYNC_TASK)) {
    TaskManager.defineTask(BACKGROUND_NETWORK_SYNC_TASK, async () => {
        try {
            const { runBackgroundSyncFromTask } =
                await import("./backgroundTaskHandlers");
            const result = await runBackgroundSyncFromTask("background-fetch");
            if (result === "new_data") {
                return BackgroundTask.BackgroundTaskResult.Success;
            }
            if (result === "failed") {
                return BackgroundTask.BackgroundTaskResult.Failed;
            }
            return BackgroundTask.BackgroundTaskResult.Success;
        } catch {
            return BackgroundTask.BackgroundTaskResult.Failed;
        }
    });
}

if (!TaskManager.isTaskDefined(BACKGROUND_PUSH_NOTIFICATION_TASK)) {
    TaskManager.defineTask<Notifications.NotificationTaskPayload>(
        BACKGROUND_PUSH_NOTIFICATION_TASK,
        async ({ data, error }) => {
            if (error) {
                console.warn("[vex-push] background push task failed", {
                    message: error.message,
                });
                return Notifications.BackgroundNotificationTaskResult.Failed;
            }

            try {
                const {
                    runBackgroundSyncFromTask,
                    summarizeBackgroundNotificationTaskPayload,
                } = await import("./backgroundTaskHandlers");

                console.info("[vex-push] background push task received", {
                    ...summarizeBackgroundNotificationTaskPayload(data),
                });

                const result =
                    await runBackgroundSyncFromTask("background-push");
                if (result === "new_data") {
                    return Notifications.BackgroundNotificationTaskResult
                        .NewData;
                }
                if (result === "failed") {
                    return Notifications.BackgroundNotificationTaskResult
                        .Failed;
                }
                return Notifications.BackgroundNotificationTaskResult.NoData;
            } catch {
                return Notifications.BackgroundNotificationTaskResult.Failed;
            }
        },
    );
}
