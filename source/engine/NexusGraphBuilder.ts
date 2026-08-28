import * as path from 'path';
import * as fs from 'fs';
import { CocosUuidUtils } from './CocosUuidUtils';
import { TypeRegistry } from './TypeRegistry';

export interface GraphEmitter {
    file: string;
    node: string;
    compId?: number;
    className: string;
    scriptFile: string;
    bounceScript?: string;
    bounces?: string;
    functionName: string;
    trigger: string;
    paramsPassed?: string;
    property: string;
}

export interface GraphListener {
    file: string;
    node: string;
    compId?: number;
    className: string;
    scriptFile: string;
    bounceScript?: string;
    bounces?: string;
    functionName: string;
    property: string;
    boundMethod?: string;
    methodSignature?: string;
}

export interface GraphParam {
    file: string;
    node: string;
    compId?: number;
    className: string;
    scriptFile: string;
    bounceScript?: string;
    bounces?: string;
    functionName?: string;
    property: string;
}

export interface EventNetworkCatalogItem {
    uuid: string;
    path: string;
    name: string;
    domain: string;
    domainIcon: string;
    emitters: GraphEmitter[];
    listeners: GraphListener[];
    params: GraphParam[];
}

export interface EventNetworkGraph {
    catalog: Record<string, EventNetworkCatalogItem>;
}

