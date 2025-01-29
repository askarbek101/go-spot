package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/types"
	"log"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"
)

type Position struct {
	Path string `json:"path"`
	Line int    `json:"line"`
}

type Declaration struct {
	Name     string   `json:"name"`
	Position Position `json:"position"`
}

type ParamInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type MethodInfo struct {
	Name            string        `json:"name"`
	Position        Position      `json:"position"`
	Parameters      []ParamInfo   `json:"parameters"`
	ReturnTypes     []string      `json:"returnTypes"`
	ImplementedFrom []Declaration `json:"implementedFrom"`
}

type InterfaceInfo struct {
	Name     string       `json:"name"`
	Position Position     `json:"position"`
	Methods  []MethodInfo `json:"methods"`
}

type StructInfo struct {
	Name                  string        `json:"name"`
	Position              Position      `json:"position"`
	Methods               []MethodInfo  `json:"methods"`
	EmbeddedTypes         []string      `json:"embeddedTypes"`
	ImplementedInterfaces []Declaration `json:"implementedInterfaces"`
}

type AnalysisResult struct {
	Interfaces []InterfaceInfo `json:"interfaces"`
	Structs    []StructInfo    `json:"structs"`
}

func main() {
	rootPath := flag.String("path", ".", "Root path to analyze")
	flag.Parse()

	absPath, err := filepath.Abs(*rootPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting absolute path: %v\n", err)
		os.Exit(1)
	}

	result := analyze(absPath)
	jsonResult, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(string(jsonResult))
}

func analyze(rootPath string) AnalysisResult {
	var result AnalysisResult
	result.Interfaces = make([]InterfaceInfo, 0)
	result.Structs = make([]StructInfo, 0)

	// Configure package loading
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles |
			packages.NeedImports | packages.NeedTypes | packages.NeedTypesInfo |
			packages.NeedSyntax,
		Dir: rootPath,
	}

	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		log.Printf("Error loading packages: %v", err)
		return result
	}

	// Process each package
	for _, pkg := range pkgs {
		if len(pkg.Errors) > 0 {
			for _, err := range pkg.Errors {
				log.Printf("Error in package %s: %v", pkg.PkgPath, err)
			}
			continue
		}

		scope := pkg.Types.Scope()
		for _, name := range scope.Names() {
			obj := scope.Lookup(name)
			if obj == nil {
				continue
			}

			switch t := obj.Type().Underlying().(type) {
			case *types.Interface:
				if t.NumMethods() > 0 {
					iface := processInterface(obj, pkg)
					if iface != nil {
						result.Interfaces = append(result.Interfaces, *iface)
					}
				}
			case *types.Struct:
				strct := processStruct(obj, pkg, result.Interfaces)
				if strct != nil {
					result.Structs = append(result.Structs, *strct)
				}
			}
		}
	}

	return result
}

func processInterface(obj types.Object, pkg *packages.Package) *InterfaceInfo {
	iface, ok := obj.Type().Underlying().(*types.Interface)
	if !ok {
		return nil
	}

	pos := pkg.Fset.Position(obj.Pos())
	info := &InterfaceInfo{
		Name: obj.Name(),
		Position: Position{
			Path: makeRelativePath(pos.Filename),
			Line: pos.Line,
		},
		Methods: make([]MethodInfo, 0),
	}

	for i := 0; i < iface.NumMethods(); i++ {
		method := iface.Method(i)
		methodPos := pkg.Fset.Position(method.Pos())
		signature := method.Type().(*types.Signature)

		methodInfo := MethodInfo{
			Name: method.Name(),
			Position: Position{
				Path: makeRelativePath(methodPos.Filename),
				Line: methodPos.Line,
			},
			Parameters:      extractParams(signature),
			ReturnTypes:     extractReturnTypes(signature),
			ImplementedFrom: make([]Declaration, 0),
		}
		info.Methods = append(info.Methods, methodInfo)
	}

	return info
}

