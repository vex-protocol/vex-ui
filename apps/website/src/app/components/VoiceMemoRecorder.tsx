import { LoaderCircle, Mic, Square, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

const MAX_RECORDING_MS = 10 * 60 * 1_000;

type RecordingPhase = "recording" | "starting" | "stopping";

interface VoiceMemoRecorderProps {
    onCancel: () => void;
    onError: (message: string) => void;
    onRecorded: (file: File) => void;
}

export function VoiceMemoRecorder({
    onCancel,
    onError,
    onRecorded,
}: VoiceMemoRecorderProps) {
    const [phase, setPhaseState] = useState<RecordingPhase>("starting");
    const [elapsed, setElapsed] = useState(0);
    const activeRef = useRef(true);
    const cancelledRef = useRef(false);
    const chunksRef = useRef<Blob[]>([]);
    const phaseRef = useRef<RecordingPhase>("starting");
    const recorderRef = useRef<MediaRecorder | null>(null);
    const startedAtRef = useRef(0);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<number | null>(null);
    const limitRef = useRef<number | null>(null);

    useEffect(() => {
        activeRef.current = true;
        void startRecording();
        return () => {
            activeRef.current = false;
            cancelledRef.current = true;
            stopTimers();
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== "inactive") recorder.stop();
            stopStream();
        };
    }, []);

    function setPhase(next: RecordingPhase) {
        phaseRef.current = next;
        if (activeRef.current) setPhaseState(next);
    }

    async function startRecording() {
        if (
            typeof navigator.mediaDevices?.getUserMedia !== "function" ||
            typeof globalThis.MediaRecorder !== "function"
        ) {
            fail("Voice recording is not available in this browser.");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    autoGainControl: true,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
                video: false,
            });
            if (!activeRef.current) {
                for (const track of stream.getTracks()) track.stop();
                return;
            }
            streamRef.current = stream;
            const mimeType = preferredAudioMimeType();
            const recorder = new MediaRecorder(stream, {
                audioBitsPerSecond: 64_000,
                ...(mimeType ? { mimeType } : {}),
            });
            recorderRef.current = recorder;
            recorder.ondataavailable = ({ data }) => {
                if (data.size > 0) chunksRef.current.push(data);
            };
            recorder.onerror = () => {
                fail("The browser could not record this voice message.");
            };
            recorder.onstop = finishRecording;
            recorder.start(750);
            startedAtRef.current = Date.now();
            setElapsed(0);
            setPhase("recording");
            intervalRef.current = window.setInterval(() => {
                setElapsed(Date.now() - startedAtRef.current);
            }, 250);
            limitRef.current = window.setTimeout(
                requestFinish,
                MAX_RECORDING_MS,
            );
        } catch (cause: unknown) {
            fail(recordingErrorMessage(cause));
        }
    }

    function requestFinish() {
        const recorder = recorderRef.current;
        if (
            phaseRef.current !== "recording" ||
            !recorder ||
            recorder.state === "inactive"
        ) {
            return;
        }
        setPhase("stopping");
        stopTimers();
        recorder.stop();
    }

    function cancel() {
        cancelledRef.current = true;
        stopTimers();
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stopStream();
        onCancel();
    }

    function finishRecording() {
        stopTimers();
        stopStream();
        if (!activeRef.current || cancelledRef.current) return;
        const recorder = recorderRef.current;
        const type =
            recorder?.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) {
            fail(
                "No audio was captured. Check microphone access and try again.",
            );
            return;
        }
        onRecorded(
            new File([blob], voiceMemoFileName(type), {
                lastModified: Date.now(),
                type,
            }),
        );
    }

    function fail(message: string) {
        cancelledRef.current = true;
        stopTimers();
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stopStream();
        if (!activeRef.current) return;
        onError(message);
        onCancel();
    }

    function stopStream() {
        for (const track of streamRef.current?.getTracks() ?? []) track.stop();
        streamRef.current = null;
    }

    function stopTimers() {
        if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (limitRef.current !== null) {
            window.clearTimeout(limitRef.current);
            limitRef.current = null;
        }
    }

    return (
        <div className="voice-recorder" role="status">
            <span
                className={
                    phase === "recording"
                        ? "voice-recorder__signal is-live"
                        : "voice-recorder__signal"
                }
            >
                {phase === "starting" ? (
                    <LoaderCircle className="spin" size={18} />
                ) : (
                    <Mic size={18} />
                )}
            </span>
            <span className="voice-recorder__copy">
                <strong>
                    {phase === "starting"
                        ? "Opening microphone"
                        : phase === "stopping"
                          ? "Preparing voice message"
                          : "Recording"}
                </strong>
                <small>{formatDuration(elapsed)}</small>
            </span>
            <button
                aria-label="Cancel voice message"
                title="Cancel"
                type="button"
                onClick={cancel}
            >
                <X size={17} />
            </button>
            <button
                aria-label="Finish voice message"
                className="voice-recorder__finish"
                disabled={phase !== "recording"}
                title="Finish recording"
                type="button"
                onClick={requestFinish}
            >
                <Square size={14} fill="currentColor" />
            </button>
        </div>
    );
}

function formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
}

function preferredAudioMimeType(): string {
    for (const type of [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "audio/webm",
    ]) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "";
}

function recordingErrorMessage(cause: unknown): string {
    if (cause instanceof DOMException) {
        if (
            cause.name === "NotAllowedError" ||
            cause.name === "PermissionDeniedError"
        ) {
            return "Microphone access is off. Allow it in browser settings to send a voice message.";
        }
        if (cause.name === "NotFoundError") {
            return "No microphone is available.";
        }
    }
    return cause instanceof Error && cause.message
        ? cause.message
        : "The browser could not start voice recording.";
}

function voiceMemoFileName(contentType: string): string {
    const extension = contentType.includes("mp4")
        ? "m4a"
        : contentType.includes("ogg")
          ? "ogg"
          : "webm";
    const timestamp = new Date().toISOString().replace(/[.:]/gu, "-");
    return `voice-message-${timestamp}.${extension}`;
}
