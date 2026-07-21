import { render } from "preact";
import { App } from "./App";
import "./tailwind.css";
import "./styles.css";

render(<App />, document.getElementById("root") as HTMLElement);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener(
        "load",
        () => {
            void navigator.serviceWorker.register("/sw.js", { scope: "/" });
        },
        { once: true },
    );
}
