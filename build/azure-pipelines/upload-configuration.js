"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettingsSearchBuildId = exports.shouldSetupSettingsSearch = void 0;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const cp = __importStar(require("child_process"));
const vfs = __importStar(require("vinyl-fs"));
const util = __importStar(require("../lib/util"));
const identity_1 = require("@azure/identity");
const azure = require('gulp-azure-storage');
const packageJson = __importStar(require("../../package.json"));
const commit = process.env['VSCODE_DISTRO_COMMIT'] || process.env['BUILD_SOURCEVERSION'];
function generateVSCodeConfigurationTask() {
    return new Promise((resolve, reject) => {
        const buildDir = process.env['AGENT_BUILDDIRECTORY'];
        if (!buildDir) {
            return reject(new Error('$AGENT_BUILDDIRECTORY not set'));
        }
        if (!shouldSetupSettingsSearch()) {
            console.log(`Only runs on main and release branches, not ${process.env.BUILD_SOURCEBRANCH}`);
            return resolve(undefined);
        }
        if (process.env.VSCODE_QUALITY !== 'insider' && process.env.VSCODE_QUALITY !== 'stable') {
            console.log(`Only runs on insider and stable qualities, not ${process.env.VSCODE_QUALITY}`);
            return resolve(undefined);
        }
        const result = path.join(os.tmpdir(), 'configuration.json');
        const userDataDir = path.join(os.tmpdir(), 'tmpuserdata');
        const extensionsDir = path.join(os.tmpdir(), 'tmpextdir');
        const arch = process.env['VSCODE_ARCH'];
        const appRoot = path.join(buildDir, `VSCode-darwin-${arch}`);
        const appName = process.env.VSCODE_QUALITY === 'insider' ? 'Visual\\ Studio\\ Code\\ -\\ Insiders.app' : 'Visual\\ Studio\\ Code.app';
        const appPath = path.join(appRoot, appName, 'Contents', 'Resources', 'app', 'bin', 'code');
        const codeProc = cp.exec(`${appPath} --export-default-configuration='${result}' --wait --user-data-dir='${userDataDir}' --extensions-dir='${extensionsDir}'`, (err, stdout, stderr) => {
            clearTimeout(timer);
            if (err) {
                console.log(`err: ${err} ${err.message} ${err.toString()}`);
                reject(err);
            }
            if (stdout) {
                console.log(`stdout: ${stdout}`);
            }
            if (stderr) {
                console.log(`stderr: ${stderr}`);
            }
            resolve(result);
        });
        const timer = setTimeout(() => {
            codeProc.kill();
            reject(new Error('export-default-configuration process timed out'));
        }, 60 * 1000);
        codeProc.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
function shouldSetupSettingsSearch() {
    const branch = process.env.BUILD_SOURCEBRANCH;
    return !!(branch && (/\/main$/.test(branch) || branch.indexOf('/release/') >= 0));
}
exports.shouldSetupSettingsSearch = shouldSetupSettingsSearch;
function getSettingsSearchBuildId(packageJson) {
    try {
        const branch = process.env.BUILD_SOURCEBRANCH;
        const branchId = branch.indexOf('/release/') >= 0 ? 0 :
            /\/main$/.test(branch) ? 1 :
                2; // Some unexpected branch
        const out = cp.execSync(`git rev-list HEAD --count`);
        const count = parseInt(out.toString());
        // <version number><commit count><branchId (avoid unlikely conflicts)>
        // 1.25.1, 1,234,567 commits, main = 1250112345671
        return util.versionStringToNumber(packageJson.version) * 1e8 + count * 10 + branchId;
    }
    catch (e) {
        throw new Error('Could not determine build number: ' + e.toString());
    }
}
exports.getSettingsSearchBuildId = getSettingsSearchBuildId;
async function main() {
    const configPath = await generateVSCodeConfigurationTask();
    if (!configPath) {
        return;
    }
    const settingsSearchBuildId = getSettingsSearchBuildId(packageJson);
    if (!settingsSearchBuildId) {
        throw new Error('Failed to compute build number');
    }
    const credential = new identity_1.ClientSecretCredential(process.env['AZURE_TENANT_ID'], process.env['AZURE_CLIENT_ID'], process.env['AZURE_CLIENT_SECRET']);
    return new Promise((c, e) => {
        vfs.src(configPath)
            .pipe(azure.upload({
            account: process.env.AZURE_STORAGE_ACCOUNT,
            credential,
            container: 'configuration',
            prefix: `${settingsSearchBuildId}/${commit}/`
        }))
            .on('end', () => c())
            .on('error', (err) => e(err));
    });
}
if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
