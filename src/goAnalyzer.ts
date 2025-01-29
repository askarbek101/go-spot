import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import { GoAnalysisResult, StructInfo, InterfaceInfo, ParamInfo } from './types';

interface MethodSignature {
    name: string;
    parameters: ParamInfo[];
    returnTypes: string[];
}

function methodsMatch(structMethod: MethodSignature, interfaceMethod: MethodSignature): boolean {
    // Check name
    if (structMethod.name !== interfaceMethod.name) {
        return false;
    }

    // Check parameters length
    if (structMethod.parameters.length !== interfaceMethod.parameters.length) {
        return false;
    }

    // Check return types length
    if (structMethod.returnTypes.length !== interfaceMethod.returnTypes.length) {
        return false;
    }

    // For generic interfaces, we need to match parameter types considering type parameters
    for (let i = 0; i < structMethod.parameters.length; i++) {
        const structParam = structMethod.parameters[i];
        const interfaceParam = interfaceMethod.parameters[i];
        
        // If interface parameter is a type parameter (like T), it matches any type
        if (interfaceParam.type.length === 1 && interfaceParam.type.match(/^[A-Z]$/)) {
            continue;
        }
        
        if (structParam.type !== interfaceParam.type) {
            return false;
        }
    }

    // Check return types similarly
    for (let i = 0; i < structMethod.returnTypes.length; i++) {
        const structReturn = structMethod.returnTypes[i];
        const interfaceReturn = interfaceMethod.returnTypes[i];
        
        // If interface return is a type parameter, it matches any type
        if (interfaceReturn.length === 1 && interfaceReturn.match(/^[A-Z]$/)) {
            continue;
        }
        
        if (structReturn !== interfaceReturn) {
            return false;
        }
    }

    return true;
}

function implementsInterface(struct: StructInfo, iface: InterfaceInfo): boolean {
    // For each method in the interface
    for (const interfaceMethod of iface.methods) {
        // Find a matching method in the struct
        const matchingMethod = struct.methods.find(structMethod => 
            methodsMatch(structMethod, interfaceMethod)
        );

        if (!matchingMethod) {
            return false;
        }
    }

    return true;
}

