const INPUT_BURST_WINDOW_MS = 8;

export interface TerminalInputBurstHandler {
    dispose(): void;
    handle(data: string): void;
}

export function createTerminalInputBurstHandler(
    onInput: (data: string) => void,
): TerminalInputBurstHandler {
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clearTimer = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };

    const flush = (): void => {
        clearTimer();
        if (buffer.length === 0) return;
        const input = buffer;
        buffer = "";
        onInput(input);
    };

    const isTextInput = (data: string): boolean => {
        if (data.length === 0) return false;
        for (const character of data) {
            const codePoint = character.codePointAt(0) ?? 0;
            if (codePoint === 9 || codePoint === 10) continue;
            if (codePoint < 32 || codePoint === 127) return false;
        }
        return true;
    };

    return {
        dispose(): void {
            clearTimer();
            buffer = "";
        },
        handle(data: string): void {
            if (!isTextInput(data)) {
                flush();
                onInput(data);
                return;
            }

            buffer += data;
            clearTimer();
            timer = setTimeout(flush, INPUT_BURST_WINDOW_MS);
            timer.unref?.();
        },
    };
}
