const std = @import("std");
const vt = @import("ghostty-vt");

const allocator = std.heap.wasm_allocator;
const CellBytes = 24;

pub const std_options: std.Options = .{ .logFn = wasmLog };

fn wasmLog(
    comptime level: std.log.Level,
    comptime scope: @TypeOf(.enum_literal),
    comptime format: []const u8,
    args: anytype,
) void {
    _ = level;
    _ = scope;
    _ = format;
    _ = args;
}

const State = struct {
    terminal: vt.Terminal,
    stream: vt.ReadonlyStream,
    render: vt.RenderState,
};

fn stateFromPtr(ptr: usize) *State {
    return @ptrFromInt(ptr);
}

fn rgb(r: u8, g: u8, b: u8) vt.color.RGB {
    return .{ .r = r, .g = g, .b = b };
}

export fn init(cols: u16, rows: u16, max_scrollback: u32) usize {
    const state = allocator.create(State) catch return 0;
    state.terminal = vt.Terminal.init(allocator, .{
        .cols = cols,
        .rows = rows,
        .max_scrollback = max_scrollback,
        .colors = .{
            .foreground = .init(rgb(0xee, 0xee, 0xee)),
            .background = .init(rgb(0x0d, 0x0d, 0x0d)),
            .cursor = .unset,
            .palette = .default,
        },
    }) catch {
        allocator.destroy(state);
        return 0;
    };
    state.stream = state.terminal.vtStream();
    state.render = .empty;
    return @intFromPtr(state);
}

export fn deinit(ptr: usize) void {
    const state = stateFromPtr(ptr);
    state.render.deinit(allocator);
    state.stream.deinit();
    state.terminal.deinit(allocator);
    allocator.destroy(state);
}

export fn alloc_buffer(len: u32) usize {
    const buffer = allocator.alloc(u8, len) catch return 0;
    return @intFromPtr(buffer.ptr);
}

export fn free_buffer(ptr: usize, len: u32) void {
    const buffer: [*]u8 = @ptrFromInt(ptr);
    allocator.free(buffer[0..len]);
}

export fn write(ptr: usize, data_ptr: [*]const u8, data_len: u32) void {
    const state = stateFromPtr(ptr);
    state.stream.nextSlice(data_ptr[0..data_len]) catch {};
}

export fn resize(ptr: usize, cols: u16, rows: u16) void {
    const state = stateFromPtr(ptr);
    state.terminal.resize(allocator, cols, rows) catch {};
}

export fn update(ptr: usize) void {
    const state = stateFromPtr(ptr);
    state.render.update(allocator, &state.terminal) catch {};
}

fn writeColor(buffer: [*]u8, offset: usize, value: vt.Style.Color) void {
    switch (value) {
        .none => {
            buffer[offset] = 0;
            buffer[offset + 1] = 0;
            buffer[offset + 2] = 0;
            buffer[offset + 3] = 0;
        },
        .palette => |index| {
            buffer[offset] = 1;
            buffer[offset + 1] = index;
            buffer[offset + 2] = 0;
            buffer[offset + 3] = 0;
        },
        .rgb => |value_rgb| {
            buffer[offset] = 2;
            buffer[offset + 1] = value_rgb.r;
            buffer[offset + 2] = value_rgb.g;
            buffer[offset + 3] = value_rgb.b;
        },
    }
}

fn flags(style: vt.Style) u16 {
    var result: u16 = 0;
    if (style.flags.bold) result |= 1 << 0;
    if (style.flags.faint) result |= 1 << 1;
    if (style.flags.italic) result |= 1 << 2;
    if (style.flags.blink) result |= 1 << 3;
    if (style.flags.inverse) result |= 1 << 4;
    if (style.flags.invisible) result |= 1 << 5;
    if (style.flags.strikethrough) result |= 1 << 6;
    if (style.flags.overline) result |= 1 << 7;
    result |= switch (style.flags.underline) {
        .none => 0,
        .single => 1 << 8,
        .double => 2 << 8,
        .curly => 3 << 8,
        .dotted => 4 << 8,
        .dashed => 5 << 8,
    };
    return result;
}

