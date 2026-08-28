import * as path from 'path';
import * as fs from 'fs';
import { CocosUuidUtils } from './CocosUuidUtils';

export interface ClassPropertyMeta {
    name: string;
    rawType: string;
    targetType?: string;
    isEventFlexer?: boolean;
    isIdSelector?: boolean;
    isJsonAsset?: boolean;
}

export interface RawClassMeta {
    file: string;
    className: string;
    ccclass?: string;
    superClass?: string;
    listeners: Array<{ property: string; callback: string }>;
    emitters: Array<{ property: string; argsPassed?: string }>;
    params: Array<{ property: string }>;
    properties: Record<string, ClassPropertyMeta>;
    methods: Record<string, string>;
}

export interface ResolvedClassMeta {
    file: string;
    className: string;
    ccclass?: string;
    superClasses: string[];
    listeners: Record<string, string>; // property -> callback name
    emitters: Record<string, string>;  // property -> args
    params: Record<string, boolean>;   // property -> true
    properties: Record<string, ClassPropertyMeta>;
    methods: Record<string, string>;
}

export class TypeRegistry {
    private static rawRegistry = new Map<string, RawClassMeta>();
    private static resolvedRegistry = new Map<string, ResolvedClassMeta>();
    private static uuidToClass = new Map<string, string>();
    private static isInitialized = false;

    public static get isLoaded(): boolean {
        return this.isInitialized;
    }

