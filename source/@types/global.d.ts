declare const Editor: any;
declare const __dirname: string;
declare const process: any;

declare module 'fs' {
    export function existsSync(path: string): boolean;
    export function readFileSync(path: string, encoding: string): string;
    export function writeFileSync(path: string, data: string, encoding: string): void;
    export namespace promises {
        export function readFile(path: string, encoding: string): Promise<string>;
        export function writeFile(path: string, data: string, encoding: string): Promise<void>;
        export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any[]>;
    }
}

declare module 'path' {
    export function join(...paths: string[]): string;
    export function resolve(...paths: string[]): string;
    export function relative(from: string, to: string): string;
    export function dirname(p: string): string;
    export function basename(p: string, ext?: string): string;
    export function extname(p: string): string;
}

declare module 'child_process' {
    export function spawnSync(command: string, args?: string[], options?: any): any;
}

