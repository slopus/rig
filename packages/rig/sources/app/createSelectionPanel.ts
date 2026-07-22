import {
    matchesKey,
    SelectList,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
    type Component,
    type SelectItem,
} from "@earendil-works/pi-tui";

import { sanitizeTerminalText } from "./sanitizeTerminalText.js";
import { DEFAULT_TERMINAL_THEME } from "./defaultTerminalTheme.js";
import type { TerminalTheme } from "./TerminalTheme.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NOT_BOLD_OR_DIM = "\x1b[22m";

export interface CreateSelectionPanelOptions {
    cancelDisabled?: boolean;
    title: string;
    subtitle: string;
    items: readonly SelectItem[];
    selectedValue?: string;
    onSelect: (item: SelectItem) => void;
    onCancel: () => void;
    theme?: TerminalTheme;
}

export function createSelectionPanel(options: CreateSelectionPanelOptions): Component {
    return new SelectionPanel(options);
}

class SelectionPanel implements Component {
    readonly #cancelDisabled: boolean;
    readonly #items: SelectItem[];
    #list: SelectList;
    #maxVisible = 8;
    readonly #onCancel: () => void;
    readonly #onSelect: (item: SelectItem) => void;
    readonly #subtitle: string;
    readonly #title: string;
    readonly #theme: TerminalTheme;

    constructor(options: CreateSelectionPanelOptions) {
        this.#cancelDisabled = options.cancelDisabled === true;
        this.#title = sanitizeTerminalText(options.title);
        this.#subtitle = sanitizeTerminalText(options.subtitle);
        this.#theme = options.theme ?? DEFAULT_TERMINAL_THEME;
        this.#items = options.items.map((item) => ({
            ...item,
            label: sanitizeTerminalText(item.label),
            ...(item.description === undefined
                ? {}
                : { description: sanitizeTerminalText(item.description) }),
        }));
        this.#onSelect = options.onSelect;
        this.#onCancel = options.onCancel;
        this.#list = this.#createList(this.#maxVisible);

        const selectedIndex = options.items.findIndex(
            (item) => item.value === options.selectedValue,
        );
        if (selectedIndex >= 0) {
            this.#list.setSelectedIndex(selectedIndex);
        }
    }

    fitToViewport(width: number, height: number): void {
        const contentWidth = Math.max(1, width - 2);
        const subtitleRows = wrapTextWithAnsi(this.#subtitle, contentWidth).length;
        const listRowsWithoutScroll = Math.max(1, height - subtitleRows - 6);
        const maxVisible =
            this.#items.length <= listRowsWithoutScroll
                ? Math.max(1, this.#items.length)
                : Math.max(1, listRowsWithoutScroll - 1);
        if (maxVisible === this.#maxVisible) return;

        const selectedValue = this.#list.getSelectedItem()?.value;
        this.#maxVisible = maxVisible;
        this.#list = this.#createList(maxVisible);
        const selectedIndex = this.#items.findIndex((item) => item.value === selectedValue);
        if (selectedIndex >= 0) this.#list.setSelectedIndex(selectedIndex);
    }

    invalidate(): void {
        this.#list.invalidate();
    }

    render(width: number): string[] {
        const safeWidth = Math.max(1, width);
        const contentWidth = Math.max(1, safeWidth - 2);
        const subtitleLines = wrapTextWithAnsi(this.#subtitle, contentWidth);
        const lines = [
            "",
            `  ${this.#theme.brand}${BOLD}${this.#title}${NOT_BOLD_OR_DIM}${this.#theme.primary}`,
            ...subtitleLines.map(
                (line) => `  ${this.#theme.secondary}${line}${this.#theme.primary}`,
            ),
            "",
            ...this.#list.render(contentWidth).map((line) => `  ${line}`),
            "",
            `  ${DIM}${this.#theme.secondary}${
                this.#cancelDisabled
                    ? "Use ↑/↓ to move and Enter to select."
                    : "Use ↑/↓ to move, Enter to select, Esc to cancel."
            }${this.#theme.primary}`,
            "",
        ];

        return lines.map((line) => this.#surfaceLine(line, safeWidth));
    }

    handleInput(data: string): void {
        if (this.#cancelDisabled && matchesKey(data, "escape")) return;
        this.#list.handleInput(data);
    }

    #surfaceLine(content: string, width: number): string {
        const restored = content.replaceAll(
            RESET,
            `${RESET}${this.#theme.inputBackground}${this.#theme.primary}`,
        );
        const fitted = truncateToWidth(restored, width, "", true);
        const padding = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
        return `${this.#theme.inputBackground}${this.#theme.primary}${fitted}${padding}${RESET}`;
    }

    #createList(maxVisible: number): SelectList {
        const list = new SelectList(
            this.#items,
            maxVisible,
            {
                selectedPrefix: (text) => `${this.#theme.brand}${text}${RESET}`,
                selectedText: (text) => `${this.#theme.brand}${text}${RESET}${this.#theme.primary}`,
                description: (text) => `${DIM}${this.#theme.secondary}${text}${RESET}`,
                scrollInfo: (text) => `${DIM}${this.#theme.secondary}${text}${RESET}`,
                noMatch: (text) => `${this.#theme.secondary}${text}${RESET}`,
            },
            {
                minPrimaryColumnWidth: 18,
                maxPrimaryColumnWidth: 28,
            },
        );
        list.onSelect = this.#onSelect;
        list.onCancel = this.#onCancel;
        return list;
    }
}

export function fitSelectionPanelToViewport(
    component: Component,
    width: number,
    height: number,
): void {
    if (component instanceof SelectionPanel) component.fitToViewport(width, height);
}
