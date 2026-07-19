import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function killDockerGymProcesses(
    containerName: string,
    fixtureRoot: string,
): Promise<void> {
    const fixtureId = fixtureRoot.slice(fixtureRoot.lastIndexOf("/") + 1);
    await execFileAsync("docker", [
        "exec",
        containerName,
        "sh",
        "-c",
        'targets=""; for process in /proc/[0-9]*; do if grep -F -q -- "$1" "$process/mountinfo" 2>/dev/null; then targets="$targets ${process##*/}"; fi; done; for pid in $(printf "%s\n" $targets | sort -rn); do if grep -F -q -- "$1" "/proc/$pid/mountinfo" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi; done',
        "kill-gym-processes",
        `/${fixtureId}/workspace`,
    ]).catch(() => {});
}
