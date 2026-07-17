use std::cell::RefCell;
use std::io::{self, BufRead, Write};

use base64::{Engine, engine::general_purpose::STANDARD};
use libghostty_vt::render::CursorVisualStyle;
use libghostty_vt::screen::CellWide;
use libghostty_vt::style::{RgbColor, Style, StyleColor, Underline};
use libghostty_vt::terminal::{Point, PointCoordinate};
use libghostty_vt::{RenderState, Terminal, TerminalOptions};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Initialize {
        cols: u16,
        rows: u16,
        max_scrollback: usize,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    Snapshot {
        request_id: u64,
        start_row: Option<u32>,
        row_count: Option<u16>,
    },
    Write {
        data: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Color {
    Palette { index: u8 },
    Rgb { red: u8, green: u8, blue: u8 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Cell {
    style: CellStyle,
    text: String,
    width: u8,
    x: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CellStyle {
    background: Option<Color>,
    blink: bool,
    bold: bool,
    dim: bool,
    foreground: Option<Color>,
    invisible: bool,
    inverse: bool,
    italic: bool,
    overline: bool,
    strikethrough: bool,
    underline: UnderlineStyle,
    underline_color: Option<Color>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum UnderlineStyle {
    Curly,
    Dashed,
    Dotted,
    Double,
    None,
    Single,
}

#[derive(Serialize)]
struct Cursor {
    blinking: bool,
    shape: CursorShape,
    visible: bool,
    x: u16,
    y: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum CursorShape {
    Bar,
    Block,
    BlockHollow,
    Underline,
}

#[derive(Serialize)]
struct Row {
    cells: Vec<Cell>,
    wrapped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    cols: u16,
    cursor: Option<Cursor>,
    cursor_color: Option<Color>,
    default_background: Color,
    default_foreground: Color,
    request_id: u64,
    palette: Vec<Color>,
    rows: Vec<Row>,
    start_row: u32,
    title: String,
    total_rows: u32,
}

#[derive(Serialize)]
struct PtyWrite {
    event: &'static str,
    data: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let initialize = lines
        .next()
        .ok_or("The initialize command is required.")??;
    let Command::Initialize {
        cols,
        rows,
        max_scrollback,
    } = serde_json::from_str::<Command>(&initialize)?
    else {
        return Err("The first command must initialize the terminal.".into());
    };

    let pty_writes = RefCell::new(Vec::<Vec<u8>>::new());
    let default_fg = RgbColor {
        r: 0xee,
        g: 0xee,
        b: 0xee,
    };
    let default_bg = RgbColor {
        r: 0x0d,
        g: 0x0d,
        b: 0x0d,
    };
    let mut terminal = Terminal::new(TerminalOptions {
        cols,
        rows,
        max_scrollback,
    })?;
    terminal
        .set_default_fg_color(Some(default_fg))?
        .set_default_bg_color(Some(default_bg))?
        .on_pty_write({
            let pty_writes = &pty_writes;
            move |_terminal, data| pty_writes.borrow_mut().push(data.to_vec())
        })?;
    let mut render_state = RenderState::new()?;
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in lines {
        match serde_json::from_str::<Command>(&line?)? {
            Command::Initialize { .. } => return Err("The terminal is already initialized.".into()),
            Command::Resize { cols, rows } => terminal.resize(cols, rows, 8, 16)?,
            Command::Write { data } => {
                terminal.vt_write(&STANDARD.decode(data)?);
                for data in pty_writes.borrow_mut().drain(..) {
                    serde_json::to_writer(
                        &mut stdout,
                        &PtyWrite {
                            event: "pty_write",
                            data: STANDARD.encode(data),
                        },
                    )?;
                    stdout.write_all(b"\n")?;
                }
                stdout.flush()?;
            }
            Command::Snapshot {
                request_id,
                start_row,
                row_count,
            } => {
                serde_json::to_writer(
                    &mut stdout,
                    &snapshot(
                        &terminal,
                        &mut render_state,
                        request_id,
                        start_row,
                        row_count,
                    )?,
                )?;
                stdout.write_all(b"\n")?;
                stdout.flush()?;
            }
        }
    }
    Ok(())
}

fn snapshot<'alloc, 'cb>(
    terminal: &Terminal<'alloc, 'cb>,
    render_state: &mut RenderState<'alloc>,
    request_id: u64,
    requested_start: Option<u32>,
    requested_count: Option<u16>,
) -> Result<Snapshot, Box<dyn std::error::Error>> {
    let cols = terminal.cols()?;
    let visible_rows = terminal.rows()?;
    let total_rows = u32::try_from(terminal.total_rows()?)?;
    let requested_row_count = requested_count.unwrap_or(visible_rows).max(1);
    let default_start = total_rows.saturating_sub(u32::from(requested_row_count));
    let start_row = requested_start.unwrap_or(default_start).min(total_rows);
    let row_count =
        u16::try_from(u32::from(requested_row_count).min(total_rows.saturating_sub(start_row)))?;
    let mut rows = Vec::with_capacity(usize::from(row_count));

    for y in start_row..start_row.saturating_add(u32::from(row_count)) {
        let row_ref = terminal.grid_ref(Point::Screen(PointCoordinate { x: 0, y }))?;
        let wrapped = row_ref.row()?.is_wrapped()?;
        let mut cells = Vec::new();
        for x in 0..cols {
            let grid_ref = terminal.grid_ref(Point::Screen(PointCoordinate { x, y }))?;
            let value = grid_ref.cell()?;
            let wide = value.wide()?;
            if matches!(wide, CellWide::SpacerTail) {
                continue;
            }
            let style = grid_ref.style()?;
            if !value.has_text()? && style.is_default() {
                continue;
            }
            let text = if value.has_text()? {
                let mut graphemes = ['\0'; 32];
                let length = grid_ref.graphemes(&mut graphemes)?;
                graphemes[..length].iter().collect()
            } else {
                " ".to_owned()
            };
            cells.push(Cell {
                style: cell_style(style),
                text,
                width: if matches!(wide, CellWide::Wide) { 2 } else { 1 },
                x,
            });
        }
        rows.push(Row { cells, wrapped });
    }

    let cursor_screen_y =
        u32::try_from(terminal.scrollback_rows()?)?.saturating_add(u32::from(terminal.cursor_y()?));
    let render_snapshot = render_state.update(terminal)?;
    let render_colors = render_snapshot.colors()?;
    let cursor = if cursor_screen_y >= start_row
        && cursor_screen_y < start_row.saturating_add(u32::from(row_count))
    {
        Some(Cursor {
            blinking: render_snapshot.cursor_blinking()?,
            shape: match render_snapshot.cursor_visual_style()? {
                CursorVisualStyle::Bar => CursorShape::Bar,
                CursorVisualStyle::Block => CursorShape::Block,
                CursorVisualStyle::Underline => CursorShape::Underline,
                CursorVisualStyle::BlockHollow => CursorShape::BlockHollow,
                _ => CursorShape::Block,
            },
            visible: terminal.is_cursor_visible()?,
            x: terminal.cursor_x()?,
            y: u16::try_from(cursor_screen_y - start_row)?,
        })
    } else {
        None
    };

    Ok(Snapshot {
        cols,
        cursor,
        cursor_color: render_colors.cursor.map(rgb_color),
        default_background: rgb_color(render_colors.background),
        default_foreground: rgb_color(render_colors.foreground),
        palette: render_colors.palette.into_iter().map(rgb_color).collect(),
        request_id,
        rows,
        start_row,
        title: terminal.title()?.to_owned(),
        total_rows,
    })
}

fn cell_style(style: Style) -> CellStyle {
    CellStyle {
        background: color(style.bg_color),
        blink: style.blink,
        bold: style.bold,
        dim: style.faint,
        foreground: color(style.fg_color),
        invisible: style.invisible,
        inverse: style.inverse,
        italic: style.italic,
        overline: style.overline,
        strikethrough: style.strikethrough,
        underline: match style.underline {
            Underline::None => UnderlineStyle::None,
            Underline::Single => UnderlineStyle::Single,
            Underline::Double => UnderlineStyle::Double,
            Underline::Curly => UnderlineStyle::Curly,
            Underline::Dotted => UnderlineStyle::Dotted,
            Underline::Dashed => UnderlineStyle::Dashed,
            _ => UnderlineStyle::None,
        },
        underline_color: color(style.underline_color),
    }
}

fn color(value: StyleColor) -> Option<Color> {
    match value {
        StyleColor::None => None,
        StyleColor::Palette(index) => Some(Color::Palette { index: index.0 }),
        StyleColor::Rgb(value) => Some(rgb_color(value)),
    }
}

fn rgb_color(value: RgbColor) -> Color {
    Color::Rgb {
        red: value.r,
        green: value.g,
        blue: value.b,
    }
}
