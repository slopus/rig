export function formatGrokCompactionSummary(summary: string): string {
    let result = summary;
    for (;;) {
        const analysisStart = result.indexOf("<analysis>");
        const summaryStart = result.indexOf("<summary>");
        const leading =
            analysisStart !== -1 &&
            (summaryStart === -1 ||
                analysisStart < summaryStart ||
                result.slice(summaryStart + "<summary>".length, analysisStart).trim() === "");
        if (!leading) break;

        const analysisEnd = result.indexOf("</analysis>", analysisStart);
        if (analysisEnd === -1) {
            result =
                summaryStart === -1 || summaryStart < analysisStart
                    ? result.slice(0, analysisStart)
                    : result.slice(0, analysisStart) + result.slice(summaryStart);
            break;
        }
        result = result.slice(0, analysisStart) + result.slice(analysisEnd + "</analysis>".length);
    }

    const summaryStart = result.indexOf("<summary>");
    const summaryEnd = result.lastIndexOf("</summary>");
    if (summaryStart !== -1 && summaryEnd > summaryStart) {
        const before = result.slice(0, summaryStart);
        const after = result.slice(summaryEnd + "</summary>".length);
        const inner = stripLeadingScratchpad(
            result.slice(summaryStart + "<summary>".length, summaryEnd).trim(),
        );
        result = `${before}Summary:\n${inner}${after}`;
    }

    result = neutralizeControlTokens(result);
    while (result.includes("\n\n\n")) result = result.replaceAll("\n\n\n", "\n\n");
    return result.trim();
}

function stripLeadingScratchpad(content: string): string {
    let result = content.trim();
    const lead = result.replace(/^[#*\->\s]+/u, "");
    if (!/^\d/u.test(lead)) {
        const analysisEnd = result.lastIndexOf("</analysis>");
        if (analysisEnd !== -1) {
            result = result.slice(analysisEnd + "</analysis>".length).trimStart();
        }
    }
    if (result.startsWith("<summary>")) {
        result = result.slice("<summary>".length).trimStart();
    }
    return result;
}

function neutralizeControlTokens(content: string): string {
    return content
        .replaceAll("</summary>", "<\u200b/summary>")
        .replaceAll("<summary>", "<\u200bsummary>")
        .replaceAll("</analysis>", "<\u200b/analysis>")
        .replaceAll("<analysis>", "<\u200banalysis>")
        .replaceAll("</summary_request>", "<\u200b/summary_request>")
        .replaceAll("<summary_request>", "<\u200bsummary_request>");
}
