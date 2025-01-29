// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

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

// List of interface files
const interfaceFiles = [
	'interface1.go',
	'interface2.go',
	'interface3.go'
];

// Create decoration type for highlighting
const firstRowDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(100, 100, 100, 0.3)',
	isWholeLine: true
});

// Create interface list decoration
const interfaceListDecoration = vscode.window.createTextEditorDecorationType({
	after: {
		contentText: `[ ${interfaceFiles.join(', ')} ]`,
		color: 'rgb(100, 149, 237)',
		margin: '0 5px',
		fontStyle: 'italic'
	}
});

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	log('Extension activated');

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

	// Function to decorate Go files
	async function decorateGoFile(editor: vscode.TextEditor) {
		try {
			if (!editor.document.fileName.endsWith('.go')) {
				return;
			}

			log(`Decorating file: ${editor.document.fileName}`);

			if (editor.document.lineCount > 0) {
				const line = editor.document.lineAt(0);
				const range = new vscode.Range(0, 0, 0, line.text.length);

				log(`First line content: "${line.text}"`);

				// Only add decorations if the line contains "package main"
				if (line.text.includes('package main')) {
					// Add main line decoration
					editor.setDecorations(firstRowDecoration, [range]);
					log('Added main line decoration');

					// Add interface list after package main
					editor.setDecorations(interfaceListDecoration, [{
						range: new vscode.Range(
							new vscode.Position(0, line.text.length),
							new vscode.Position(0, line.text.length)
						)
					}]);
					log('Added interface list decoration');
				}
			}
		} catch (error) {
			log('Error in decorateGoFile', error);
		}
	}

	// Register event handlers
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			log('Active editor changed');
			if (editor) {
				decorateGoFile(editor);
			}
		}),
		vscode.workspace.onDidOpenTextDocument(doc => {
			log('Document opened');
			if (vscode.window.activeTextEditor && doc === vscode.window.activeTextEditor.document) {
				decorateGoFile(vscode.window.activeTextEditor);
			}
		}),
		vscode.window.onDidChangeTextEditorSelection(handleMouseClick)
	);

	// Initial decoration for active editor
	if (vscode.window.activeTextEditor) {
		log('Decorating initial active editor');
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

// This method is called when your extension is deactivated
export function deactivate() {
	log('Extension deactivating');
	// Clean up decorations
	firstRowDecoration.dispose();
	interfaceListDecoration.dispose();
	outputChannel.dispose();
	log('Cleanup completed');
}
