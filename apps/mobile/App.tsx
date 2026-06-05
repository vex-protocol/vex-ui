import React, { Suspense, useMemo, useState } from "react";

import { useFonts } from "expo-font";

import chivoMonoFont from "./src/assets/fonts/ChivoMono-Light.ttf";
import interFont from "./src/assets/fonts/Inter-Medium.ttf";
import spaceGroteskFont from "./src/assets/fonts/SpaceGrotesk-Medium.ttf";
import {
    PrebootSplash,
    PrebootUpdateGate,
} from "./src/components/PrebootUpdateGate";

function App() {
    // TODO: Register full font weights for exact Android fidelity:
    // SpaceGrotesk-Bold, Inter-Regular, Inter-SemiBold, ChivoMono-Regular.
    const [fontsLoaded] = useFonts({
        ChivoMono: chivoMonoFont,
        Inter: interFont,
        SpaceGrotesk: spaceGroteskFont,
    });
    const [prebootComplete, setPrebootComplete] = useState(false);
    const MainApp = useMemo(
        () => React.lazy(() => import("./src/MainApp")),
        [],
    );

    if (!fontsLoaded) {
        return (
            <PrebootSplash
                message="Loading secure app shell..."
                progress={1}
                title="Opening Vex"
            />
        );
    }

    if (!prebootComplete) {
        return (
            <PrebootUpdateGate
                onComplete={() => {
                    setPrebootComplete(true);
                }}
            />
        );
    }

    return (
        <Suspense
            fallback={
                <PrebootSplash
                    message="Loading secure app shell..."
                    progress={1}
                    title="Opening Vex"
                />
            }
        >
            <MainApp />
        </Suspense>
    );
}

export default App;
