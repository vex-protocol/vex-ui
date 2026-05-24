import React, { Suspense, useMemo, useState } from "react";

import {
    PrebootSplash,
    PrebootUpdateGate,
} from "./src/components/PrebootUpdateGate";

function App() {
    const [prebootComplete, setPrebootComplete] = useState(false);
    const MainApp = useMemo(
        () => React.lazy(() => import("./src/MainApp")),
        [],
    );

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
