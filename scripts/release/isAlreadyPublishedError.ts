export function isAlreadyPublishedError(stderr: string): boolean {
    return /cannot publish over|previously published|EPUBLISHCONFLICT/iu.test(stderr);
}
