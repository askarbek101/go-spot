export interface Position {
    path: string;
    line: number;
}

export interface Declaration {
    name: string;
    position: Position;
}

export interface ParamInfo {
    name: string;
    type: string;
}

export interface InterfaceMethodInfo {
    name: string;
    position: Position;
    parameters: ParamInfo[];
    returnTypes: string[];
}

export interface MethodInfo {
    name: string;
    position: Position;
    parameters: ParamInfo[];
    returnTypes: string[];
    implementedFrom: Declaration[];
}

export interface InterfaceInfo {
    name: string;
    position: Position;
    methods: InterfaceMethodInfo[];
}

export interface StructInfo {
    name: string;
    position: Position;
    methods: MethodInfo[];
    embeddedTypes: string[];
    implementedInterfaces: Declaration[];
}

export interface GoAnalysisResult {
    interfaces: InterfaceInfo[];
    structs: StructInfo[];
} 