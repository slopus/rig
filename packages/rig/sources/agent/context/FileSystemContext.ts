export interface FileSystemStat {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode?: number;
    size: number;
    mtimeMs: number;
}

export interface FileSystemContext {
    cwd: string;
    home?: string;
    chmod(path: string, mode: number): Promise<void>;
    exists(path: string): Promise<boolean>;
    lstat(path: string): Promise<FileSystemStat>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    move(source: string, destination: string): Promise<void>;
    readFile(path: string): Promise<string>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    readdir(path: string): Promise<readonly string[]>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    setModificationTime(path: string, mtimeMs: number): Promise<void>;
    stat(path: string): Promise<FileSystemStat>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
}
