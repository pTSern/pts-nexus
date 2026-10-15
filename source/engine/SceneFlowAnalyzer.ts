import * as path from 'path';
import * as fs from 'fs';
import { CocosUuidUtils } from './CocosUuidUtils';
import { TypeRegistry } from './TypeRegistry';
import { FunctionWorkflowAnalyzer } from './FunctionWorkflowAnalyzer';

export interface SceneComponentWorkflow {
    kind: 'emit' | 'listen' | 'param' | 'lifecycle' | 'call';
    title: string;
    detail?: string;
    targetAsset?: string;
}

export interface SceneComponentFlow {
    compId: number;
    compUuid?: string;
    rawType: string;
    className: string;
    scriptFile?: string;
    isCustomScript: boolean;
    workflows: SceneComponentWorkflow[];
}

export interface SceneNodeFlow {
    id: string;
    uuid?: string;
    nodeIdx: number;
    name: string;
    path: string;
    active: boolean;
    parentId?: string;
    childrenIds: string[];
    components: SceneComponentFlow[];
}

export interface SceneFlowTree {
    scenePath: string;
    sceneName: string;
    isPrefab: boolean;
    rootNodeIds: string[];
    nodes: Record<string, SceneNodeFlow>;
    summary: {
        totalNodes: number;
        totalComponents: number;
        totalCustomScripts: number;
        totalWorkflows: number;
    };
}

export class SceneFlowAnalyzer {
    public static async buildSceneFlows(
        projectPath: string,
        catalog: Record<string, any>
    ): Promise<Record<string, SceneFlowTree>> {
        const sceneFlows: Record<string, SceneFlowTree> = {};

        const searchDirs = [
            path.join(projectPath, 'assets'),
            path.join(projectPath, 'extensions')
        ];
        const skipDirs = new Set(['node_modules', 'dist', '.git', 'library', 'temp', 'local', 'profiles', 'build']);

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

        // Scan all .scene and prominent .prefab files
        const exts = ['.scene', '.prefab'];
        for (const dir of searchDirs) {
            for (const ext of exts) {
                await walkFiles(dir, ext, async (filePath) => {
                    const relPath = path.relative(projectPath, filePath).replace(/\\/g, '/');
                    const fileBase = path.basename(filePath);
                    const isPrefab = ext === '.prefab';

                    try {
                        const raw = await fs.promises.readFile(filePath, 'utf8');
                        const data = JSON.parse(raw);
                        if (!Array.isArray(data)) return;

                        const tree = this.parseSceneData(relPath, fileBase, isPrefab, data, catalog);
                        if (tree && Object.keys(tree.nodes).length > 0) {
                            sceneFlows[relPath] = tree;
                        }
                    } catch (err) {
                        // ignore broken json
                    }
                });
            }
        }

        return sceneFlows;
    }

    private static parseSceneData(
        scenePath: string,
        sceneName: string,
        isPrefab: boolean,
        data: any[],
        catalog: Record<string, any>
    ): SceneFlowTree | null {
        // 1. Locate cc.Scene or Prefab Root
        let sceneRootNodeIdx: number | null = null;
        let rootNodeIndices: number[] = [];

        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (!item || typeof item !== 'object') continue;

            if (item.__type__ === 'cc.Scene' && Array.isArray(item._children)) {
                sceneRootNodeIdx = i;
                rootNodeIndices = item._children.map((c: any) => c.__id__).filter((id: any) => typeof id === 'number');
                break;
            }
        }

