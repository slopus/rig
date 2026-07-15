import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import sharp from "sharp";

import type {
    TerminalColorSnapshot,
    TerminalScreenshotOptions,
    TerminalSnapshot,
} from "./types.js";

export async function renderTerminalSnapshotPng(
    snapshot: TerminalSnapshot,
    outputPath: string,
    options: TerminalScreenshotOptions = {},
): Promise<void> {
    const cellWidth = options.cellWidth ?? 10;
    const cellHeight = options.cellHeight ?? 20;
    const padding = options.padding ?? 16;
    const background = options.background ?? terminalColor(snapshot.defaultBackground, "#0f1115");
    const foreground = options.foreground ?? terminalColor(snapshot.defaultForeground, "#d8dee9");
    const fontFamily = options.fontFamily ?? "SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    const fontSize = options.fontSize ?? 14;
    const columns = Math.max(
        1,
        snapshot.cursor.x + 1,
        ...snapshot.rows.map((row) => [...row].length),
        ...snapshot.cells.map((cell) => cell.x + 1),
    );
    const width = padding * 2 + columns * cellWidth;
    const height = padding * 2 + snapshot.rows.length * cellHeight;
    const backgrounds = snapshot.cells
        .filter((cell) => cell.background !== null)
        .map(
            (cell) =>
                `<rect x="${String(padding + cell.x * cellWidth)}" y="${String(padding + cell.y * cellHeight)}" width="${String(cellWidth)}" height="${String(cellHeight)}" fill="${terminalColor(cell.background, background)}"/>`,
        )
        .join("");
    const text = snapshot.cells
        .filter((cell) => cell.text.length > 0 && cell.text !== " ")
        .map((cell) => {
            const color = terminalColor(cell.foreground, foreground);
            const opacity = cell.dim ? "0.55" : "1";
            const weight = cell.bold ? "700" : "400";
            const style = cell.italic ? "italic" : "normal";
            const x = padding + cell.x * cellWidth;
            const y = padding + cell.y * cellHeight + Math.round(cellHeight * 0.76);
            return `<text x="${String(x)}" y="${String(y)}" fill="${color}" fill-opacity="${opacity}" font-family="${escapeXml(fontFamily)}" font-size="${String(fontSize)}" font-style="${style}" font-weight="${weight}" xml:space="preserve">${escapeXml(cell.text)}</text>`;
        })
        .join("");
    const cursor = snapshot.cursor.visible
        ? `<rect x="${String(padding + snapshot.cursor.x * cellWidth)}" y="${String(padding + snapshot.cursor.y * cellHeight)}" width="${String(cellWidth)}" height="${String(cellHeight)}" fill="none" stroke="${foreground}" stroke-width="1"/>`
        : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><rect width="100%" height="100%" fill="${background}"/>${backgrounds}${text}${cursor}</svg>`;

    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function terminalColor(color: TerminalColorSnapshot | null, fallback: string): string {
    if (color === null) return fallback;
    if (color.kind === "rgb") {
        return `rgb(${String(color.red)},${String(color.green)},${String(color.blue)})`;
    }
    return xtermPaletteColor(color.index);
}

function xtermPaletteColor(index: number): string {
    const ansi = [
        "#000000",
        "#800000",
        "#008000",
        "#808000",
        "#000080",
        "#800080",
        "#008080",
        "#c0c0c0",
        "#808080",
        "#ff0000",
        "#00ff00",
        "#ffff00",
        "#0000ff",
        "#ff00ff",
        "#00ffff",
        "#ffffff",
    ];
    if (index < ansi.length) return ansi[index] ?? "#ffffff";
    if (index >= 232) {
        const value = 8 + (index - 232) * 10;
        return `rgb(${String(value)},${String(value)},${String(value)})`;
    }
    const value = index - 16;
    const channel = (component: number) => {
        const level = Math.floor(value / 6 ** component) % 6;
        return level === 0 ? 0 : 55 + level * 40;
    };
    return `rgb(${String(channel(2))},${String(channel(1))},${String(channel(0))})`;
}
