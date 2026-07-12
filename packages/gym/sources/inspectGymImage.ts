import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function inspectGymImage(image: string, repositoryRoot: string): Promise<string> {
    const { stdout } = await execFileAsync(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", image],
        { cwd: repositoryRoot },
    );
    return stdout.trim();
}