        // If prefab, root node is typically node without parent or index with __prefab
        if (isPrefab || rootNodeIndices.length === 0) {
            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                if (item && item.__type__ === 'cc.Node') {
                    if (!item._parent || typeof item._parent.__id__ !== 'number') {
                        rootNodeIndices.push(i);
                    }
                }
            }
        }

        // Index all nodes
        const rawNodes: Record<number, any> = {};
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (item && item.__type__ === 'cc.Node') {
                rawNodes[i] = item;
            }
        }

        const getNodePath = (nIdx: number): string => {
            const parts: string[] = [];
            let curr: number | null = nIdx;
            while (curr !== null && rawNodes[curr]) {
                parts.unshift(rawNodes[curr]._name || 'Node');
                const parent = rawNodes[curr]._parent;
                if (parent && typeof parent.__id__ === 'number') {
                    curr = parent.__id__;
                    if (curr === sceneRootNodeIdx) break; // stop at cc.Scene
                } else {
                    break;
                }
            }
            return parts.join('/');
        };

        const nodes: Record<string, SceneNodeFlow> = {};
        const rootNodeIds: string[] = [];
        let totalComponents = 0;
        let totalCustomScripts = 0;
        let totalWorkflows = 0;

        for (const [idxStr, rawNode] of Object.entries(rawNodes)) {
            const nodeIdx = parseInt(idxStr, 10);
            const nodePath = getNodePath(nodeIdx);
            const nodeId = `node_${sceneName}_${nodeIdx}_${rawNode._name || 'Node'}`;
            const nodeUuid = rawNode._id || (rawNode._prefab && typeof rawNode._prefab.__id__ === 'number' && data[rawNode._prefab.__id__] ? data[rawNode._prefab.__id__].fileId : undefined);

            const parentId = (rawNode._parent && typeof rawNode._parent.__id__ === 'number' && rawNode._parent.__id__ !== sceneRootNodeIdx && rawNodes[rawNode._parent.__id__])
                ? `node_${sceneName}_${rawNode._parent.__id__}_${rawNodes[rawNode._parent.__id__]._name || 'Node'}`
                : undefined;

            const childrenIds: string[] = [];
            if (Array.isArray(rawNode._children)) {
                for (const childRef of rawNode._children) {
                    if (childRef && typeof childRef.__id__ === 'number' && rawNodes[childRef.__id__]) {
                        childrenIds.push(`node_${sceneName}_${childRef.__id__}_${rawNodes[childRef.__id__]._name || 'Node'}`);
                    }
                }
            }

            if (rootNodeIndices.includes(nodeIdx)) {
                rootNodeIds.push(nodeId);
            }

            // Attached components
            const components: SceneComponentFlow[] = [];
            if (Array.isArray(rawNode._components)) {
                for (const compRef of rawNode._components) {
                    if (!compRef || typeof compRef.__id__ !== 'number') continue;
                    const compId = compRef.__id__;
                    const compData = data[compId];
                    if (!compData || typeof compData !== 'object') continue;

                    const rawType = compData.__type__ || '';
                    if (!rawType || rawType === 'cc.Node') continue;

                    totalComponents++;
                    const isEngineComp = rawType.startsWith('cc.') || rawType.startsWith('sp.') || rawType.startsWith('dragonBones.');
                    let className = rawType;
                    let scriptFile: string | undefined = undefined;
                    let isCustomScript = false;

                    if (!isEngineComp) {
                        const resolved = TypeRegistry.resolveClass(rawType);
                        if (resolved) {
                            className = resolved.className;
                            scriptFile = resolved.file;
                            isCustomScript = true;
                            totalCustomScripts++;
                        } else {
                            // Try decompressing UUID
                            const decompUuid = CocosUuidUtils.decompressUuid(rawType);
                            className = decompUuid ? `Script_${rawType.substring(0, 6)}` : rawType;
                            isCustomScript = true;
                            totalCustomScripts++;
                        }
                    }

                    // Correlate Workflows attached to this component
                    const workflows: SceneComponentWorkflow[] = [];

                    // 1. Emitters from Catalog
                    Object.values(catalog).forEach(catItem => {
                        catItem.emitters.forEach((e: any) => {
                            if (e.file === scenePath && (e.compId === compId || (e.className === className && e.node === nodePath))) {
                                workflows.push({
                                    kind: 'emit',
                                    title: `⚡ ${e.functionName || 'emit()'} ➔ ${catItem.name}`,
                                    detail: e.trigger,
                                    targetAsset: catItem.name
                                });
                                totalWorkflows++;
                            }
                        });

                        // 2. Listeners from Catalog
                        catItem.listeners.forEach((l: any) => {
                            if (l.file === scenePath && (l.compId === compId || (l.className === className && l.node === nodePath))) {
                                workflows.push({
                                    kind: 'listen',
                                    title: `🎧 ${l.boundMethod || l.functionName || 'handle'}()  ${catItem.name}`,
                                    detail: l.methodSignature,
                                    targetAsset: catItem.name
                                });
                                totalWorkflows++;
                            }
                        });

                        // 3. Params & Data Hooks
                        catItem.params.forEach((p: any) => {
                            if (p.file === scenePath && (p.compId === compId || (p.className === className && p.node === nodePath))) {
                                workflows.push({
                                    kind: 'param',
                                    title: `📦 ${p.property} ➔ ${catItem.name}`,
                                    targetAsset: catItem.name
                                });
                                totalWorkflows++;
                            }
                        });
                    });

                    // 4. AST Lifecycle & Method Invocations from FunctionWorkflowAnalyzer
                    if (isCustomScript) {
                        const startMethod = FunctionWorkflowAnalyzer.getMethod(className, 'start');
                        const onLoadMethod = FunctionWorkflowAnalyzer.getMethod(className, 'onLoad');

                        if (startMethod && startMethod.calls.length > 0) {
                            workflows.push({
                                kind: 'lifecycle',
                                title: `🔄 start() ➔ calls ${startMethod.calls.length} subroutines`,
                                detail: startMethod.calls.map(c => c.calleeName).join(', ')
                            });
                            totalWorkflows++;
                        }
                        if (onLoadMethod && onLoadMethod.calls.length > 0) {
                            workflows.push({
                                kind: 'lifecycle',
                                title: `🔄 onLoad() ➔ calls ${onLoadMethod.calls.length} subroutines`,
                                detail: onLoadMethod.calls.map(c => c.calleeName).join(', ')
                            });
                            totalWorkflows++;
                        }
                    }

                    components.push({
                        compId,
                        compUuid: compData._id,
                        rawType,
                        className,
                        scriptFile,
                        isCustomScript,
                        workflows
                    });
                }
            }

            nodes[nodeId] = {
                id: nodeId,
                uuid: nodeUuid,
                nodeIdx,
                name: rawNode._name || 'Node',
                path: nodePath,
                active: rawNode._active !== false,
                parentId,
                childrenIds,
                components
            };
        }

        return {
            scenePath,
            sceneName,
            isPrefab,
            rootNodeIds,
            nodes,
            summary: {
                totalNodes: Object.keys(nodes).length,
                totalComponents,
                totalCustomScripts,
                totalWorkflows
            }
        };
    }
}
