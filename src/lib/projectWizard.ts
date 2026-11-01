import catalog from "./projectTemplates.json";

export type WizardLanguage = "rust" | "csharp" | "cpp";
export interface ProjectTemplate {
  id: string;
  language: string;
  name: string;
  category: string;
  description: string;
  available: boolean;
  tools: string[];
}
export const projectTemplates: ProjectTemplate[] = catalog;
export const wizardLanguages: { id: WizardLanguage; name: string; detail: string }[] = [
  { id: "rust", name: "Rust", detail: "Cargo & desktop" },
  { id: "csharp", name: "C#", detail: ".NET & web APIs" },
  { id: "cpp", name: "C++", detail: "Native & CMake" },
];

export function filterProjectTemplates(language: WizardLanguage, query: string): ProjectTemplate[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return projectTemplates.filter((template) => template.language === language && words.every((word) =>
    `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(word)));
}

export function projectNameError(name: string): string | null {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? null : "Use 1–64 letters, digits, hyphens, or underscores, starting with a letter.";
}

export interface ProjectCreationRequest {
  templateId: string;
  name: string;
  parent: string;
  setupConfigs: boolean;
  dotnetFramework: string;
  solutionPath: string | null;
}
export interface ProjectCreationPlan {
  destination: string;
  solutionPath: string;
  solutionContent: string;
  files: { path: string; content: string; encoding?: "hex" }[];
  configurations: { name: string; kind: string; command: string }[];
  requirements: { name: string; path: string | null }[];
  notes: string[];
  nextSteps: string[];
  token: string;
}
export interface ProjectCreationResult {
  solutionPath: string;
  destination: string;
  log: string[];
}
