// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GoAnalyzerService } from './goAnalyzer';
import { GoAnalysisResult, Position, ParamInfo } from './types';

// Create an output channel for logging
const outputChannel = vscode.window.createOutputChannel('Go Spot');

function log(message: string, error?: any) {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] ${message}`;
	outputChannel.appendLine(logMessage);
	if (error) {
		outputChannel.appendLine(`Error details: ${error.message}`);
		outputChannel.appendLine(`Stack trace: ${error.stack}`);
	}
}

// Create decoration type for highlighting
const firstRowDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(100, 100, 100, 0.3)'
});

let globalContext: vscode.ExtensionContext;

// Add cache manager
class AnalysisCacheManager {
	private cache: GoAnalysisResult | null = null;
	private lastAnalysisTime: number = 0;
	private analyzer: GoAnalyzerService;

	constructor(analyzer: GoAnalyzerService) {
		this.analyzer = analyzer;
	}

	async getAnalysisData(workspacePath: string, forceRefresh: boolean = false): Promise<GoAnalysisResult> {
		const currentTime = Date.now();
		
		// If cache exists and is not forced to refresh, return cached data
		if (!forceRefresh && this.cache && (currentTime - this.lastAnalysisTime) < 5000) {
			log('Using cached analysis data');
			return this.cache;
		}

		// Perform new analysis
		log('Performing fresh analysis');
		this.cache = await this.analyzer.analyzeWorkspace(workspacePath);
		this.lastAnalysisTime = currentTime;
		return this.cache;
	}

	invalidateCache() {
		this.cache = null;
		this.lastAnalysisTime = 0;
	}
}

let cacheManager: AnalysisCacheManager;

// Add storage manager
class StorageManager {
	private storage: vscode.Memento;
	private readonly STORAGE_KEY = 'goAnalyzerData';

	constructor(context: vscode.ExtensionContext) {
		this.storage = context.globalState;
	}

	async saveAnalysisData(data: GoAnalysisResult) {
		await this.storage.update(this.STORAGE_KEY, data);
		log('Analysis data saved to storage');
	}

	getAnalysisData(): GoAnalysisResult | undefined {
		return this.storage.get<GoAnalysisResult>(this.STORAGE_KEY);
	}

	async clear() {
		await this.storage.update(this.STORAGE_KEY, undefined);
	}
}

let storageManager: StorageManager;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	globalContext = context;
	log('Extension activated');

	const analyzer = new GoAnalyzerService(context);
	cacheManager = new AnalysisCacheManager(analyzer);
	storageManager = new StorageManager(context);

	// Initial workspace analysis
	async function analyzeWorkspaceAndStore() {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				return;
			}

			log('Starting initial workspace analysis');
			const result = await analyzer.analyzeWorkspace(workspaceFolders[0].uri.fsPath);
			await storageManager.saveAnalysisData(result);
			log('Initial analysis complete and stored');

			// Refresh decorations in all visible editors
			vscode.window.visibleTextEditors.forEach(editor => {
				if (editor.document.languageId === 'go') {
					decorateGoFile(editor);
				}
			});
		} catch (error) {
			log('Initial analysis failed:', error);
		}
	}

	// Trigger initial analysis when VS Code starts
	analyzeWorkspaceAndStore();

	// Register analyze command
	let analyzeCommand = vscode.commands.registerCommand('go-spot.analyzeGoFiles', async () => {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			log('Starting analysis of workspace: ' + workspaceFolders[0].uri.fsPath);
			const result = await analyzer.analyzeWorkspace(workspaceFolders[0].uri.fsPath);
			
			// Validate result
			if (!result) {
				log('Error: Analysis result is null');
				vscode.window.showErrorMessage('Analysis returned no results');
				return;
			}

			if (!result.interfaces || !result.structs) {
				log('Error: Invalid analysis result structure:', result);
				vscode.window.showErrorMessage('Invalid analysis result structure');
				return;
			}

			// Log the raw analysis results for debugging
			log('Raw analysis results:');
			log(JSON.stringify(result, null, 2));
			
			// Log the analysis results
			log(`Found ${result.interfaces.length} interfaces and ${result.structs.length} structs`);

			// Create and show the analysis results
			const panel = vscode.window.createWebviewPanel(
				'goAnalysis',
				'Go Analysis Results',
				vscode.ViewColumn.One,
				{
					enableScripts: true
				}
			);

			try {
				// Ensure arrays exist before mapping
				const safeResult = {
					interfaces: Array.isArray(result.interfaces) ? result.interfaces : [],
					structs: Array.isArray(result.structs) ? result.structs : []
				};

				const htmlContent = getWebviewContent(safeResult);
				log('Generated HTML content length: ' + htmlContent.length);
				panel.webview.html = htmlContent;
				log('Successfully set webview HTML content');
				vscode.window.showInformationMessage(`Analysis complete: Found ${safeResult.interfaces.length} interfaces and ${safeResult.structs.length} structs`);
			} catch (webviewError) {
				log('Error generating webview content', webviewError);
				// Show raw JSON in case of error
				panel.webview.html = `<html><body>
					<h1>Error Displaying Results</h1>
					<p>Raw analysis results:</p>
					<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
				</body></html>`;
				vscode.window.showErrorMessage('Error displaying analysis results');
			}
		} catch (error) {
			log('Analysis failed', error);
			if (error instanceof Error) {
				log('Error stack trace:', error.stack);
			}
			vscode.window.showErrorMessage('Failed to analyze Go files: ' + (error instanceof Error ? error.message : String(error)));
		}
	});

	// Register show struct info command
	let showStructCommand = vscode.commands.registerCommand('go-spot.showStructInfo', async () => {
		try {
			// Get all struct names
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			const result = await analyzer.analyzeWorkspace(workspaceFolders[0].uri.fsPath);
			const structNames = result.structs.map(s => ({
				label: s.name,
				description: `${s.position.path}:${s.position.line}`,
				detail: s.implementedInterfaces.map(i => i.name).join(', ') || 'No interfaces implemented'
			}));

			// Show quick pick with struct names
			const selected = await vscode.window.showQuickPick(structNames, {
				placeHolder: 'Select a struct to view details'
			});

			if (selected) {
				await analyzer.showStructInfo(selected.label);
			}
		} catch (error) {
			log('Error showing struct info:', error);
			vscode.window.showErrorMessage('Failed to show struct information');
		}
	});

	// Track the last click position to prevent double triggers
	let lastClickPosition: { line: number; character: number } | undefined;

	// Register navigation command
	let navigateCommand = vscode.commands.registerCommand('go-spot.navigateToTest', async () => {
		log('Navigation command triggered');
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			log('No workspace folders found');
			return;
		}

		const testFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, 'test.go');
		log(`Attempting to navigate to ${testFilePath.fsPath}`);
		
		try {
			const document = await vscode.workspace.openTextDocument(testFilePath);
			log('Test file opened successfully');
			
			const editor = await vscode.window.showTextDocument(document);
			log('Editor shown for test file');
			
			const position = new vscode.Position(5, 0); // Line 6 (0-based index)
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position));
			log('Successfully navigated to line 6');
		} catch (error) {
			log('Failed to navigate to test.go:6', error);
			vscode.window.showErrorMessage('Could not navigate to test.go:6');
		}
	});

	// Function to handle mouse clicks
	const handleMouseClick = (e: vscode.TextEditorSelectionChangeEvent) => {
		try {
			const position = e.selections[0].active;
			const editor = e.textEditor;
			
			// Ignore if this is not a .go file
			if (!editor.document.fileName.endsWith('.go')) {
				return;
			}

			log(`Click detected at line ${position.line}, character ${position.character}`);

			// Check if this is a new click at the same position
			if (lastClickPosition && 
				lastClickPosition.line === position.line && 
				lastClickPosition.character === position.character) {
				log('Ignoring duplicate click');
				return;
			}

			const line = editor.document.lineAt(position.line);
			const buttonStart = line.text.length;
			const buttonEnd = buttonStart + 25; // Increased width to cover entire button text

			log(`Button area: start=${buttonStart}, end=${buttonEnd}, clicked at=${position.character}`);

			// Only trigger if click is in the button area of the first line
			if (position.line === 0 && 
				position.character >= buttonStart && 
				position.character <= buttonEnd) {
				log('Valid button click detected, triggering navigation');
				lastClickPosition = { line: position.line, character: position.character };
				vscode.commands.executeCommand('go-spot.navigateToTest');
			}
		} catch (error) {
			log('Error in click handler', error);
		}
	};

	// Modify decorateStructDeclarations to use stored data
	async function decorateStructDeclarations(editor: vscode.TextEditor) {
		try {
			const document = editor.document;
			if (document.languageId !== 'go') {
				return;
			}

			// Get stored analysis data
			const analysisData = storageManager.getAnalysisData();
			if (!analysisData) {
				log('No stored analysis data found');
				return;
			}

			// Rest of the decoration logic remains the same
			const text = document.getText();
			const structRegex = /type\s+(\w+)(?:\[[\w\s,]+\])?\s+struct\s*{/g;
			let match;
			const decorations: vscode.DecorationOptions[] = [];

			while ((match = structRegex.exec(text)) !== null) {
				const structName = match[1];
				const pos = document.positionAt(match.index);
				const line = pos.line;
				const lineText = document.lineAt(line).text;

				const struct = analysisData.structs.find(s => {
					const baseStructName = s.name.split('[')[0];
					return baseStructName === structName;
				});

				if (struct && struct.implementedInterfaces.length > 0) {
					const uniqueInterfaces = Array.from(new Set(
						struct.implementedInterfaces.map(i => {
							const baseName = i.name.split('[')[0];
							return baseName;
						})
					)).sort();

					const interfaceNames = uniqueInterfaces.join(', ');
					
					const decoration: vscode.DecorationOptions = {
						range: new vscode.Range(line, lineText.length, line, lineText.length),
						renderOptions: {
							after: {
								contentText: `    // implements: ${interfaceNames}`,
								color: new vscode.ThemeColor('editorLineNumber.foreground'),
								fontStyle: 'italic'
							}
						}
					};
					decorations.push(decoration);
				}
			}

			const decorationType = vscode.window.createTextEditorDecorationType({});
			editor.setDecorations(decorationType, decorations);
		} catch (error) {
			log('Error decorating struct declarations:', error);
		}
	}

	// Function to decorate Go files
	async function decorateGoFile(editor: vscode.TextEditor) {
		if (editor.document.languageId === 'go') {
			await decorateStructDeclarations(editor);
		}
	}

	// Register event handlers
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && editor.document.languageId === 'go') {
				decorateGoFile(editor);
			}
		}),
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId === 'go' && vscode.window.activeTextEditor) {
				decorateGoFile(vscode.window.activeTextEditor);
			}
		}),
		vscode.window.onDidChangeTextEditorSelection(handleMouseClick),
		analyzeCommand,
		showStructCommand
	);

	// Initial decoration for active editor
	if (vscode.window.activeTextEditor) {
		decorateGoFile(vscode.window.activeTextEditor);
	}

	// Watch for new Go files
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.go');
	watcher.onDidCreate(async (uri) => {
		log(`New Go file created: ${uri.fsPath}`);
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(doc);
			await decorateGoFile(editor);
			log('Successfully decorated new file');
		} catch (error: any) {
			log('Error processing new Go file', error);
		}
	});
	context.subscriptions.push(watcher);

	log('Extension setup completed');
}

