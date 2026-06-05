/**
 * Image asset module declarations for the Expo/React Native bundler.
 *
 * Metro handles PNG/JPG/SVG imports at build time by converting them to
 * opaque image resource handles. TypeScript needs this declaration so
 * imports like `import img from "../assets/foo.png"` type-check without
 * `no-unsafe-assignment` errors. The runtime value is a number
 * (require handle) on native; passing it to <Image source={...} /> is
 * the only legitimate use.
 */
declare module "*.png" {
    const src: number;
    export default src;
}

declare module "*.jpg" {
    const src: number;
    export default src;
}

declare module "*.jpeg" {
    const src: number;
    export default src;
}

declare module "*.gif" {
    const src: number;
    export default src;
}

declare module "*.webp" {
    const src: number;
    export default src;
}

declare module "*.svg" {
    const src: number;
    export default src;
}

declare module "*.ttf" {
    const src: number;
    export default src;
}
