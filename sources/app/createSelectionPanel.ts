import {
  SelectList,
  truncateToWidth,
  visibleWidth,
  type Component,
  type SelectItem,
} from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NOT_BOLD_OR_DIM = "\x1b[22m";
const ORANGE = "\x1b[38;5;202m";
const SURFACE_BG = "\x1b[48;5;236m";
const INPUT_FG = "\x1b[38;5;255m";
const MUTED = "\x1b[38;5;245m";

export interface CreateSelectionPanelOptions {
  title: string;
  subtitle: string;
  items: readonly SelectItem[];
  selectedValue?: string;
  onSelect: (item: SelectItem) => void;
  onCancel: () => void;
}

export function createSelectionPanel(
  options: CreateSelectionPanelOptions,
): Component {
  return new SelectionPanel(options);
}

class SelectionPanel implements Component {
  readonly #list: SelectList;
  readonly #subtitle: string;
  readonly #title: string;

  constructor(options: CreateSelectionPanelOptions) {
    this.#title = options.title;
    this.#subtitle = options.subtitle;
    this.#list = new SelectList([...options.items], 8, {
      selectedPrefix: (text) => `${ORANGE}${text}${RESET}`,
      selectedText: (text) => `${ORANGE}${text}${RESET}${INPUT_FG}`,
      description: (text) => `${DIM}${MUTED}${text}${RESET}`,
      scrollInfo: (text) => `${DIM}${MUTED}${text}${RESET}`,
      noMatch: (text) => `${MUTED}${text}${RESET}`,
    }, {
      minPrimaryColumnWidth: 18,
      maxPrimaryColumnWidth: 28,
    });
    this.#list.onSelect = options.onSelect;
    this.#list.onCancel = options.onCancel;

    const selectedIndex = options.items.findIndex((item) =>
      item.value === options.selectedValue,
    );
    if (selectedIndex >= 0) {
      this.#list.setSelectedIndex(selectedIndex);
    }
  }

  invalidate(): void {
    this.#list.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(24, width);
    const contentWidth = Math.max(1, safeWidth - 2);
    const lines = [
      "",
      `  ${ORANGE}${BOLD}${this.#title}${NOT_BOLD_OR_DIM}${INPUT_FG}`,
      `  ${MUTED}${this.#subtitle}${INPUT_FG}`,
      "",
      ...this.#list.render(contentWidth).map((line) => `  ${line}`),
      "",
      `  ${DIM}${MUTED}Use ↑/↓ to move, Enter to select, Esc to cancel.${INPUT_FG}`,
      "",
    ];

    return lines.map((line) => this.#surfaceLine(line, safeWidth));
  }

  handleInput(data: string): void {
    this.#list.handleInput(data);
  }

  #surfaceLine(content: string, width: number): string {
    const restored = content.replaceAll(RESET, `${RESET}${SURFACE_BG}${INPUT_FG}`);
    const fitted = truncateToWidth(restored, width, "", true);
    const padding = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
    return `${SURFACE_BG}${INPUT_FG}${fitted}${padding}${RESET}`;
  }
}
