/// <reference types="vite/client" />

import type { JSX as PreactJSX } from "preact";

declare global {
    namespace JSX {
        type Element = PreactJSX.Element;
    }
}
