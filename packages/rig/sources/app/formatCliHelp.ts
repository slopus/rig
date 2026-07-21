export function formatCliHelp(): string {
    return [
        "Usage: rig [session options]",
        "       rig exec [options] [prompt]",
        "       rig resume [--last | --all | SESSION_ID]",
        "       rig fork [--last | --all | SESSION_ID]",
        "       rig daemon <start|stop|status|reload>",
        "       rig happy auth",
        "       rig monit",
        "",
        "Run Rig without a command to start an interactive session.",
        "Use 'rig happy auth' to connect the Happy mobile app.",
        "",
        "Options:",
        "  -h, --help       Show this help.",
        "  -v, --version    Show the installed Rig version.",
    ].join("\n");
}
