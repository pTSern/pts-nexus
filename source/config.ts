import * as fs from 'fs';
import * as path from 'path';

export interface NexusConfig {
    isQueryOnLoad: boolean;
    autoRefreshOnSceneChange?: boolean;
}

const DEFAULT_CONFIG: NexusConfig = {
    isQueryOnLoad: true,
    autoRefreshOnSceneChange: false
};

export class NexusConfigManager {
    public static getConfigPath(): string {
        const projectPath = typeof Editor !== 'undefined' && Editor?.Project?.path ? Editor.Project.path : process.cwd();
        return path.join(projectPath, 'settings', 'pts-nexus.json');
    }

    public static readConfig(): NexusConfig {
        try {
            const file = this.getConfigPath();
            if (fs.existsSync(file)) {
                const raw = fs.readFileSync(file, 'utf8');
                return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
            }
        } catch (e) {
            console.error('[pts-nexus] Error reading settings:', e);
        }
        return DEFAULT_CONFIG;
    }

    public static saveConfig(cfg: Partial<NexusConfig>): void {
        try {
            const file = this.getConfigPath();
            const dir = path.dirname(file);
            if (!fs.existsSync(dir)) {
                (fs as any).mkdirSync(dir, { recursive: true });
            }
            const current = this.readConfig();
            const updated = { ...current, ...cfg };
            fs.writeFileSync(file, JSON.stringify(updated, null, 2), 'utf8');
        } catch (e) {
            console.error('[pts-nexus] Error saving settings:', e);
        }
    }
}
