import { randomBytes } from "node:crypto";
import { rename, writeFile, chmod } from "node:fs/promises";

export async function writeLocalServerToken(tokenPath: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const temporaryPath = `${tokenPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${token}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, tokenPath);
    await chmod(tokenPath, 0o600);
    return token;
}