export class NexusGraphBuilder {
    public static async build(projectPath: string): Promise<EventNetworkGraph> {
        // 1. Build TypeRegistry in RAM (Indexed ground-truth pEngine.Json calls & inheritance)
        await TypeRegistry.build(projectPath);

        const searchDirs = [
            path.join(projectPath, 'assets'),
            path.join(projectPath, 'extensions')
        ];

        const skipDirs = new Set(['node_modules', 'dist', '.git', 'library', 'temp', 'local', 'profiles', 'build']);

        // 2. Build UUID -> File path map from .meta files
        const uuidToPath: Record<string, string> = {};
        const pathToUuid: Record<string, string> = {};

        const walkFiles = async (dir: string, ext: string, callback: (filePath: string) => Promise<void>) => {
            if (!fs.existsSync(dir)) return;
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirs.has(entry.name)) {
                        await walkFiles(fullPath, ext, callback);
                    }
                } else if (entry.isFile() && entry.name.endsWith(ext)) {
                    await callback(fullPath);
                }
            }
        };

        for (const dir of searchDirs) {
            await walkFiles(dir, '.meta', async (metaPath) => {
                try {
                    const raw = await fs.promises.readFile(metaPath, 'utf8');
                    const data = JSON.parse(raw);
                    if (data && data.uuid) {
                        const assetPath = metaPath.slice(0, -5);
                        const relPath = path.relative(projectPath, assetPath).replace(/\\/g, '/');
                        uuidToPath[data.uuid] = relPath;
                        pathToUuid[relPath] = data.uuid;
                    }
                } catch {}
            });
        }

        // 3. Register all JsonAssets into catalog
        const catalog: Record<string, EventNetworkCatalogItem> = {};

        const getDomainMeta = (relPath: string) => {
            const lower = relPath.toLowerCase();
            if (lower.includes('gameplay') || lower.includes('match') || lower.includes('level')) {
                return { domain: 'Match-3 Gameplay', icon: '🎮' };
            } else if (lower.includes('ui') || lower.includes('screen') || lower.includes('popup') || lower.includes('dialog') || lower.includes('menu')) {
                return { domain: 'UI Navigation', icon: '🖥️' };
            } else if (lower.includes('data') || lower.includes('config') || lower.includes('storage') || lower.includes('param') || lower.includes('coin') || lower.includes('shop')) {
                return { domain: 'Economy & Data', icon: '🪙' };
            } else if (lower.includes('firebase') || lower.includes('auth') || lower.includes('network') || lower.includes('account')) {
                return { domain: 'Firebase & Auth', icon: '🔥' };
            } else if (lower.includes('ad') || lower.includes('reward') || lower.includes('banner') || lower.includes('interstitial')) {
                return { domain: 'Ads System', icon: '📺' };
            } else if (lower.includes('builder') || lower.includes('home') || lower.includes('decorate')) {
                return { domain: 'Home Builder', icon: '🏗️' };
            } else if (lower.includes('audio') || lower.includes('sound') || lower.includes('music')) {
                return { domain: 'Audio & SFX', icon: '🎵' };
            }

            const parts = relPath.split('/');
            if (parts.length > 2) {
                const folder = parts[parts.length - 2];
                const cleanFolder = folder.replace(/^[$_]+/, '').replace(/[-_]/g, ' ');
                const capFolder = cleanFolder.charAt(0).toUpperCase() + cleanFolder.slice(1);
                return { domain: capFolder, icon: '📁' };
            }

            return { domain: 'General Events', icon: '⚡' };
        };

        for (const [uuid, p] of Object.entries(uuidToPath)) {
            if (p.endsWith('.json') && !p.includes('package.json') && !p.includes('tsconfig')) {
                const name = path.basename(p);
                const { domain, icon: domainIcon } = getDomainMeta(p);

                catalog[uuid] = {
                    uuid,
                    path: p,
                    name,
                    domain,
                    domainIcon,
                    emitters: [],
                    listeners: [],
                    params: []
                };
            }
        }

        // 4. Scan scenes and prefabs - Scan strictly node-attached components with TypeRegistry ground truth
        const sceneAndPrefabExts = ['.scene', '.prefab'];
        for (const dir of searchDirs) {
            for (const ext of sceneAndPrefabExts) {
                await walkFiles(dir, ext, async (filePath) => {
                    const relPath = path.relative(projectPath, filePath).replace(/\\/g, '/');
                    const fileBase = path.basename(filePath, ext);
                    try {
                        const raw = await fs.promises.readFile(filePath, 'utf8');
                        const data = JSON.parse(raw);
                        if (!Array.isArray(data)) return;

                        // Index nodes and find node-attached component IDs
                        const nodes: Record<number, any> = {};
                        const nodeAttachedCompIds: Array<{ compId: number; nodeIdx: number }> = [];

                        for (let i = 0; i < data.length; i++) {
                            const item = data[i];
                            if (item && item.__type__ === 'cc.Node') {
                                nodes[i] = item;
                                if (Array.isArray(item._components)) {
                                    for (const compRef of item._components) {
                                        if (compRef && typeof compRef.__id__ === 'number') {
                                            nodeAttachedCompIds.push({ compId: compRef.__id__, nodeIdx: i });
                                        }
                                    }
                                }
                            }
                        }

                        const getNodePath = (nIdx: number): string => {
                            const pNodes: string[] = [];
                            let curr: number | null = nIdx;
                            while (curr !== null && nodes[curr]) {
                                const nName = nodes[curr]._name || 'Node';
                                pNodes.unshift(nName);
                                const parent = nodes[curr]._parent;
                                if (parent && typeof parent.__id__ === 'number') {
                                    curr = parent.__id__;
                                } else {
                                    break;
                                }
                            }
                            return pNodes.join('/');
                        };

                        const nodeAttachedCompSet = new Set<number>(nodeAttachedCompIds.map(c => c.compId));

                        // Recursive Isolated Component Reference Tracer
                        interface TraceStep {
                            key: string;
                            type?: string;
                            obj: any;
                        }

                        interface TraceRefResult {
                            uuid: string;
                            chain: TraceStep[];
                        }

                        const traceComponentRefs = (obj: any, currentCompId: number, parentKey = '', chain: TraceStep[] = [], visited = new Set<number>()): TraceRefResult[] => {
                            if (!obj || typeof obj !== 'object') return [];

                            if (typeof obj.__id__ === 'number') {
                                const objId = obj.__id__;
                                if (visited.has(objId) || objId >= data.length) return [];
                                visited.add(objId);
                                const target = data[objId];
                                if (!target || typeof target !== 'object') return [];

                                // STRICT COMPONENT ISOLATION: Stop traversal if crossing into another attached Component
                                if (objId !== currentCompId && nodeAttachedCompSet.has(objId)) {
                                    return [];
                                }

                                const t = target.__type__ || '';
                                // Stop traversal if crossing into other nodes, scenes, prefab info, or components
                                if (t === 'cc.Node' || t.startsWith('cc.Scene') || t.startsWith('cc.PrefabInfo') || t.startsWith('cc.CompPrefabInfo') || (target.node && typeof target.node.__id__ === 'number' && objId !== currentCompId)) {
                                    return [];
                                }
                                return traceComponentRefs(target, currentCompId, parentKey, chain, new Set(visited));
                            }

                            const results: TraceRefResult[] = [];
                            if (obj.__uuid__) {
                                results.push({
                                    uuid: obj.__uuid__,
                                    chain: [...chain, { key: parentKey, obj }]
                                });
                                return results;
                            }

                            const t = obj.__type__;

                            if (Array.isArray(obj)) {
                                for (let idx = 0; idx < obj.length; idx++) {
                                    const k = `${parentKey}[${idx}]`;
                                    results.push(...traceComponentRefs(obj[idx], currentCompId, k, [...chain, { key: k, type: t, obj }], new Set(visited)));
                                }
                            } else {
                                for (const k of Object.keys(obj)) {
                                    if (['_objFlags', '__editorExtras__', '_zid', '_prefab', 'node'].includes(k)) continue;
                                    results.push(...traceComponentRefs(obj[k], currentCompId, k, [...chain, { key: k, type: t, obj }], new Set(visited)));
                                }
                            }

                            return results;
                        };

                        // Scan ONLY components attached to actual nodes
                        for (const { compId, nodeIdx } of nodeAttachedCompIds) {
                            const entry = data[compId];
                            if (!entry || typeof entry !== 'object') continue;
                            const t = entry.__type__;
                            if (!t || t.startsWith('cc.Scene') || t.startsWith('cc.PrefabInfo') || t.startsWith('cc.CompPrefabInfo') || t === 'cc.Node') {
                                continue;
                            }

                            const rawPath = getNodePath(nodeIdx);
                            let nodePath = rawPath;
                            if (nodePath === 'Root' || !nodePath) {
                                nodePath = fileBase;
                            } else if (nodePath.startsWith('Root/')) {
                                nodePath = fileBase + nodePath.substring(4);
                            }

                            const resolvedClass = TypeRegistry.resolveClass(t);
                            const className = resolvedClass ? resolvedClass.className : t;
                            const scriptFile = resolvedClass ? resolvedClass.file : 'Unknown';

                            // Deep trace all JsonAsset references attached to this component
                            const refResults = traceComponentRefs(entry, compId, 'root');

                            for (const ref of refResults) {
                                const juuid = ref.uuid;
                                if (!catalog[juuid]) continue;

                                const chainSteps = ref.chain;
                                const rawRootProp = chainSteps.length > 0 ? chainSteps[0].key : 'property';
                                const rootProp = rawRootProp.replace(/\[\d+\]/g, ''); // strip array index

                                // Find custom inner types
                                const customTypes = chainSteps.filter(c => c.type && !c.type.startsWith('cc.') && c.type !== t);
                                let bounceScript = '';
                                if (customTypes.length > 0) {
                                    bounceScript = customTypes[customTypes.length - 1].type || '';
                                }

                                // Build clean Bounces representation string
                                let bounces = '';
                                if (chainSteps.length > 1) {
                                    const segments: string[] = [];
                                    for (const step of chainSteps) {
                                        if (step.key === 'root' || step.key.startsWith('json')) continue;
                                        if (step.type && !step.type.startsWith('cc.')) {
                                            segments.push(`${step.key}[${step.type}]`);
                                        } else {
                                            segments.push(step.key);
                                        }
                                    }
                                    if (segments.length > 0) {
                                        bounces = segments.join('.');
                                    }
                                }

                                // Classify Emitter vs Listener vs Param via Ground Truth TypeRegistry
                                let isListener = false;
                                let isEmitter = false;
                                let isParam = false;
                                let boundMethod: string | undefined;
                                let methodSignature = '';
                                let functionName = '';
                                let trigger = '';
                                let paramsPassed = '';

                                // 1. Check if the root property is an Event_Flexer or Event_Driver Helper (Pure Emitters)
                                const propMeta = resolvedClass?.properties[rootProp];
                                const isFlexerProp = propMeta?.isEventFlexer || chainSteps.some(c => c.type === 'Event_Flexer');
                                const isIdSelectorProp = propMeta?.isIdSelector || chainSteps.some(c => c.type?.includes('IdSelector'));

                                const helperStep = chainSteps.find(c => c.obj && (c.obj.key || c.obj.id || (c.type && (c.type.includes('Helper') || c.type.includes('Flexer')))));
                                const helperObj = helperStep?.obj;

                                if (isFlexerProp || rootProp === 'onClicks' || className === 'Smart_Button') {
                                    isEmitter = true;
                                    functionName = rootProp === 'onClicks' ? 'onClick' : `${rootProp}()`;
                                    trigger = `${className}.${rootProp}`;
                                    bounceScript = bounceScript || 'Event_Flexer';
                                    bounces = bounces || `${rootProp}[Event_Flexer].json`;
                                } else if (helperObj && (helperObj.key || helperObj.id || rootProp.startsWith('_helpers') || rootProp.startsWith('helpers'))) {
                                    isEmitter = true;
                                    const hKey = helperObj.key || '';
                                    const hId = helperObj.id || '';
                                    const callTarget = hId ? `'${hId}'` : (hKey ? `'${hKey}'` : '');
                                    
                                    if (hKey && hId) {
                                        functionName = `${hKey}('${hId}')`;
                                        trigger = `${className}.${hKey}('${hId}')`;
                                    } else if (hKey) {
                                        functionName = `${hKey}()`;
                                        trigger = `${className}.${hKey}()`;
                                    } else if (hId) {
                                        functionName = `emit('${hId}')`;
                                        trigger = `${className}.emit('${hId}')`;
                                    } else {
                                        functionName = 'emit()';
                                        trigger = `${className}.emit('event')`;
                                    }
                                    bounceScript = helperStep?.type || bounceScript || 'UI_Controller._Helper';
                                    bounces = bounces || `_helpers[${bounceScript}]{id: ${hId || hKey}, flex[Event_Flexer].json}`;
                                }

                                // 2. Check Ground Truth Registered Listeners in TypeRegistry
                                if (!isListener && !isEmitter && resolvedClass) {
                                    if (resolvedClass.listeners[rootProp]) {
                                        isListener = true;
                                        boundMethod = resolvedClass.listeners[rootProp];
                                        functionName = `${boundMethod}()`;
                                        methodSignature = resolvedClass.methods[boundMethod] || '';
                                    } else if (resolvedClass.emitters[rootProp] !== undefined) {
                                        isEmitter = true;
                                        functionName = `${rootProp}()`;
                                        trigger = `pEngine.Json.event.invoke(${rootProp})`;
                                        paramsPassed = resolvedClass.emitters[rootProp];
                                    } else if (resolvedClass.params[rootProp] || isIdSelectorProp) {
                                        isParam = true;
                                        functionName = rootProp;
                                    }
                                }

                                // 3. Framework specific composite hookers (e.g. Config_Global)
                                if (!isListener && !isEmitter && !isParam) {
                                    if (className.includes('Config_Global') || className.includes('GlobalTTF')) {
                                        const hasListeners = chainSteps.some(c => c.key.includes('listeners'));
                                        const hasParam = chainSteps.some(c => c.key.includes('param'));
                                        if (hasListeners) {
                                            isListener = true;
                                            boundMethod = 'init';
                                            functionName = 'init()';
                                            bounceScript = bounceScript || 'Config_Global_Hook';
                                            bounces = bounces || '_Config[Config_Global_Config]._hookers{_Hook[Config_Global_Hook].listeners}';
                                        } else if (hasParam) {
                                            isParam = true;
                                            functionName = 'param';
                                        }
                                    }
                                }

                                // 4. Fallback Semantic conventions
                                if (!isListener && !isEmitter && !isParam) {
                                    if (rootProp.startsWith('act') || rootProp.startsWith('on') || rootProp.startsWith('evt') || rootProp.startsWith('listen')) {
                                        isListener = true;
                                        boundMethod = rootProp;
                                        functionName = `${rootProp}()`;
                                    } else if (rootProp === 'param' || rootProp === 'pool' || rootProp === 'data' || rootProp === 'hid' || rootProp === 'id' || catalog[juuid].path.includes('params')) {
                                        isParam = true;
                                        functionName = rootProp;
                                    } else {
                                        isListener = true;
                                        boundMethod = rootProp;
                                        functionName = `${rootProp}()`;
                                    }
                                }

                                if (isParam) {
                                    const isAlreadyInCatalog = catalog[juuid].params.some(p => p.file === relPath && p.node === nodePath && p.compId === compId && p.className === className && p.property === rootProp);
                                    if (!isAlreadyInCatalog) {
                                        catalog[juuid].params.push({
                                            file: relPath,
                                            node: nodePath,
                                            compId,
                                            className,
                                            scriptFile,
                                            bounceScript: bounceScript || undefined,
                                            bounces: bounces || undefined,
                                            functionName,
                                            property: rootProp
                                        });
                                    }
                                    continue;
                                }

                                if (isEmitter) {
                                    const isAlreadyInCatalog = catalog[juuid].emitters.some(e => e.file === relPath && e.node === nodePath && e.compId === compId && e.className === className && e.trigger === trigger);
                                    if (!isAlreadyInCatalog) {
                                        catalog[juuid].emitters.push({
                                            file: relPath,
                                            node: nodePath,
                                            compId,
                                            className,
                                            scriptFile,
                                            bounceScript: bounceScript || undefined,
                                            bounces: bounces || undefined,
                                            functionName: functionName || 'emit()',
                                            trigger: trigger || `${className}.emit()`,
                                            paramsPassed: paramsPassed || undefined,
                                            property: rootProp
                                        });
                                    }
                                } else if (isListener) {
                                    const isAlreadyInCatalog = catalog[juuid].listeners.some(l => l.file === relPath && l.node === nodePath && l.compId === compId && l.className === className && (l.boundMethod === (boundMethod || functionName) || l.property === rootProp));
                                    if (!isAlreadyInCatalog) {
                                        catalog[juuid].listeners.push({
                                            file: relPath,
                                            node: nodePath,
                                            compId,
                                            className,
                                            scriptFile,
                                            bounceScript: bounceScript || undefined,
                                            bounces: bounces || undefined,
                                            functionName: functionName || 'handle()',
                                            property: rootProp,
                                            boundMethod: boundMethod || functionName,
                                            methodSignature: methodSignature || undefined
                                        });
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Error scanning ${filePath}:`, err);
                    }
                });
            }
        }

        return { catalog };
    }
}
