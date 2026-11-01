import { useEffect, useRef, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild } from "../../store/buildStore";
import { appendOutput } from "../../lib/outputPresentation";
import { filterProjectTemplates, projectNameError, projectTemplates, wizardLanguages,
  type WizardLanguage, type ProjectCreationPlan, type ProjectCreationRequest, type ProjectCreationResult } from "../../lib/projectWizard";
import "./projectWizard.css";

interface Props {
  onClose: (opts?: { fineTuneAfter?: boolean; projectName?: string }) => void;
  standalone?: boolean;
  onCreated?: () => void;
}

function TechnologyLogo({ name, className = "" }: { name: string; className?: string }) {
  return <img src={name === "tauri" ? "/tauri.svg" : `/language-icons/${name}.svg`} alt="" aria-hidden="true"
    draggable={false} className={`pw-logo pw-logo-${name} ${name === "rust" ? "pw-logo-monochrome" : ""} ${className}`} />;
}

function templateLogo(id: string, language: string) {
  return id.includes("tauri") ? "tauri" : id === "csharp-webapi" || id === "csharp-blade" ? "dotnet" : language;
}

export default function NewProjectDialog({ onClose, standalone = false, onCreated }: Props) {
  const rootPath = useSolution((s) => s.rootPath);
  const clnPath = useSolution((s) => s.clnPath);
  const [language, setLanguage] = useState<WizardLanguage>("rust");
  const [templateId, setTemplateId] = useState("rust-console");
  const [query, setQuery] = useState("");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("MyApp");
  const [parent, setParent] = useState(standalone ? "" : rootPath ?? "");
  const [addToSolution, setAddToSolution] = useState(!standalone && !!clnPath);
  const [setupConfigs, setSetupConfigs] = useState(true);
  const [framework, setFramework] = useState("net10.0");
  const [fineTuneAfter, setFineTuneAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ProjectCreationPlan | null>(null);
  const [created, setCreated] = useState<ProjectCreationResult | null>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };

  const template = projectTemplates.find((item) => item.id === templateId)!;
  const templates = filterProjectTemplates(language, query);
  const empty = templateId.endsWith("-empty");
  const destination = `${parent.replace(/\/+$/, "")}/${name}`;
  const nameError = projectNameError(name);
  const request: ProjectCreationRequest = { templateId, name, parent, setupConfigs: setupConfigs && !empty,
    dotnetFramework: framework, solutionPath: addToSolution ? clnPath : null };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!latest.current.busy) latest.current.onClose(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex='0']") ?? []).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("keydown", keyboard, true); previous?.focus(); };
  }, []);
  useEffect(() => { heading.current?.focus(); if (body.current) body.current.scrollTop = 0; }, [step]);
  useEffect(() => { if (results.current) results.current.scrollTop = 0; }, [language, query]);

  const chooseLanguage = (next: WizardLanguage) => {
    setLanguage(next); setQuery(""); setTemplateId(`${next}-console`); setError(null);
  };

  const searchTemplates = (value: string) => {
    setQuery(value);
    const matches = filterProjectTemplates(language, value);
    if (matches.length && !matches.some((item) => item.id === templateId)) setTemplateId(matches[0].id);
  };

  const browse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose a parent location", defaultPath: parent || undefined });
      if (typeof selected === "string") setParent(selected);
    } catch (cause) { setError(String(cause)); }
  };

  const review = async () => {
    setBusy(true); setError(null);
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error("Project creation is available in the Craidd desktop app. This browser preview shows the wizard interface only.");
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<ProjectCreationPlan>("preview_project_creation", { request });
      setPlan(result); setSelectedFile(result.files[0]?.path ?? ""); setStep(2);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const openCreated = async (result: ProjectCreationResult) => {
    const state = useSolution.getState();
    if (!standalone && state.rootPath && result.solutionPath !== state.clnPath) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_workspace_window", { entry: { path: result.solutionPath, name,
        kind: "solution", windowLabel: "" } });
    } else {
      const opened = await state.openSolution(result.solutionPath, { preserveTabs: !standalone });
      if (opened.status !== "loaded") throw new Error(opened.status === "error" ? opened.message : "Could not open the created solution.");
    }
    onCreated?.();
    onClose({ fineTuneAfter: fineTuneAfter && addToSolution, projectName: name });
  };

  const create = async () => {
    if (!plan) return;
    setBusy(true); setError(null);
    try {
      let result = created;
      if (!result) {
        const { invoke } = await import("@tauri-apps/api/core");
        result = await invoke<ProjectCreationResult>("create_project_from_template", { request, expectedToken: plan.token });
        setCreated(result);
        const log = result.log.join("\n");
        useBuild.setState((state) => ({ output: appendOutput(state.output, log) }));
      }
      await openCreated(result);
    } catch (cause) {
      setError(String(cause));
      useBuild.setState((state) => ({ output: appendOutput(state.output, `Project wizard: ${String(cause)}`) }));
    } finally { setBusy(false); }
  };

  const next = () => { setError(null); if (step === 0) setStep(1); else if (step === 1) void review(); else void create(); };
  const title = created ? "Your project is ready" : ["Create a project", "Make it yours", "Ready to create"][step];
  const reviewFiles: ProjectCreationPlan["files"] = plan ? [...plan.files, ...(addToSolution ? [{ path: plan.solutionPath, content: plan.solutionContent }] : [])] : [];
  const previewFile = reviewFiles.find((file) => file.path === selectedFile);

  return <div className="pw-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="project-wizard-title" aria-busy={busy} className="project-wizard">
      <header className="pw-header">
        <div><div className="pw-eyebrow">CRAIDD STUDIO <span>/</span> NEW PROJECT</div>
          <h1 ref={heading} tabIndex={-1} id="project-wizard-title">{title}</h1>
          <p>{step === 0 ? "Choose a language and a starting point for your next project." : step === 1 ? template.name : created ? "Files are saved. You can retry opening the solution." : "Review the files and configurations before writing anything."}</p></div>
        <button type="button" className="pw-close" aria-label="Close project wizard" onClick={() => onClose()} disabled={busy}>×</button>
      </header>

      <nav aria-label="Project creation progress" className="pw-steps">
        {["Template", "Configure", "Review & create"].map((label, index) => <span key={label} aria-current={step === index ? "step" : undefined} className={index === step ? "is-current" : index < step ? "is-complete" : ""}>
          <span className="pw-step-number">{index < step ? "✓" : index + 1}</span>{label}
        </span>)}
      </nav>

      <div ref={body} className="pw-body">
        {step === 0 && <div className="pw-browser">
          <aside className="pw-languages" aria-label="Project language">
            <div className="pw-section-label">LANGUAGE</div>
            {wizardLanguages.map((item) => <button key={item.id} type="button" aria-pressed={language === item.id} onClick={() => chooseLanguage(item.id)} className={language === item.id ? "is-selected" : ""}>
              <TechnologyLogo name={item.id} className="pw-language-logo" /><span><strong>{item.name}</strong><small>{item.detail}</small></span>
            </button>)}
            <p className="pw-language-note">Start small.<br />Add more languages as your solution grows.</p>
          </aside>

          <section className="pw-templates" aria-label="Project templates">
            <label className="pw-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search templates" placeholder="Search templates…" value={query} onChange={(event) => searchTemplates(event.target.value)} /></label>
            <div className="pw-template-count">{templates.length} templates <span>·</span> {templates.filter((item) => item.available).length} available now</div>
            <div ref={results} className="pw-template-results">
            {templates.length === 0 && <div className="pw-empty"><strong>No matching templates</strong><p>Try console, web, or native, or clear your search.</p><button type="button" className="pw-button pw-button-outline" onClick={() => searchTemplates("")}>Clear search</button></div>}
            {["Basic", "Frameworks", "Native / LDI"].map((category) => {
              const matches = templates.filter((item) => item.category === category);
              return matches.length > 0 && <div key={category} className="pw-template-group"><h2 className="pw-section-label">{category}</h2>
                {matches.map((item) => <button key={item.id} type="button" onClick={() => setTemplateId(item.id)} onDoubleClick={() => { if (item.available) setStep(1); }} aria-pressed={item.id === templateId} className={`pw-template-row ${item.id === templateId ? "is-selected" : ""} ${!item.available ? "is-planned" : ""}`}>
                  <TechnologyLogo name={templateLogo(item.id, item.language)} className="pw-template-logo" />
                  <span className="pw-template-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
                  {!item.available && <span className="pw-badge">Planned</span>}
                  <span className="pw-selection-indicator" aria-hidden="true">{item.id === templateId ? "✓" : ""}</span>
                </button>)}
              </div>;
            })}
            </div>
          </section>

          <aside className="pw-details">
            {templates.length > 0 ? <>
            <div className="pw-detail-logos"><TechnologyLogo name={templateLogo(templateId, language)} className="pw-detail-logo" />
              {templateId.includes("tauri") && <TechnologyLogo name="react" className="pw-companion-logo" />}</div>
            <div className="pw-section-label">{template.category}</div><h2>{template.name}</h2><p>{template.description}</p>
            <div className="pw-detail-divider" />
            {template.available ? <><span className="pw-local-label">● Local scaffold</span><p>Creation works offline. Dependencies may need downloading when you build or run.</p>
              <h3>Tools for building</h3>{template.tools.length ? <ul>{template.tools.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No tools required to create this project.</p>}
              <p className="pw-detail-footnote">Installed tools are checked on the review screen. Craidd does not install toolchains.</p></> : <><span className="pw-badge">Planned template</span><p>This option is shown as a preview. Project generation is not implemented yet.</p></>}
            </> : <div className="pw-no-selection"><h2>Find your starting point</h2><p>Clear or adjust the search to see templates for {wizardLanguages.find((item) => item.id === language)?.name}.</p></div>}
          </aside>
        </div>}

        {step === 1 && <div className="pw-configure">
          <form id="project-wizard-form" className="pw-form" onSubmit={(event) => { event.preventDefault(); if (!busy && !nameError && parent.trim()) void review(); }}>
            <div className="pw-section-label">PROJECT DETAILS</div>
            <label className="pw-field"><span>Project name</span><input value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!!nameError} aria-describedby="pw-name-hint" disabled={busy} maxLength={64} required autoComplete="off" spellCheck={false} />
              <small id="pw-name-hint">{nameError ?? "Letters, digits, hyphens, and underscores."}</small></label>
            {!standalone && clnPath && <label className="pw-checkbox"><input type="checkbox" checked={addToSolution} disabled={busy} onChange={(event) => { setAddToSolution(event.target.checked); if (event.target.checked) setParent(rootPath ?? ""); }} /><span>Add to the current solution<small>Keep its projects and configurations.</small></span></label>}
            <div className="pw-field"><label htmlFor="pw-parent">Parent location</label><div className="pw-location"><input id="pw-parent" value={parent} onChange={(event) => setParent(event.target.value)} placeholder="Choose a folder…" disabled={busy || addToSolution} autoComplete="off" spellCheck={false} aria-describedby="pw-parent-hint" required /><button type="button" onClick={() => void browse()} disabled={busy || addToSolution}>Browse…</button></div><small id="pw-parent-hint">The parent can contain files. Your new project folder must be new or empty.</small></div>
            {!empty && language === "csharp" && <label className="pw-field"><span>Target framework</span><select value={framework} onChange={(event) => setFramework(event.target.value)} disabled={busy}><option value="net10.0">.NET 10</option><option value="net9.0">.NET 9</option><option value="net8.0">.NET 8</option></select><small>Choose a framework supported by your installed SDK.</small></label>}
            {!empty && <label className="pw-checkbox"><input type="checkbox" checked={setupConfigs} onChange={(event) => setSetupConfigs(event.target.checked)} disabled={busy} /><span>Set up build, run, and debug configurations<small>Editable Power configurations, saved in your solution.</small></span></label>}
            {addToSolution && <details className="pw-advanced"><summary>Advanced options</summary><label className="pw-checkbox"><input type="checkbox" checked={fineTuneAfter} onChange={(event) => setFineTuneAfter(event.target.checked)} disabled={busy} /><span>Open Fine Tune after creation</span></label></details>}
          </form>
          <aside className="pw-config-summary"><TechnologyLogo name={templateLogo(templateId, language)} className="pw-summary-logo" /><div className="pw-section-label">YOUR STARTING POINT</div><h2>{template.name}</h2><p>{template.description}</p><div className="pw-detail-divider" /><h3>Destination</h3><code>{parent && !nameError ? destination : "Choose a valid project name and location"}</code><h3>Solution</h3><code>{addToSolution ? clnPath : nameError ? "New solution" : `${name}.cln (new)`}</code><p className="pw-detail-footnote">{empty ? "Only project and solution metadata will be created. No Power configurations." : "No compiler, package manager, or installer runs during creation."}</p></aside>
        </div>}

        {step === 2 && plan && <div className="pw-review">
          <div className="pw-review-main"><div className="pw-review-destination"><span className="pw-local-label">● {created ? "Created" : "Local scaffold"}</span><code>{plan.destination}</code></div>
            <h2 className="pw-section-label">{plan.files.length} FILES TO CREATE{addToSolution ? " · 1 SOLUTION UPDATE" : ""}</h2>
            <div className="pw-file-browser"><div className="pw-file-list" aria-label="Generated files">{reviewFiles.map((file) => <button key={file.path} aria-pressed={selectedFile === file.path} onClick={() => setSelectedFile(file.path)}>{file.path === plan.solutionPath ? "Solution update · " : ""}{file.path}</button>)}</div><div className="pw-file-preview"><div>{previewFile?.path}</div><pre tabIndex={0}>{previewFile?.encoding === "hex" ? `Binary PNG asset (${previewFile.content.length / 2} bytes)` : previewFile?.content}</pre></div></div>
            {addToSolution && <p className="pw-metadata-note">Also updates <code>{plan.solutionPath}</code> with the new projects and configurations.</p>}
            <h2 className="pw-section-label">CONFIGURATIONS</h2>
            {plan.configurations.length ? <div className="pw-config-list">{plan.configurations.map((cfg) => <div key={cfg.name}><span>{cfg.name}</span><code>{cfg.command}</code></div>)}</div> : <p className="pw-metadata-note">No saved Power configurations. Manifest-based suggestions can still appear for executable projects.</p>}
          </div>
          <aside className="pw-review-aside"><h2 className="pw-section-label">BUILD REQUIREMENTS</h2>{plan.requirements.length === 0 && <p>No tools required.</p>}
            {plan.requirements.map((item) => <div className="pw-requirement" key={item.name}><span>{item.path ? "✓" : "○"}</span><div><strong>{item.name}</strong><small>{item.path ?? "Not found on PATH. You can still create the project."}</small></div></div>)}
            <div className="pw-detail-divider" />
            {plan.notes.map((note) => <p key={note}>{note}</p>)}
            {plan.nextSteps.length > 0 && <><h3>After creation</h3><p>From the new project folder:</p><pre>{plan.nextSteps.join("\n")}</pre></>}
          </aside>
        </div>}
      </div>

      {error && <div role="alert" className="pw-error">{created && <strong>Project created, but opening failed. </strong>}{error}</div>}
      <footer className="pw-footer"><div aria-live="polite">{busy ? step === 1 ? "Checking destination and preparing preview…" : "Creating files and opening solution…" : step === 0 ? !templates.length ? "Adjust your search to choose a template." : template.available ? "Select a template to continue." : "Planned · not available for creation" : created ? "Your files are saved." : "Nothing is written until you choose Create project."}</div>
        <div className="pw-footer-actions"><button type="button" className="pw-button" onClick={() => onClose()} disabled={busy}>Cancel</button>
          {step > 0 && !created && <button type="button" className="pw-button pw-button-outline" onClick={() => { setStep(step - 1); setError(null); setPlan(null); }} disabled={busy}>Back</button>}
          <button type={step === 1 ? "submit" : "button"} form={step === 1 ? "project-wizard-form" : undefined} className="pw-button pw-button-primary" onClick={step === 1 ? undefined : next} disabled={busy || !template.available || (step === 0 && !templates.length) || (step === 1 && (!!nameError || !parent.trim()))}>
            {busy ? "Working…" : created ? "Open project" : step === 2 ? "Create project" : step === 1 ? "Review project" : "Next"}<span aria-hidden="true">{step === 2 ? "+" : "→"}</span>
          </button></div>
      </footer>
    </div>
  </div>;
}