function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function getWebviewContent(result: GoAnalysisResult): string {
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
			</style>
		</head>
		<body>
			<h1>Go Analysis Results</h1>
			
			<div class="section">
				<h2>Interfaces (${result.interfaces.length})</h2>
				${result.interfaces.map(iface => `
					<div class="item">
						<h3>${escapeHtml(iface.name)}</h3>
						<p>File: ${escapeHtml(iface.position.path)}:${iface.position.line}</p>
						<div class="methods">
							${iface.methods.map(method => `
								<div class="method">
									<code>${escapeHtml(method.name)}(${method.parameters.map(p => 
										`${escapeHtml(p.name)}: ${escapeHtml(p.type)}`
									).join(', ')})${method.returnTypes.length ? ' -> ' + method.returnTypes.map(t => escapeHtml(t)).join(', ') : ''}</code>
								</div>
							`).join('')}
						</div>
					</div>
				`).join('')}
			</div>

			<div class="section">
				<h2>Structs (${result.structs.length})</h2>
				${result.structs.map(struct => `
					<div class="item">
						<h3>${escapeHtml(struct.name)}</h3>
						<p>File: ${escapeHtml(struct.position.path)}:${struct.position.line}</p>
						${struct.embeddedTypes.length ? `
							<div class="embedded">
								<h4>Embedded Types:</h4>
								<ul>
									${struct.embeddedTypes.map(type => `<li>${escapeHtml(type)}</li>`).join('')}
								</ul>
							</div>
						` : ''}
						<div class="methods">
							${struct.methods.map(method => `
								<div class="method">
									<code>${escapeHtml(method.name)}(${method.parameters.map(p => 
										`${escapeHtml(p.name)}: ${escapeHtml(p.type)}`
									).join(', ')})${method.returnTypes.length ? ' -> ' + method.returnTypes.map(t => escapeHtml(t)).join(', ') : ''}</code>
								</div>
							`).join('')}
						</div>
					</div>
				`).join('')}
			</div>
		</body>
	</html>`;
}

// This method is called when your extension is deactivated
export function deactivate() {
	log('Extension deactivating');
	// Clean up decorations
	firstRowDecoration.dispose();
	outputChannel.dispose();
	log('Cleanup completed');
}

export async function getData(workspacePath: string): Promise<{
	structs: Array<{
		name: string;
		declarationPath: string;
		implementingInterfaces: Array<{
			name: string;
			declarationPath: string;
		}>;
		methods: Array<{
			name: string;
			declarationPath: string;
			implementingInterfaces: Array<{
				interfaceName: string;
				methodName: string;
				declarationPath: string;
			}>;
			parameters: ParamInfo[];
			returnTypes: string[];
		}>;
	}>;
}> {
	const result = await cacheManager.getAnalysisData(workspacePath);

	return {
		structs: result.structs.map(struct => ({
			name: struct.name,
			declarationPath: `${struct.position.path}:${struct.position.line}`,
			implementingInterfaces: struct.implementedInterfaces.map(iface => ({
				name: iface.name,
				declarationPath: `${iface.position.path}:${iface.position.line}`
			})),
			methods: struct.methods.map(method => ({
				name: method.name,
				declarationPath: `${method.position.path}:${method.position.line}`,
				implementingInterfaces: method.implementedFrom.map(impl => {
					const [interfaceName, methodName] = impl.name.split('.');
					return {
						interfaceName,
						methodName,
						declarationPath: `${impl.position.path}:${impl.position.line}`
					};
				}),
				parameters: method.parameters,
				returnTypes: method.returnTypes
			}))
		}))
	};
}
