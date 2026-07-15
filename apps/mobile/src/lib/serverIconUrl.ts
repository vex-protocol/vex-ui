import { getServerOptions, getServerUrl } from "./config";

export function buildServerIconUrl(iconID: string): null | string {
    if (!iconID) {
        return null;
    }
    const options = getServerOptions();
    const protocol = options.unsafeHttp === true ? "http" : "https";
    return `${protocol}://${getServerUrl()}/server-icon/${iconID}`;
}