    public static async build(projectPath: string, force = false): Promise<void> {
        if (this.isInitialized && !force) return;

        const startTime = Date.now();
        this.rawRegistry.clear();
        this.resolvedRegistry.clear();
        this.uuidToClass.clear();

        const searchDirs = [
            path.join(projectPath, 'assets'),
            path.join(projectPath, 'extensions')
        ];

        const skipDirs = new Set(['node_modules', 'dist', '.git', 'library', 'temp', 'local', 'profiles', 'build']);

        // 1. Index Meta UUIDs for TS files
        const pathToUuid = new Map<string, string>();
        const walkMetas = async (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirs.has(entry.name)) await walkMetas(full);
                } else if (entry.isFile() && entry.name.endsWith('.ts.meta')) {
                    try {
                        const raw = await fs.promises.readFile(full, 'utf8');
                        const data = JSON.parse(raw);
                        if (data && data.uuid) {
                            const tsPath = full.slice(0, -5);
                            const rel = path.relative(projectPath, tsPath).replace(/\\/g, '/');
                            pathToUuid.set(rel, data.uuid);
                        }
                    } catch {}
                }
            }
        };

        // 2. Scan all TypeScript source files
        const walkTs = async (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirs.has(entry.name)) await walkTs(full);
                } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                    try {
                        const content = await fs.promises.readFile(full, 'utf8');
                        const rel = path.relative(projectPath, full).replace(/\\/g, '/');
                        this.parseSource(content, rel, pathToUuid.get(rel));
                    } catch {}
                }
            }
        };

        for (const d of searchDirs) {
            await walkMetas(d);
            await walkTs(d);
        }

        // 3. Resolve Full Inheritance and Composition
        for (const [cname] of this.rawRegistry) {
            this.resolveClass(cname);
        }

        this.isInitialized = true;
        const elapsed = Date.now() - startTime;
        console.log(`[pts-nexus] 🧠 TypeRegistry built in ${elapsed}ms. Indexed ${this.resolvedRegistry.size} classes.`);
    }

    private static parseSource(content: string, relPath: string, uuid?: string): void {
        const ccclassRegex = /@ccclass\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        const defaultCcclass = ccclassRegex.exec(content);
        const defaultCcclassName = defaultCcclass ? defaultCcclass[1] : undefined;

        const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)(?:\s+extends\s+([A-Za-z0-9_\.<>]+))?/g;
        let cm: RegExpExecArray | null;

        while ((cm = classRegex.exec(content)) !== null) {
            const className = cm[1];
            const rawSuper = cm[2] || undefined;
            let superClass: string | undefined = undefined;
            if (rawSuper) {
                const cleaned = rawSuper.split('<')[0].trim();
                superClass = cleaned.split('.').pop();
            }

            // Find all methods
            const methods: Record<string, string> = {};
            const methodRegex = /(?:public|protected|private|async|\s)+\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g;
            let mm: RegExpExecArray | null;
            while ((mm = methodRegex.exec(content)) !== null) {
                const mName = mm[1];
                if (!['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(mName)) {
                    methods[mName] = mm[2].trim();
                }
            }

            // Find ground truth event.add: pEngine.Json.event.add(this.property, { func: this.funcName })
            const listeners: Array<{ property: string; callback: string }> = [];
            const addRegex = /pEngine\.Json\.event\.add\s*\(\s*this\.([A-Za-z0-9_]+)\s*,\s*\{\s*func:\s*this\.([A-Za-z0-9_]+)/g;
            let am: RegExpExecArray | null;
            while ((am = addRegex.exec(content)) !== null) {
                listeners.push({ property: am[1], callback: am[2] });
            }

            // Find ground truth event.invoke: pEngine.Json.event.invoke(this.property, ...)
            const emitters: Array<{ property: string; argsPassed?: string }> = [];
            const invokeRegex = /pEngine\.Json\.event\.invoke\s*\(\s*this\.([A-Za-z0-9_]+)(?:,\s*([^)]+))?\)/g;
            let im: RegExpExecArray | null;
            while ((im = invokeRegex.exec(content)) !== null) {
                emitters.push({ property: im[1], argsPassed: im[2] ? im[2].trim() : undefined });
            }

            // Find ground truth param calls: pEngine.Json.param.get/set/wait(this.property)
            const params: Array<{ property: string }> = [];
            const paramRegex = /pEngine\.Json\.param\.(?:get|set|wait)\s*(?:<[^>]+>)?\s*\(\s*this\.([A-Za-z0-9_]+)/g;
            let pm: RegExpExecArray | null;
            while ((pm = paramRegex.exec(content)) !== null) {
                params.push({ property: pm[1] });
            }

            // Find all @property decorated fields
            const properties: Record<string, ClassPropertyMeta> = {};
            const propRegex = /@property\s*\(\s*([^)]*)\s*\)\s*(?:get\s+)?([A-Za-z0-9_]+)(?:\s*:\s*([^;=\r\n]+))?/g;
            let prm: RegExpExecArray | null;
            while ((prm = propRegex.exec(content)) !== null) {
                const rawArgs = prm[1].trim();
                const pName = prm[2];
                const typeAnnotation = prm[3] ? prm[3].trim() : '';

                const combinedType = `${rawArgs} ${typeAnnotation}`;
                const isEventFlexer = combinedType.includes('Event_Flexer');
                const isIdSelector = combinedType.includes('Helper_IdSelector') || combinedType.includes('IdSelector');
                const isJsonAsset = combinedType.includes('JsonAsset');

                properties[pName] = {
                    name: pName,
                    rawType: combinedType,
                    isEventFlexer,
                    isIdSelector,
                    isJsonAsset
                };
            }

            const rawMeta: RawClassMeta = {
                file: relPath,
                className,
                ccclass: defaultCcclassName || className,
                superClass,
                listeners,
                emitters,
                params,
                properties,
                methods
            };

            this.rawRegistry.set(className, rawMeta);
            if (defaultCcclassName) {
                this.rawRegistry.set(defaultCcclassName, rawMeta);
            }
            if (uuid) {
                this.uuidToClass.set(uuid, className);
                const decomp = CocosUuidUtils.decompressUuid(uuid);
                this.uuidToClass.set(decomp, className);
            }
        }
    }

    public static resolveClass(classNameOrType: string): ResolvedClassMeta | null {
        if (!classNameOrType) return null;
        if (this.resolvedRegistry.has(classNameOrType)) {
            return this.resolvedRegistry.get(classNameOrType)!;
        }

        // Try direct lookup or decompressed UUID lookup
        let raw = this.rawRegistry.get(classNameOrType);
        if (!raw && this.uuidToClass.has(classNameOrType)) {
            raw = this.rawRegistry.get(this.uuidToClass.get(classNameOrType)!);
        }
        if (!raw) {
            const decomp = CocosUuidUtils.decompressUuid(classNameOrType);
            if (this.uuidToClass.has(decomp)) {
                raw = this.rawRegistry.get(this.uuidToClass.get(decomp)!);
            }
        }
        if (!raw) return null;

        const superClasses: string[] = [];
        const listeners: Record<string, string> = {};
        const emitters: Record<string, string> = {};
        const params: Record<string, boolean> = {};
        const properties: Record<string, ClassPropertyMeta> = {};
        const methods: Record<string, string> = { ...raw.methods };

        // 1. Inherit from base classes recursively
        let currSuper = raw.superClass;
        const visited = new Set<string>([raw.className]);

        while (currSuper && !visited.has(currSuper)) {
            visited.add(currSuper);
            superClasses.push(currSuper);
            const superResolved = this.resolveClass(currSuper);
            if (superResolved) {
                Object.assign(listeners, superResolved.listeners);
                Object.assign(emitters, superResolved.emitters);
                Object.assign(params, superResolved.params);
                Object.assign(properties, superResolved.properties);
                Object.assign(methods, superResolved.methods);
            }
            const superRaw = this.rawRegistry.get(currSuper);
            currSuper = superRaw ? superRaw.superClass : undefined;
        }

        // 2. Apply own definitions (overrides base)
        for (const l of raw.listeners) {
            listeners[l.property] = l.callback;
        }
        for (const e of raw.emitters) {
            emitters[e.property] = e.argsPassed || '';
        }
        for (const p of raw.params) {
            params[p.property] = true;
        }
        for (const [pk, pv] of Object.entries(raw.properties)) {
            properties[pk] = pv;
        }

        const resolved: ResolvedClassMeta = {
            file: raw.file,
            className: raw.className,
            ccclass: raw.ccclass,
            superClasses,
            listeners,
            emitters,
            params,
            properties,
            methods
        };

        this.resolvedRegistry.set(raw.className, resolved);
        if (raw.ccclass) {
            this.resolvedRegistry.set(raw.ccclass, resolved);
        }

        return resolved;
    }
}