fn width(cell: vt.Cell) u8 {
    return switch (cell.wide) {
        .narrow => 1,
        .wide => 2,
        .spacer_tail, .spacer_head => 0,
    };
}

export fn get_viewport(ptr: usize, buffer: [*]u8) u32 {
    const state = stateFromPtr(ptr);
    const rows = state.render.row_data.items(.cells);
    var offset: usize = 0;
    for (0..state.render.rows) |y| {
        const cells = rows[y].items(.raw);
        const styles = rows[y].items(.style);
        for (0..state.render.cols) |x| {
            const cell = cells[x];
            const style: vt.Style = if (cell.style_id > 0 or
                cell.content_tag == .bg_color_palette or
                cell.content_tag == .bg_color_rgb)
                styles[x]
            else
                .{};
            const codepoint: u32 = switch (cell.content_tag) {
                .codepoint, .codepoint_grapheme => cell.content.codepoint,
                else => 0,
            };
            std.mem.writeInt(u32, buffer[offset..][0..4], codepoint, .little);
            writeColor(buffer, offset + 4, style.fg_color);
            writeColor(buffer, offset + 8, style.bg_color);
            writeColor(buffer, offset + 12, style.underline_color);
            std.mem.writeInt(u16, buffer[offset..][16..18], flags(style), .little);
            buffer[offset + 18] = width(cell);
            buffer[offset + 19] = @intFromEnum(cell.content_tag);
            buffer[offset + 20] = switch (cell.content_tag) {
                .bg_color_palette => cell.content.color_palette,
                .bg_color_rgb => cell.content.color_rgb.r,
                else => 0,
            };
            buffer[offset + 21] = if (cell.content_tag == .bg_color_rgb) cell.content.color_rgb.g else 0;
            buffer[offset + 22] = if (cell.content_tag == .bg_color_rgb) cell.content.color_rgb.b else 0;
            buffer[offset + 23] = 0;
            offset += CellBytes;
        }
    }
    return @as(u32, state.render.rows) * @as(u32, state.render.cols);
}

export fn get_cell_text(ptr: usize, row: u16, col: u16, buffer: [*]u8, capacity: u32) u32 {
    const state = stateFromPtr(ptr);
    if (row >= state.render.rows or col >= state.render.cols) return 0;
    const cells = state.render.row_data.items(.cells)[row];
    const raw = cells.items(.raw)[col];
    if (raw.content_tag != .codepoint and raw.content_tag != .codepoint_grapheme) return 0;
    if (raw.content.codepoint == 0) return 0;

    var output: usize = 0;
    var encoded: [4]u8 = undefined;
    const first_len = std.unicode.utf8Encode(raw.content.codepoint, &encoded) catch return 0;
    if (output + first_len <= capacity) @memcpy(buffer[output .. output + first_len], encoded[0..first_len]);
    output += first_len;

    if (raw.content_tag == .codepoint_grapheme) {
        for (cells.items(.grapheme)[col]) |codepoint| {
            const len = std.unicode.utf8Encode(codepoint, &encoded) catch continue;
            if (output + len <= capacity) @memcpy(buffer[output .. output + len], encoded[0..len]);
            output += len;
        }
    }
    return @intCast(output);
}

export fn get_row_wrapped(ptr: usize, row: u16) u32 {
    const state = stateFromPtr(ptr);
    if (row >= state.render.rows) return 0;
    return if (state.render.row_data.items(.raw)[row].wrap) 1 else 0;
}

export fn get_cols(ptr: usize) u32 {
    return stateFromPtr(ptr).render.cols;
}

export fn get_rows(ptr: usize) u32 {
    return stateFromPtr(ptr).render.rows;
}