export class GoAnalyzerService {
    private analyzerPath: string;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.analyzerPath = path.join(context.extensionPath, 'out', 'goanalyzer');
        this.outputChannel = vscode.window.createOutputChannel('Go Analyzer');
        this.log('Analyzer path:', this.analyzerPath);
    }

    private log(...messages: any[]) {
        const message = messages.map(m => 
            typeof m === 'string' ? m : JSON.stringify(m, null, 2)
        ).join(' ');
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }

    private async findGoPath(): Promise<string> {
        // Try common Go installation paths
        const possiblePaths = process.platform === 'win32' 
            ? [
                'C:\\Program Files\\Go\\bin\\go.exe',
                'C:\\Go\\bin\\go.exe',
                path.join(process.env.LOCALAPPDATA || '', 'Go\\bin\\go.exe'),
                path.join(process.env.GOPATH || '', 'bin\\go.exe')
              ]
            : [
                '/usr/local/go/bin/go',
                '/usr/bin/go',
                path.join(process.env.HOME || '', 'go/bin/go')
              ];

        // Add PATH locations
        if (process.env.PATH) {
            const pathExt = process.platform === 'win32' ? '.exe' : '';
            process.env.PATH.split(path.delimiter).forEach(p => {
                possiblePaths.push(path.join(p, `go${pathExt}`));
            });
        }

        // Check each possible path
        for (const p of possiblePaths) {
            try {
                await fs.promises.access(p, fs.constants.X_OK);
                return p;
            } catch {
                continue;
            }
        }

        throw new Error('Go installation not found. Please install Go and make sure it\'s in your PATH.');
    }

    private async setupGoModule(goPath: string): Promise<void> {
        // Initialize Go module if it doesn't exist
        if (!fs.existsSync(path.join(this.analyzerPath, 'go.mod'))) {
            this.log('Initializing Go module');
            await new Promise<void>((resolve, reject) => {
                const process = cp.spawn(goPath, ['mod', 'init', 'goanalyzer'], {
                    cwd: this.analyzerPath
                });
                process.on('error', reject);
                process.on('close', code => {
                    if (code === 0) resolve();
                    else reject(new Error(`go mod init failed with code ${code}`));
                });
            });
        }

        // Add required dependencies
        this.log('Adding required dependencies');
        await new Promise<void>((resolve, reject) => {
            const process = cp.spawn(goPath, ['get', 'golang.org/x/tools/go/packages@latest'], {
                cwd: this.analyzerPath
            });
            process.on('error', reject);
            process.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`go get failed with code ${code}`));
            });
        });

        // Tidy up dependencies
        this.log('Tidying dependencies');
        await new Promise<void>((resolve, reject) => {
            const process = cp.spawn(goPath, ['mod', 'tidy'], {
                cwd: this.analyzerPath
            });
            process.on('error', reject);
            process.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`go mod tidy failed with code ${code}`));
            });
        });
    }

    public async analyzeWorkspace(workspacePath: string): Promise<GoAnalysisResult> {
        return new Promise(async (resolve, reject) => {
            try {
                this.log('Analyzing workspace:', workspacePath);

                // Ensure the path exists
                if (!vscode.workspace.workspaceFolders || !workspacePath) {
                    reject(new Error('No workspace folder found'));
                    return;
                }

                // Find Go installation
                const goPath = await this.findGoPath();
                this.log('Found Go at:', goPath);

                // Convert Windows paths if necessary
                const normalizedPath = workspacePath.replace(/\\/g, '/');
                this.log('Normalized path:', normalizedPath);

                // Check if analyzer directory exists
                if (!fs.existsSync(this.analyzerPath)) {
                    this.log('Creating analyzer directory');
                    await fs.promises.mkdir(this.analyzerPath, { recursive: true });
                }

                // Copy Go files to analyzer directory if they don't exist
                const sourceDir = path.join(path.dirname(this.analyzerPath), '..', 'goanalyzer');
                if (fs.existsSync(sourceDir)) {
                    this.log('Copying analyzer files from:', sourceDir);
                    for (const file of await fs.promises.readdir(sourceDir)) {
                        if (file.endsWith('.go') || file === 'go.mod') {
                            const sourcePath = path.join(sourceDir, file);
                            const destPath = path.join(this.analyzerPath, file);
                            await fs.promises.copyFile(sourcePath, destPath);
                        }
                    }
                }

                // Setup Go module
                await this.setupGoModule(goPath);

                const process = cp.spawn(goPath, ['run', '.', '-path', normalizedPath], {
                    cwd: this.analyzerPath
                });

                let stdout = '';
                let stderr = '';

                process.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    this.log('Analyzer stdout:', chunk);
                    stdout += chunk;
                });

                process.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    this.log('Analyzer stderr:', chunk);
                    stderr += chunk;
                });

                process.on('error', (error) => {
                    this.log('Failed to start analyzer process:', error);
                    reject(new Error(`Failed to start analyzer: ${error.message}`));
                });

                process.on('close', (code) => {
                    this.log('Analyzer process closed with code:', code);
                    if (code !== 0) {
                        reject(new Error(`Go analyzer failed with code ${code}: ${stderr}`));
                        return;
                    }

                    try {
                        if (!stdout.trim()) {
                            reject(new Error('Analyzer produced no output'));
                            return;
                        }

                        const result = JSON.parse(stdout) as GoAnalysisResult;
                        
                        // Validate the result structure
                        if (!result || typeof result !== 'object') {
                            reject(new Error('Invalid analyzer output: not an object'));
                            return;
                        }

                        if (!Array.isArray(result.interfaces) || !Array.isArray(result.structs)) {
                            reject(new Error('Invalid analyzer output: missing interfaces or structs arrays'));
                            return;
                        }

                        this.log('Analysis complete. Found:', {
                            interfaces: result.interfaces.length,
                            structs: result.structs.length
                        });

                        // Post-process the analysis results
                        for (const struct of result.structs) {
                            struct.implementedInterfaces = [];
                            
                            // Check each interface
                            for (const iface of result.interfaces) {
                                if (implementsInterface(struct, iface)) {
                                    struct.implementedInterfaces.push(iface);
                                    
                                    // Update method implementation information
                                    for (const method of struct.methods) {
                                        const matchingInterfaceMethod = iface.methods.find(im => 
                                            methodsMatch(method, im)
                                        );
                                        
                                        if (matchingInterfaceMethod) {
                                            if (!method.implementedFrom) {
                                                method.implementedFrom = [];
                                            }
                                            method.implementedFrom.push({
                                                name: `${iface.name}.${matchingInterfaceMethod.name}`,
                                                position: iface.position
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        
                        resolve(result);
                    } catch (err) {
                        this.log('Failed to parse analyzer output:', err);
                        this.log('Raw output:', stdout);
                        reject(new Error(`Failed to parse analyzer output: ${err instanceof Error ? err.message : String(err)}`));
                    }
                });
            } catch (error) {
                this.log('Error in analyzeWorkspace:', error);
                reject(error);
            }
        });
    }

    public async getStruct(workspacePath: string, structName: string): Promise<StructInfo | null> {
        const result = await this.analyzeWorkspace(workspacePath);
        const struct = result.structs.find(s => s.name === structName);
        return struct || null;
    }

    public async findStructDeclaration(structInfo: StructInfo): Promise<vscode.Location | null> {
        try {
            // Convert the relative path to absolute
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return null;
            }

            const absolutePath = path.join(workspaceFolders[0].uri.fsPath, structInfo.position.path);
            const uri = vscode.Uri.file(absolutePath);

            // Create a position object for VS Code
            const position = new vscode.Position(structInfo.position.line - 1, 0);
            return new vscode.Location(uri, position);
        } catch (error) {
            this.log('Error finding struct declaration:', error);
            return null;
        }
    }

    public async showStructInfo(structName: string): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const struct = await this.getStruct(workspaceFolders[0].uri.fsPath, structName);
            if (!struct) {
                vscode.window.showErrorMessage(`Struct ${structName} not found`);
                return;
            }

            // Create and show the webview
            const panel = vscode.window.createWebviewPanel(
                'structInfo',
                `Struct: ${structName}`,
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );

            panel.webview.html = this.getStructWebviewContent(struct);

            // Add a button to jump to declaration
            const location = await this.findStructDeclaration(struct);
            if (location) {
                vscode.window.showTextDocument(location.uri, {
                    selection: location.range,
                    viewColumn: vscode.ViewColumn.One
                });
            }
        } catch (error) {
            this.log('Error showing struct info:', error);
            vscode.window.showErrorMessage('Failed to show struct information');
        }
    }

    private getStructWebviewContent(struct: StructInfo): string {
        return `<!DOCTYPE html>
        <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    .section { margin-bottom: 20px; }
                    .item { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 4px; }
                    .method { margin-left: 20px; padding: 5px; }
                    code { background: #e0e0e0; padding: 2px 4px; border-radius: 3px; }
                    .interface-list { margin-top: 10px; }
                    .interface-item { color: #0066cc; margin: 5px 0; }
                </style>
            </head>
            <body>
                <h1>${struct.name}</h1>
                <div class="section">
                    <p>Declared in: ${struct.position.path}:${struct.position.line}</p>
                    
                    ${struct.implementedInterfaces.length > 0 ? `
                        <div class="interface-list">
                            <h3>Implements:</h3>
                            ${struct.implementedInterfaces.map(iface => `
                                <div class="interface-item">
                                    ${iface.name} (${iface.position.path}:${iface.position.line})
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}

                    ${struct.methods.length > 0 ? `
                        <h3>Methods:</h3>
                        ${struct.methods.map(method => `
                            <div class="method">
                                <code>${method.name}(${method.parameters.map(p => 
                                    `${p.name}: ${p.type}`
                                ).join(', ')})${method.returnTypes.length ? ' -> ' + method.returnTypes.join(', ') : ''}</code>
                                ${method.implementedFrom.length > 0 ? `
                                    <div class="interface-item">
                                        Implements: ${method.implementedFrom.map(impl => 
                                            `${impl.name} (${impl.position.path}:${impl.position.line})`
                                        ).join(', ')}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    ` : ''}

                    ${struct.embeddedTypes.length > 0 ? `
                        <h3>Embedded Types:</h3>
                        <ul>
                            ${struct.embeddedTypes.map(type => `<li>${type}</li>`).join('')}
                        </ul>
                    ` : ''}
                </div>
            </body>
        </html>`;
    }
} 