const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = __dirname;
const mainJsPath = path.join(rootDir, 'dist/main.js');

function runCmd(cmd, args) {
    const isWin = process.platform === 'win32';
    const resolvedCmd = isWin ? `${cmd}.cmd` : cmd;
    console.log(`[pts-nexus Bootstrap] Running: ${cmd} ${args.join(' ')}`);
    const result = spawnSync(resolvedCmd, args, { cwd: rootDir, shell: true, stdio: 'inherit' });
    return result.status === 0;
}

if (!fs.existsSync(mainJsPath)) {
    console.log('[pts-nexus Bootstrap] dist/main.js not found. Compiling TypeScript...');
    runCmd('npx', ['tsc']);
}

let mainModule = null;
if (fs.existsSync(mainJsPath)) {
    try {
        mainModule = require(mainJsPath);
    } catch (err) {
        console.error('[pts-nexus Bootstrap] Failed to require dist/main.js:', err);
    }
}

exports.load = function() {
    if (mainModule && typeof mainModule.load === 'function') {
        return mainModule.load();
    }
};

exports.unload = function() {
    if (mainModule && typeof mainModule.unload === 'function') {
        return mainModule.unload();
    }
};

exports.methods = new Proxy({}, {
    get(target, prop) {
        if (mainModule && mainModule.methods && mainModule.methods[prop]) {
            return mainModule.methods[prop];
        }
        return undefined;
    },
    has(target, prop) {
        return !!(mainModule && mainModule.methods && prop in mainModule.methods);
    }
});
