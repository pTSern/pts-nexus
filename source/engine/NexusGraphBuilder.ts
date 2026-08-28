import * as fs from 'fs';
import * as path from 'path';
import { CocosUuidUtils } from './CocosUuidUtils';
import { TypeScriptAstAnalyzer, TsClassMetadata } from './TypeScriptAstAnalyzer';
import { ScenePrefabScanner } from './ScenePrefabScanner';

export interface NexusEmitter {
    file: string;
    node: string;
    className: string;
    scriptFile: string;
    trigger: string;
    paramsPassed?: string;
    property: string;
}

export interface NexusListener {
    file: string;
    node: string;
    className: string;
    scriptFile: string;
    property: string;
    boundMethod?: string;
    methodSignature?: string;
}

export interface NexusParamHolder {
    file: string;
    node: string;
    className: string;
    scriptFile: string;
    property: string;
}

export interface NexusEventNode {
    uuid: string;
    path: string;
    name: string;
    domain: string;
    domainIcon: string;
    emitters: NexusEmitter[];
    listeners: NexusListener[];
    params: NexusParamHolder[];
}

export class NexusGraphBuilder {
    public static async build(projectPath: string): Promise<Record<string, NexusEventNode>> {
        const searchDirs = [
            path.join(projectPath, 'assets'),
            path.join(projectPath, 'extensions')
        ];

        // 1. Build UUID -> File path map from .meta files
        const uuidToPath: Record<string, string> = {};
        const pathToUuid: Record<string, string> = {};

        const walkFiles = async (dir: string, ext: string, callback: (filePath: string) => Promise<void>) => {
            if (!fs.existsSync(dir)) return;
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!['node_modules', '.git', 'temp', 'library', 'local', 'profiles', 'dist'].includes(entry.name)) {
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

        // 2. Parse TypeScript files
        const tsByFile: Record<string, TsClassMetadata> = {};
        const tsByUuid: Record<string, TsClassMetadata> = {};
        const tsByClass: Record<string, TsClassMetadata> = {};

        for (const dir of searchDirs) {
            await walkFiles(dir, '.ts', async (tsPath) => {
                if (tsPath.endsWith('.d.ts')) return;
                try {
                    const content = await fs.promises.readFile(tsPath, 'utf8');
                    const relPath = path.relative(projectPath, tsPath).replace(/\\/g, '/');
                    const meta = TypeScriptAstAnalyzer.analyzeSource(content, relPath);
                    if (meta) {
                        tsByFile[relPath] = meta;
                        const uuid = pathToUuid[relPath];
                        if (uuid) tsByUuid[uuid] = meta;
                        if (meta.ccclass) tsByClass[meta.ccclass] = meta;
                        if (meta.className) tsByClass[meta.className] = meta;
                    }
                } catch {}
            });
        }

        const resolveComp = (compType: string): TsClassMetadata | null => {
            if (!compType) return null;
            if (tsByClass[compType]) return tsByClass[compType];
            const decomp = CocosUuidUtils.decompressUuid(compType);
            if (tsByUuid[decomp]) return tsByUuid[decomp];
            if (tsByUuid[compType]) return tsByUuid[compType];
            const p = uuidToPath[decomp] || uuidToPath[compType];
            if (p && tsByFile[p]) return tsByFile[p];
            return null;
        };

        // 3. Initialize event nodes catalog with smart dynamic domain extraction
        const catalog: Record<string, NexusEventNode> = {};
        for (const [uuid, p] of Object.entries(uuidToPath)) {
            if (p.endsWith('.json') && (p.includes('events') || p.includes('params') || p.includes('id') || p.includes('json'))) {
                const name = path.basename(p);
                const pathLower = p.toLowerCase();
                let domain = 'Core / Other';
                let domainIcon = '⚙️';

                // Extract dynamic folder category
                const normParts = p.replace(/\\/g, '/').split('/');
                const evFolderIdx = normParts.findIndex(part => part.toLowerCase() === 'events' || part.toLowerCase() === 'params');

                if (evFolderIdx !== -1 && evFolderIdx + 1 < normParts.length - 1) {
                    const subFolder = normParts[evFolderIdx + 1];
                    const subFolderLower = subFolder.toLowerCase();
                    const words = subFolder.split(/[_-]/).map(w => w.toUpperCase() === 'UI' ? 'UI' : (w.charAt(0).toUpperCase() + w.slice(1)));
                    domain = words.join(' ');

                    if (subFolderLower.includes('ui')) { domain = 'UI Navigation'; domainIcon = '🖥️'; }
                    else if (subFolderLower.includes('game') || subFolderLower.includes('level') || subFolderLower.includes('match')) { domain = 'Match-3 Gameplay'; domainIcon = '🎮'; }
                    else if (subFolderLower.includes('ads')) { domain = 'Ads System'; domainIcon = '📺'; }
                    else if (subFolderLower.includes('data') || subFolderLower.includes('economy') || subFolderLower.includes('coin') || subFolderLower.includes('star') || subFolderLower.includes('energy')) { domain = 'Economy & Data'; domainIcon = '🪙'; }
                    else if (subFolderLower.includes('firebase') || subFolderLower.includes('auth')) { domain = 'Firebase & Auth'; domainIcon = '🔥'; }
                    else if (subFolderLower.includes('builder') || subFolderLower.includes('decor')) { domain = 'Home Builder'; domainIcon = '🏗️'; }
                    else if (subFolderLower.includes('sound') || subFolderLower.includes('audio') || subFolderLower.includes('music')) { domain = 'Audio System'; domainIcon = '🎵'; }
                    else { domainIcon = '📁'; }
                } else {
                    if (pathLower.includes('events/ui') || name.toLowerCase().includes('ui')) {
                        domain = 'UI Navigation'; domainIcon = '🖥️';
                    } else if (pathLower.includes('events/game_play') || name.toLowerCase().includes('game') || name.toLowerCase().includes('level')) {
                        domain = 'Match-3 Gameplay'; domainIcon = '🎮';
                    } else if (pathLower.includes('events/ads') || name.toLowerCase().includes('ads')) {
                        domain = 'Ads System'; domainIcon = '📺';
                    } else if (pathLower.includes('events/data') || name.toLowerCase().includes('coin') || name.toLowerCase().includes('star') || name.toLowerCase().includes('energy') || pathLower.includes('params')) {
                        domain = 'Economy & Data'; domainIcon = '🪙';
                    } else if (pathLower.includes('events/firebase') || name.toLowerCase().includes('firebase')) {
                        domain = 'Firebase & Auth'; domainIcon = '🔥';
                    } else if (pathLower.includes('events/builder') || name.toLowerCase().includes('builder')) {
                        domain = 'Home Builder'; domainIcon = '🏗️';
                    }
                }

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

        // 4. Scan scenes and prefabs
        const sceneAndPrefabExts = ['.scene', '.prefab'];
        for (const dir of searchDirs) {
            for (const ext of sceneAndPrefabExts) {
                await walkFiles(dir, ext, async (filePath) => {
                    const relPath = path.relative(projectPath, filePath).replace(/\\/g, '/');
                    try {
                        const raw = await fs.promises.readFile(filePath, 'utf8');
                        const data = JSON.parse(raw);
                        if (!Array.isArray(data)) return;

                        const nodes: Record<number, any> = {};
                        for (let i = 0; i < data.length; i++) {
                            if (data[i] && data[i].__type__ === 'cc.Node') {
                                nodes[i] = data[i];
                            }
                        }

                        const fileBase = path.basename(filePath, ext);
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

                        for (const entry of data) {
                            if (!entry || typeof entry !== 'object') continue;
                            const t = entry.__type__;
                            if (!t || t.startsWith('cc.Scene') || t.startsWith('cc.PrefabInfo') || t.startsWith('cc.CompPrefabInfo') || t === 'cc.Node') {
                                continue;
                            }

                            const nodeRef = entry.node;
                            let rawPath = 'Root';
                            if (nodeRef && typeof nodeRef.__id__ === 'number' && nodes[nodeRef.__id__]) {
                                rawPath = getNodePath(nodeRef.__id__);
                            }

                            // Format clean explicit node identifier (replace generic 'Root' with actual prefab/scene name)
                            let nodePath = rawPath;
                            if (nodePath === 'Root' || !nodePath) {
                                nodePath = fileBase;
                            } else if (nodePath.startsWith('Root/')) {
                                nodePath = fileBase + nodePath.substring(4);
                            }

                            const compMeta = resolveComp(t);
                            const className = compMeta ? compMeta.className : t;
                            const scriptFile = compMeta ? compMeta.filePath : 'Unknown';

                            // Check helpers (Event_Driver)
                            const helpers = entry._helpers || entry.helpers;
                            if (Array.isArray(helpers)) {
                                for (const hRef of helpers) {
                                    const hObj = hRef && typeof hRef.__id__ === 'number' ? data[hRef.__id__] : hRef;
                                    if (hObj && typeof hObj === 'object') {
                                        const hKey = hObj.key || '';
                                        const flexRef = hObj.flex;
                                        const flexObj = flexRef && typeof flexRef.__id__ === 'number' ? data[flexRef.__id__] : flexRef;
                                        if (flexObj && typeof flexObj === 'object') {
                                            const jUuids = ScenePrefabScanner.findJsonUuids(flexObj.json, data);
                                            for (const juuid of jUuids) {
                                                if (catalog[juuid]) {
                                                    let argsPassed = '';
                                                    if (compMeta) {
                                                        const emitItem = compMeta.eventEmits.find(e => e.bounceKey === hKey);
                                                        if (emitItem) argsPassed = emitItem.argsPassed;
                                                    }
                                                    catalog[juuid].emitters.push({
                                                        file: relPath,
                                                        node: nodePath,
                                                        className,
                                                        scriptFile,
                                                        trigger: `Event_Driver.emit('${hKey}')`,
                                                        paramsPassed: argsPassed,
                                                        property: `helpers[${hKey}]`
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Check Smart_Button onClicks
                            if (entry.onClicks) {
                                const jUuids = ScenePrefabScanner.findJsonUuids(entry.onClicks, data);
                                for (const juuid of jUuids) {
                                    if (catalog[juuid]) {
                                        catalog[juuid].emitters.push({
                                            file: relPath,
                                            node: nodePath,
                                            className,
                                            scriptFile,
                                            trigger: 'Smart_Button.onClick',
                                            paramsPassed: 'event / button',
                                            property: 'onClicks'
                                        });
                                    }
                                }
                            }

                            // Check all properties
                            for (const propName of Object.keys(entry)) {
                                if (['_helpers', 'helpers', 'onClicks', '_objFlags', 'node', '__prefab'].includes(propName)) continue;
                                const jUuids = ScenePrefabScanner.findJsonUuids(entry[propName], data);
                                if (!jUuids || jUuids.length === 0) continue;

                                let isListener = false;
                                let boundMethod: string | undefined;
                                let methodSignature = '';

                                if (compMeta) {
                                    const addItem = compMeta.eventAdds.find(a => a.property === propName);
                                    if (addItem) {
                                        isListener = true;
                                        boundMethod = addItem.callback;
                                        methodSignature = compMeta.methods[addItem.callback] || '';
                                    }
                                }

                                let isEmitter = false;
                                let invokeArgs = '';
                                if (compMeta) {
                                    const invItem = compMeta.eventInvokes.find(i => i.property === propName);
                                    if (invItem) {
                                        isEmitter = true;
                                        invokeArgs = invItem.argsPassed;
                                    }
                                }

                                for (const juuid of jUuids) {
                                    if (!catalog[juuid]) continue;
                                    if (isListener) {
                                        catalog[juuid].listeners.push({
                                            file: relPath,
                                            node: nodePath,
                                            className,
                                            scriptFile,
                                            property: propName,
                                            boundMethod,
                                            methodSignature
                                        });
                                    } else if (isEmitter) {
                                        catalog[juuid].emitters.push({
                                            file: relPath,
                                            node: nodePath,
                                            className,
                                            scriptFile,
                                            trigger: `pEngine.Json.event.invoke(${propName})`,
                                            paramsPassed: invokeArgs,
                                            property: propName
                                        });
                                    } else if (propName.startsWith('act') || propName.startsWith('on') || propName.startsWith('evt')) {
                                        catalog[juuid].listeners.push({
                                            file: relPath,
                                            node: nodePath,
                                            className,
                                            scriptFile,
                                            property: propName,
                                            boundMethod: boundMethod || `implicit handler for ${propName}`,
                                            methodSignature
                                        });
                                    } else {
                                        catalog[juuid].params.push({
                                            file: relPath,
                                            node: nodePath,
                                            className,
                                            scriptFile,
                                            property: propName
                                        });
                                    }
                                }
                            }
                        }
                    } catch {}
                });
            }
        }

        // Deduplicate
        for (const item of Object.values(catalog)) {
            const seenE = new Set<string>();
            item.emitters = item.emitters.filter(e => {
                const k = `${e.file}|${e.node}|${e.className}|${e.trigger}`;
                if (seenE.has(k)) return false;
                seenE.add(k);
                return true;
            });

            const seenL = new Set<string>();
            item.listeners = item.listeners.filter(l => {
                const k = `${l.file}|${l.node}|${l.className}|${l.property}|${l.boundMethod}`;
                if (seenL.has(k)) return false;
                seenL.add(k);
                return true;
            });

            const seenP = new Set<string>();
            item.params = item.params.filter(p => {
                const k = `${p.file}|${p.node}|${p.className}|${p.property}`;
                if (seenP.has(k)) return false;
                seenP.add(k);
                return true;
            });
        }

        return catalog;
    }
}
