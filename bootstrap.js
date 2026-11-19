const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXT_NAME = 'pts-nexus';
const rootDir = __dirname;
const coreDir = path.resolve(rootDir, '..', 'pts-core');
const coreNodeModulesPath = path.join(coreDir, 'node_modules');
const nodeModulesPath = path.join(rootDir, 'node_modules');
const mainJsPath = path.join(rootDir, 'dist/main.js');

function runCmd(cmd, args, cwd = rootDir) {
    const isWin = process.platform === 'win32';
    const resolvedCmd = isWin ? `${cmd}.cmd` : cmd;
    console.log(`[${EXT_NAME} Bootstrap] Running: ${cmd} ${args.join(' ')}`);
    const result = spawnSync(resolvedCmd, args, { cwd, shell: true, stdio: 'inherit' });
    return result.status === 0;
}

function ensureCoreNodeModules() {
    if (!fs.existsSync(coreDir)) {
        console.error(
            `[${EXT_NAME} Bootstrap] ERROR: Required dependency "pts-core" not found at "${coreDir}". ` +
            'Please install "pts-core" in your project extensions/ folder.'
        );
        return false;
    }

    if (!fs.existsSync(coreNodeModulesPath)) {
        console.log(`[${EXT_NAME} Bootstrap] pts-core/node_modules not found. Auto-running npm install in pts-core...`);
        runCmd('npm', ['install'], coreDir);
    }

    if (!fs.existsSync(coreNodeModulesPath)) {
        console.error(`[${EXT_NAME} Bootstrap] ERROR: Failed to initialize pts-core/node_modules at "${coreNodeModulesPath}".`);
        return false;
    }

    try {
        const stat = fs.lstatSync(nodeModulesPath);
        if (stat.isSymbolicLink()) {
            const target = fs.realpathSync(nodeModulesPath);
            const expected = fs.realpathSync(coreNodeModulesPath);
            if (target === expected) {
                return true;
            }
            fs.unlinkSync(nodeModulesPath);
        } else {
            return true;
        }
    } catch (e) {
        try {
            if (fs.lstatSync(nodeModulesPath).isSymbolicLink()) {
                fs.unlinkSync(nodeModulesPath);
            }
        } catch (_) {}
    }

    try {
        fs.symlinkSync(coreNodeModulesPath, nodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');
        console.log(`[${EXT_NAME} Bootstrap] Linked node_modules -> ../pts-core/node_modules`);
        return true;
    } catch (err) {
        console.error(`[${EXT_NAME} Bootstrap] ERROR: Failed to link node_modules to pts-core:`, err);
        return false;
    }
}

const coreReady = ensureCoreNodeModules();

if (coreReady && !fs.existsSync(mainJsPath)) {
    console.log(`[${EXT_NAME} Bootstrap] dist/main.js not found. Auto-building...`);
    const tscBin = path.join(nodeModulesPath, 'typescript', 'bin', 'tsc');
    if (fs.existsSync(tscBin)) {
        spawnSync(process.execPath, [tscBin, '--project', 'tsconfig.json'], { cwd: rootDir, stdio: 'inherit' });
    } else {
        runCmd('npm', ['run', 'build']);
    }
}

let mainModule = null;
if (coreReady && fs.existsSync(mainJsPath)) {
    try {
        mainModule = require(mainJsPath);
    } catch (err) {
        console.error(`[${EXT_NAME} Bootstrap] Failed to require dist/main.js:`, err);
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