export fn get_scroll_total(ptr: usize) u32 {
    return @intCast(stateFromPtr(ptr).terminal.screens.active.pages.scrollbar().total);
}

export fn get_scroll_offset(ptr: usize) u32 {
    return @intCast(stateFromPtr(ptr).terminal.screens.active.pages.scrollbar().offset);
}

export fn get_scroll_visible(ptr: usize) u32 {
    return @intCast(stateFromPtr(ptr).terminal.screens.active.pages.scrollbar().len);
}

export fn scroll_top(ptr: usize) void {
    stateFromPtr(ptr).terminal.scrollViewport(.top);
}

export fn scroll_bottom(ptr: usize) void {
    stateFromPtr(ptr).terminal.scrollViewport(.bottom);
}

export fn scroll_by(ptr: usize, delta: i32) void {
    stateFromPtr(ptr).terminal.scrollViewport(.{ .delta = delta });
}

export fn scroll_to(ptr: usize, row: u32) void {
    const terminal = &stateFromPtr(ptr).terminal;
    terminal.scrollViewport(.top);
    terminal.scrollViewport(.{ .delta = @intCast(row) });
}

export fn get_cursor_x(ptr: usize) u32 {
    const cursor = stateFromPtr(ptr).render.cursor.viewport orelse return 0;
    return cursor.x;
}

export fn get_cursor_y(ptr: usize) u32 {
    const cursor = stateFromPtr(ptr).render.cursor.viewport orelse return 0;
    return cursor.y;
}

export fn get_cursor_in_viewport(ptr: usize) u32 {
    return if (stateFromPtr(ptr).render.cursor.viewport != null) 1 else 0;
}

export fn get_cursor_visible(ptr: usize) u32 {
    return if (stateFromPtr(ptr).render.cursor.visible) 1 else 0;
}

export fn get_cursor_blinking(ptr: usize) u32 {
    return if (stateFromPtr(ptr).render.cursor.blinking) 1 else 0;
}

export fn get_cursor_shape(ptr: usize) u32 {
    return switch (stateFromPtr(ptr).render.cursor.visual_style) {
        .bar => 0,
        .block => 1,
        .block_hollow => 2,
        .underline => 3,
    };
}

fn packRgb(value: vt.color.RGB) u32 {
    return (@as(u32, value.r) << 16) | (@as(u32, value.g) << 8) | value.b;
}

export fn get_default_foreground(ptr: usize) u32 {
    return packRgb(stateFromPtr(ptr).render.colors.foreground);
}

export fn get_default_background(ptr: usize) u32 {
    return packRgb(stateFromPtr(ptr).render.colors.background);
}

export fn get_cursor_color(ptr: usize) i32 {
    const value = stateFromPtr(ptr).render.colors.cursor orelse return -1;
    return @bitCast(packRgb(value));
}

export fn get_palette_color(ptr: usize, index: u8) u32 {
    return packRgb(stateFromPtr(ptr).render.colors.palette[index]);
}

fn unpackRgb(value: u32) vt.color.RGB {
    return .{
        .r = @truncate(value >> 16),
        .g = @truncate(value >> 8),
        .b = @truncate(value),
    };
}

export fn set_default_colors(ptr: usize, foreground: u32, background: u32) void {
    const terminal = &stateFromPtr(ptr).terminal;
    terminal.colors.foreground.default = unpackRgb(foreground);
    terminal.colors.background.default = unpackRgb(background);
    terminal.flags.dirty.palette = true;
}

export fn get_synchronized_output(ptr: usize) u32 {
    return if (stateFromPtr(ptr).terminal.modes.get(.synchronized_output)) 1 else 0;
}

export fn get_report_color_scheme(ptr: usize) u32 {
    return if (stateFromPtr(ptr).terminal.modes.get(.report_color_scheme)) 1 else 0;
}

export fn cell_bytes() u32 {
    return CellBytes;
}
