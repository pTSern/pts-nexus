export class ScenePrefabScanner {
    public static findJsonUuids(obj: any, rawData: any[], depth = 0): string[] {
        if (depth > 5 || !obj) return [];
        const found: string[] = [];

        if (typeof obj === 'object') {
            if (obj.__uuid__) {
                found.push(obj.__uuid__);
            } else if (typeof obj.__id__ === 'number') {
                const target = rawData[obj.__id__];
                if (target) {
                    found.push(...this.findJsonUuids(target, rawData, depth + 1));
                }
            } else {
                for (const key of Object.keys(obj)) {
                    if (key.startsWith('_') && !['_helpers', '_data', 'helpers', 'data'].includes(key)) {
                        continue;
                    }
                    found.push(...this.findJsonUuids(obj[key], rawData, depth + 1));
                }
            }
        } else if (Array.isArray(obj)) {
            for (const item of obj) {
                found.push(...this.findJsonUuids(item, rawData, depth + 1));
            }
        }
        return found;
    }
}
