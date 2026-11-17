export type Language =
  | "rust"
  | "typescript"
  | "javascript"
  | "python"
  | "cpp"
  | "csharp"
  | "config";

export type ProjectKind = "application" | "library" | "test";

export interface CraiddProject {
  id: string;
  name: string;
  language: Language | null;      // null = config-only
  root: string;                   // relative to the .craidd's own folder
  kind: ProjectKind;
  path: string;                   // path to the .craidd, relative to solution root (or absolute)
  folder: string;                 // folder relative to solution root (or absolute), for display

  configEnabled: boolean;
  configName?: string;
  configDirectory?: string;
  mainInclude?: string[];
  mainExclude?: string[];
  configInclude?: string[];
  configExclude?: string[];

  // Runtime-only
  missing?: boolean;              // true when .craidd file is not on disk
  external?: boolean;             // true when path escapes the solution root
  tree?: FileNode | null;
  treeError?: string | null;
  treeBasePath?: string;
  configTree?: FileNode | null;
  configTreeError?: string | null;
  configBasePath?: string;

  // Runtime-only: manifests read from the project's resolved folder.
  // Session-only. Never written to disk.
  manifests?: Manifest[];
}

export interface BuildEntry {
  target: string;                 // path to the .craidd
  method?: string;                // "cargo" | "npm" | "cmake" | "dotnet" | ...
  command?: string;
  cwd?: string;
}

export interface CraiddSolution {
  name: string;
  root: string;                   // absolute path to the solution root
  projects: CraiddProject[];
  build: BuildEntry[];
  runDefault?: string;            // path to the .craidd
  debugDefault?: string;
  autostart: string[];
  defaultProject?: string;
  /** Legacy field. Preserved for old .cln files. Not written. */
  defaultBuild?: "debug" | "release";

  /** Named Configurations declared in .cln under [[config]]. */
  configs: ConfigEntry[];
  /** Name of the default Configuration. */
  defaultConfig?: string;
  /** Session-only inferred entries. Never written to .cln. */
  inferredConfigs: ConfigEntry[];
}

export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: FileNode[];
}

export type DiskState = "inSync" | "deleted" | "newer";

export interface FileEditorTab {
  kind: "file";
  id: string;
  fileId: string;
  name: string;
  language: Language | "plaintext";
  monacoLanguage: string;
  content: string;
  originalContent: string;
  dirty: boolean;
  diskState: DiskState;
  mtimeAtLastSync: number;
  /** Set for a navigation target outside every project (decision 50): never edited, saved, dirty or disk-checked. */
  readOnly?: boolean;
}

export interface ProfilerEditorTab {
  kind: "profiler";
  id: typeof PROFILER_TAB_ID;
  name: "Profiling";
}

export const PROFILER_TAB_ID = "workspace:profiler";
export type EditorTab = FileEditorTab | ProfilerEditorTab;
export const isFileTab = (tab: EditorTab): tab is FileEditorTab => tab.kind === "file";
export function findFileTab(tabs: EditorTab[], fileId: string | null | undefined): FileEditorTab | undefined {
  return tabs.find((tab): tab is FileEditorTab => tab.kind === "file" && tab.fileId === fileId);
}

export interface Manifest {
  kind: "cargo" | "npm" | "dotnet" | "cmake";
  path: string;      // absolute path to the manifest file
  folder: string;    // absolute path to the folder containing it
  values: Record<string, unknown>;
}

export type ConfigKind = "run" | "build" | "debug" | "test";
export type ConfigOrigin = "user" | "inferred";

export interface ConfigEntry {
  embeddedMonoJitMap?: boolean;
  name: string;
  kind: ConfigKind;
  target: string;              // path to the target .craidd, "." for whole solution
  /** Inference-only solution suggestion. The target still identifies the project used by Play. */
  bestFit?: boolean;
  /** Project markers whose manifests established this suggestion. */
  relatedProjects?: string[];
  /** Explicit action references for a saved solution composition. */
  slots?: { build?: string; run?: string; debug?: string };
  method?: string;             // "cargo" | "npm" | "dotnet" | "cmake" | "shell" | "composed" | "python"
  command?: string;            // literal command; overrides method+manifest
  cwd?: string;                // relative to solution root
  origin: ConfigOrigin;
  profiles?: Profile[];
  defaultProfile?: string;
  linked?: LinkedLaunch;
  order?: BuildOrder;
}

export type OrderStep = { kind: "build"; configuration: string }
  | { kind: "install"; configuration: string; destination: string };
export interface BuildOrder { before?: string; steps: OrderStep[] }
export interface OrderRequest { solutionPath: string; configuration: string; profile?: string }

export interface LinkedLaunch {
  after?: string[];
  priority: number;
  readyUrl?: string;
  timeoutMs: number;
}

export interface Profile {
  name: string;
  args: string[];
  env: Record<string, string>;
  description?: string;
}
