# Go Spot - VS Code Extension

A powerful VS Code extension for analyzing and understanding Go codebases by visualizing relationships between interfaces and structs.

## Features

- **Real-time Code Analysis**: Automatically analyzes your Go codebase to identify interfaces, structs, and their relationships.
- **Interface Implementation Detection**: Automatically detects and displays which structs implement which interfaces.
- **Interactive Visualization**: Provides a web view interface to explore the relationships between your Go types.
- **Code Decoration**: Adds inline decorations to struct declarations showing which interfaces they implement.
- **Quick Navigation**: Includes commands for quick navigation between related code elements.
- **Caching System**: Implements an efficient caching system to improve performance during analysis.

## Commands

The extension provides several commands that can be accessed through the VS Code command palette:

- `go-spot.analyzeGoFiles`: Analyzes all Go files in the workspace and displays results in a webview panel.
- `go-spot.showStructInfo`: Shows detailed information about a selected struct.
- `go-spot.navigateToTest`: Navigates to related test files.

## Features in Detail

### Code Analysis
- Detects all interfaces and structs in your Go codebase
- Identifies method signatures and parameters
- Maps relationships between interfaces and their implementing structs
- Tracks embedded types in structs

### Visual Feedback
- Inline annotations showing interface implementations
- Detailed webview panel showing:
  - List of all interfaces with their methods
  - List of all structs with their methods
  - Implementation relationships
  - File locations and line numbers

### Performance
- Implements caching to avoid unnecessary re-analysis
- Cache invalidation after 5 seconds
- Global state management for persistent data storage

## Installation

1. Open VS Code
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Go Spot"
4. Click Install

## Requirements

- Visual Studio Code version 1.60.0 or higher
- Go programming language installed on your system

## Usage

1. Open a Go project in VS Code
2. The extension will automatically analyze your code on startup
3. Use the command palette (Ctrl+Shift+P) to access Go Spot commands
4. Click on struct declarations to see interface implementations
5. Use the webview panel to explore your codebase structure

## Extension Settings

This extension contributes the following settings:

- `go-spot.enable`: Enable/disable the extension
- `go-spot.decorations`: Enable/disable inline decorations

## Known Issues

- Large codebases might experience slight delay during initial analysis
- Cache invalidation might cause brief analysis delays

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Release Notes

### 1.0.0
- Initial release
- Basic interface and struct analysis
- Webview visualization
- Code decorations
- Navigation features

---

**Enjoy using Go Spot!**
