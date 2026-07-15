const fs = require("node:fs");
const path = require("node:path");

const {
    IOSConfig,
    withDangerousMod,
    withXcodeProject,
} = require("expo/config-plugins");

const DEFAULT_ICON_NAME = "AppIcon";

function setCompiledIconName(project, projectName, iconName) {
    const { target } = IOSConfig.XcodeUtils.getApplicationNativeTarget({
        project,
        projectName,
    });
    const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
        project,
        target.buildConfigurationList,
    );

    for (const [, configuration] of configurations) {
        if (configuration?.buildSettings) {
            configuration.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME =
                iconName;
        }
    }
}

module.exports = function withIosAppIconName(config, props) {
    const iconName = props?.name;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(iconName ?? "")) {
        throw new Error("withIosAppIconName requires an alphanumeric name.");
    }

    config = withDangerousMod(config, [
        "ios",
        async (modConfig) => {
            const projectName = modConfig.modRequest.projectName;
            if (!projectName) {
                throw new Error("Could not resolve the iOS project name.");
            }

            const assetCatalog = path.join(
                modConfig.modRequest.platformProjectRoot,
                projectName,
                "Images.xcassets",
            );
            const defaultIcon = path.join(
                assetCatalog,
                `${DEFAULT_ICON_NAME}.appiconset`,
            );
            const versionedIcon = path.join(
                assetCatalog,
                `${iconName}.appiconset`,
            );

            await fs.promises.rm(versionedIcon, {
                force: true,
                recursive: true,
            });
            await fs.promises.rename(defaultIcon, versionedIcon);
            return modConfig;
        },
    ]);

    return withXcodeProject(config, (modConfig) => {
        const projectName = modConfig.modRequest.projectName;
        if (!projectName) {
            throw new Error("Could not resolve the iOS project name.");
        }
        setCompiledIconName(modConfig.modResults, projectName, iconName);
        return modConfig;
    });
};
