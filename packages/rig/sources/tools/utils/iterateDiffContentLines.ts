export function* iterateDiffContentLines(content: string): Generator<string> {
    let lineStart = 0;
    for (let index = 0; index < content.length; index++) {
        const character = content[index];
        if (character !== "\n" && character !== "\r") continue;

        yield content.slice(lineStart, index);
        if (character === "\r" && content[index + 1] === "\n") index += 1;
        lineStart = index + 1;
    }

    if (lineStart < content.length) yield content.slice(lineStart);
}
