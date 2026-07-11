use std::io::{self, BufRead, Write};

use base64::{Engine, engine::general_purpose::STANDARD};
use libghostty_vt::terminal::{Point, PointCoordinate, ScrollViewport};
use libghostty_vt::{Terminal, TerminalOptions};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Resize { cols: u16, rows: u16 },
    ScrollBottom,
    ScrollBy { rows: isize },
    ScrollTop,
    Snapshot { id: u64 },
    Write { data: String },
}

#[derive(Serialize)]
struct Cursor {
    visible: bool,
    x: u16,
    y: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Scroll {
    at_bottom: bool,
    at_top: bool,
    bottom_departure_count: u64,
    offset: u64,
    top_arrival_count: u64,
    total_rows: u64,
    visible_rows: u64,
}

#[derive(Serialize)]
struct Snapshot {
    cursor: Cursor,
    id: u64,
    rows: Vec<String>,
    scroll: Scroll,
    text: String,
    title: String,
}

struct ScrollTracker {
    bottom_departure_count: u64,
    last_at_bottom: bool,
    last_at_top: bool,
    top_arrival_count: u64,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut terminal = Terminal::new(TerminalOptions {
        cols: 80,
        rows: 24,
        max_scrollback: 10_000,
    })?;
    let mut scroll_tracker = ScrollTracker::new(&terminal)?;

    for line in stdin.lock().lines() {
        match serde_json::from_str::<Command>(&line?)? {
            Command::Resize { cols, rows } => {
                terminal.resize(cols, rows, 8, 16)?;
                scroll_tracker.observe(&terminal)?;
            }
            Command::ScrollBottom => {
                terminal.scroll_viewport(ScrollViewport::Bottom);
                scroll_tracker.observe(&terminal)?;
            }
            Command::ScrollBy { rows } => {
                terminal.scroll_viewport(ScrollViewport::Delta(rows));
                scroll_tracker.observe(&terminal)?;
            }
            Command::ScrollTop => {
                terminal.scroll_viewport(ScrollViewport::Top);
                scroll_tracker.observe(&terminal)?;
            }
            Command::Write { data } => {
                terminal.vt_write(&STANDARD.decode(data)?);
                scroll_tracker.observe(&terminal)?;
            }
            Command::Snapshot { id } => {
                serde_json::to_writer(&mut stdout, &snapshot(&terminal, &scroll_tracker, id)?)?;
                stdout.write_all(b"\n")?;
                stdout.flush()?;
            }
        }
    }
    Ok(())
}

impl ScrollTracker {
    fn new(terminal: &Terminal<'_, '_>) -> Result<Self, Box<dyn std::error::Error>> {
        let scrollbar = terminal.scrollbar()?;
        Ok(Self {
            bottom_departure_count: 0,
            last_at_bottom: is_at_bottom(scrollbar.total, scrollbar.offset, scrollbar.len),
            last_at_top: is_at_top(scrollbar.total, scrollbar.offset, scrollbar.len),
            top_arrival_count: 0,
        })
    }

    fn observe(&mut self, terminal: &Terminal<'_, '_>) -> Result<(), Box<dyn std::error::Error>> {
        let scrollbar = terminal.scrollbar()?;
        let at_bottom = is_at_bottom(scrollbar.total, scrollbar.offset, scrollbar.len);
        let at_top = is_at_top(scrollbar.total, scrollbar.offset, scrollbar.len);
        if self.last_at_bottom && !at_bottom {
            self.bottom_departure_count += 1;
        }
        if !self.last_at_top && at_top {
            self.top_arrival_count += 1;
        }
        self.last_at_bottom = at_bottom;
        self.last_at_top = at_top;
        Ok(())
    }
}

fn is_at_bottom(total: u64, offset: u64, visible: u64) -> bool {
    offset.saturating_add(visible) >= total
}

fn is_at_top(total: u64, offset: u64, visible: u64) -> bool {
    total > visible && offset == 0
}

fn snapshot(
    terminal: &Terminal<'_, '_>,
    scroll_tracker: &ScrollTracker,
    id: u64,
) -> Result<Snapshot, Box<dyn std::error::Error>> {
    let cols = terminal.cols()?;
    let row_count = terminal.rows()?;
    let mut rows = Vec::with_capacity(usize::from(row_count));
    for y in 0..row_count {
        let mut line = String::new();
        for x in 0..cols {
            let cell =
                terminal.grid_ref(Point::Viewport(PointCoordinate { x, y: u32::from(y) }))?;
            let value = cell.cell()?;
            if value.has_text()? {
                let mut graphemes = ['\0'; 16];
                let length = cell.graphemes(&mut graphemes)?;
                line.extend(graphemes[..length].iter());
            } else if !matches!(value.wide()?, libghostty_vt::screen::CellWide::SpacerTail) {
                line.push(' ');
            }
        }
        rows.push(line.trim_end().to_owned());
    }
    let text = rows.join("\n").trim_end().to_owned();
    let scrollbar = terminal.scrollbar()?;
    Ok(Snapshot {
        cursor: Cursor {
            visible: terminal.is_cursor_visible()?,
            x: terminal.cursor_x()?,
            y: terminal.cursor_y()?,
        },
        id,
        rows,
        scroll: Scroll {
            at_bottom: is_at_bottom(scrollbar.total, scrollbar.offset, scrollbar.len),
            at_top: is_at_top(scrollbar.total, scrollbar.offset, scrollbar.len),
            bottom_departure_count: scroll_tracker.bottom_departure_count,
            offset: scrollbar.offset,
            top_arrival_count: scroll_tracker.top_arrival_count,
            total_rows: scrollbar.total,
            visible_rows: scrollbar.len,
        },
        text,
        title: terminal.title()?.to_owned(),
    })
}