func processStruct(obj types.Object, pkg *packages.Package, allInterfaces []InterfaceInfo) *StructInfo {
	named, ok := obj.Type().(*types.Named)
	if !ok {
		return nil
	}

	strct, ok := named.Underlying().(*types.Struct)
	if !ok {
		return nil
	}

	pos := pkg.Fset.Position(obj.Pos())
	info := &StructInfo{
		Name: obj.Name(),
		Position: Position{
			Path: makeRelativePath(pos.Filename),
			Line: pos.Line,
		},
		Methods:               make([]MethodInfo, 0),
		EmbeddedTypes:         make([]string, 0),
		ImplementedInterfaces: make([]Declaration, 0),
	}

	// Get embedded types
	for i := 0; i < strct.NumFields(); i++ {
		field := strct.Field(i)
		if field.Anonymous() {
			info.EmbeddedTypes = append(info.EmbeddedTypes, types.TypeString(field.Type(), nil))
		}
	}

	// Get methods from both value and pointer receivers
	methodSet := types.NewMethodSet(named)
	ptrMethodSet := types.NewMethodSet(types.NewPointer(named))

	// Helper function to process method sets
	processMethodSet := func(ms *types.MethodSet) {
		for i := 0; i < ms.Len(); i++ {
			sel := ms.At(i)
			method := sel.Obj().(*types.Func)
			methodPos := pkg.Fset.Position(method.Pos())
			signature := method.Type().(*types.Signature)

			// Skip if method already exists
			methodExists := false
			for _, existingMethod := range info.Methods {
				if existingMethod.Name == method.Name() {
					methodExists = true
					break
				}
			}
			if methodExists {
				continue
			}

			methodInfo := MethodInfo{
				Name: method.Name(),
				Position: Position{
					Path: makeRelativePath(methodPos.Filename),
					Line: methodPos.Line,
				},
				Parameters:      extractParams(signature),
				ReturnTypes:     extractReturnTypes(signature),
				ImplementedFrom: make([]Declaration, 0),
			}
			info.Methods = append(info.Methods, methodInfo)
		}
	}

	// Process both value and pointer receiver methods
	processMethodSet(methodSet)
	processMethodSet(ptrMethodSet)

	// Check interface implementations
	ptrType := types.NewPointer(named)
	for _, iface := range allInterfaces {
		ifaceObj := pkg.Types.Scope().Lookup(iface.Name)
		if ifaceObj == nil {
			continue
		}

		ifaceType, ok := ifaceObj.Type().Underlying().(*types.Interface)
		if !ok {
			continue
		}

		// Check both pointer and value receivers
		if types.Implements(named, ifaceType) || types.Implements(ptrType, ifaceType) {
			info.ImplementedInterfaces = append(info.ImplementedInterfaces, Declaration{
				Name:     iface.Name,
				Position: iface.Position,
			})

			// Update method implementation info
			for i := range info.Methods {
				method := &info.Methods[i]
				for _, ifaceMethod := range iface.Methods {
					if method.Name == ifaceMethod.Name {
						method.ImplementedFrom = append(method.ImplementedFrom, Declaration{
							Name:     iface.Name + "." + ifaceMethod.Name,
							Position: ifaceMethod.Position,
						})
					}
				}
			}
		}
	}

	return info
}

func extractParams(signature *types.Signature) []ParamInfo {
	params := make([]ParamInfo, 0)
	for i := 0; i < signature.Params().Len(); i++ {
		param := signature.Params().At(i)
		params = append(params, ParamInfo{
			Name: param.Name(),
			Type: types.TypeString(param.Type(), nil),
		})
	}
	return params
}

func extractReturnTypes(signature *types.Signature) []string {
	results := make([]string, 0)
	for i := 0; i < signature.Results().Len(); i++ {
		result := signature.Results().At(i)
		results = append(results, types.TypeString(result.Type(), nil))
	}
	return results
}

func makeRelativePath(path string) string {
	// Convert Windows paths to forward slashes
	path = filepath.ToSlash(path)
	// Get the last two components of the path (e.g., "internal/repositories/file.go")
	parts := strings.Split(path, "/")
	if len(parts) > 2 {
		return strings.Join(parts[len(parts)-3:], "/")
	}
	return path
}
