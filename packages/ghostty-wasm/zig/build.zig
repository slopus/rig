const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });
    const module = b.createModule(.{
        .root_source_file = b.path("sources/main.zig"),
        .target = wasm_target,
        .optimize = optimize,
    });

    if (b.lazyDependency("ghostty", .{ .target = wasm_target, .simd = false })) |ghostty| {
        module.addImport("ghostty-vt", ghostty.module("ghostty-vt"));
    }

    const wasm = b.addExecutable(.{ .name = "ghostty-vt", .root_module = module });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    b.installArtifact(wasm);
}
