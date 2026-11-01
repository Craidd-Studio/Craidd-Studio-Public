//! One-shot, local scaffolding. Existing manifests are never regenerated.
use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use toml_edit::{value, Array, ArrayOfTables, Document, Item, Table};

// Serialize creation across windows, including additions to the same solution.
static CREATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationRequest {
    template_id: String,
    name: String,
    parent: String,
    setup_configs: bool,
    dotnet_framework: String,
    solution_path: Option<String>,
}

#[derive(Deserialize)]
struct Template {
    id: String,
    language: String,
    available: bool,
}

#[derive(Clone, Serialize)]
pub struct CreatedFile {
    path: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    encoding: Option<String>,
}

#[derive(Serialize)]
pub struct ConfigurationPreview {
    name: String,
    kind: String,
    command: String,
}

#[derive(Serialize)]
pub struct Requirement {
    name: String,
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationPlan {
    destination: String,
    solution_path: String,
    files: Vec<CreatedFile>,
    configurations: Vec<ConfigurationPreview>,
    requirements: Vec<Requirement>,
    notes: Vec<String>,
    next_steps: Vec<String>,
    token: String,
    #[serde(skip)]
    original_solution: Option<String>,
    solution_content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationResult {
    solution_path: String,
    destination: String,
    log: Vec<String>,
}

fn text(value: &str) -> String {
    toml::Value::String(value.into()).to_string()
}

fn add(files: &mut Vec<CreatedFile>, path: &str, content: impl Into<String>) {
    files.push(CreatedFile {
        path: path.into(),
        content: content.into(),
        encoding: None,
    });
}

fn file_bytes(file: &CreatedFile) -> Result<Vec<u8>, String> {
    if file.encoding.as_deref() != Some("hex") {
        return Ok(file.content.as_bytes().to_vec());
    }
    (0..file.content.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&file.content[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn marker(name: &str, language: &str) -> String {
    format!(
        "[project]\nname = {}\nlanguage = {}\nroot = \".\"\n",
        text(name),
        text(language)
    )
}

fn ensure_empty(destination: &Path) -> Result<(), String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("The destination must be a new or empty directory, not a file or symbolic link.".into());
            }
            if fs::read_dir(destination)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
            {
                return Err("The destination is not empty. Choose another name or use Open Folder for existing files.".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    Ok(())
}

fn config(name: &str, kind: &str, target: &str, method: &str, command: &str, cwd: &str) -> Table {
    let mut table = Table::new();
    for (key, val) in [
        ("name", name),
        ("kind", kind),
        ("target", target),
        ("method", method),
        ("command", command),
        ("cwd", cwd),
    ] {
        table.insert(key, value(val));
    }
    table
}

fn profiles(table: &mut Table, cargo: bool) {
    let mut rows = ArrayOfTables::new();
    for (name, args) in if cargo {
        [("debug", vec![]), ("release", vec!["--release"])]
    } else {
        [
            ("Debug", vec!["--configuration", "Debug"]),
            ("Release", vec!["--configuration", "Release"]),
        ]
    } {
        let mut row = Table::new();
        row.insert("name", value(name));
        let mut array = Array::new();
        for arg in args {
            array.push(arg);
        }
        row.insert("args", value(array));
        rows.push(row);
    }
    table.insert(
        "default_profile",
        value(if cargo { "debug" } else { "Debug" }),
    );
    table.insert("profile", Item::ArrayOfTables(rows));
}

fn before(table: &mut Table, configuration: &str) {
    let mut order = Table::new();
    order.insert("before", value(configuration));
    table.insert("order", Item::Table(order));
}

fn tool(name: &str, programs: &[&str]) -> Requirement {
    Requirement {
        name: name.into(),
        path: programs.iter().find_map(|program| {
            super::toolchain::find_executable(program).map(|p| p.to_string_lossy().into_owned())
        }),
    }
}

fn plan(request: &CreationRequest) -> Result<CreationPlan, String> {
    let name = &request.name;
    if name.len() > 64
        || !name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(
            "Use 1–64 letters, digits, hyphens, or underscores, starting with a letter.".into(),
        );
    }
    let catalog: Vec<Template> =
        serde_json::from_str(include_str!("../../../src/lib/projectTemplates.json"))
            .map_err(|e| e.to_string())?;
    let template = catalog
        .iter()
        .find(|t| t.id == request.template_id)
        .ok_or("Unknown project template")?;
    if !template.available {
        return Err("This template is planned and cannot be created yet.".into());
    }
    if !["net8.0", "net9.0", "net10.0"].contains(&request.dotnet_framework.as_str()) {
        return Err("Choose a supported .NET target framework.".into());
    }
    let parent_input = Path::new(&request.parent);
    if !parent_input.is_absolute() {
        return Err("Choose an absolute parent location.".into());
    }
    let parent = parent_input
        .canonicalize()
        .map_err(|e| format!("Cannot access parent location: {e}"))?;
    if !parent.is_dir() {
        return Err("The parent location must be an existing directory.".into());
    }
    let destination = parent.join(name);
    ensure_empty(&destination)?;
    let existing = request
        .solution_path
        .as_ref()
        .map(|path| -> Result<_, String> {
            let input = Path::new(path);
            if !input.is_absolute() || input.extension().and_then(|s| s.to_str()) != Some("cln") {
                return Err("Expected an absolute .cln path.".into());
            }
            if fs::symlink_metadata(input)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("Choose the solution file directly, not a symbolic link.".into());
            }
            let canonical = input.canonicalize().map_err(|e| e.to_string())?;
            if canonical.parent() != Some(parent.as_path()) {
                return Err(
                    "Projects added to a solution must be created in its root folder.".into(),
                );
            }
            let original = fs::read_to_string(&canonical).map_err(|e| e.to_string())?;
            let doc: Document = original
                .parse()
                .map_err(|e| format!("Invalid solution: {e}"))?;
            if !doc.get("solution").is_some_and(Item::is_table) {
                return Err("Missing [solution] table.".into());
            }
            Ok((canonical, original, doc))
        })
        .transpose()?;
    let root = if existing.is_some() {
        parent.clone()
    } else {
        destination.clone()
    };
    let solution_path = existing
        .as_ref()
        .map(|e| e.0.clone())
        .unwrap_or_else(|| destination.join(format!("{name}.cln")));
    let mut doc = existing.as_ref().map(|e| e.2.clone()).unwrap_or_else(|| {
        let mut doc = Document::new();
        let mut solution = Table::new();
        solution.insert("name", value(name.as_str()));
        solution.insert("version", value("1.0"));
        solution.insert("projects", value(Array::new()));
        doc.insert("solution", Item::Table(solution));
        doc
    });
    let prefix = if existing.is_some() {
        format!("{name}/")
    } else {
        String::new()
    };
    let cwd = if existing.is_some() {
        name.clone()
    } else {
        ".".into()
    };
    let primary = format!("{prefix}{name}.craidd");
    let native = format!("{prefix}src-tauri/src-tauri.craidd");
    let empty = request.template_id.ends_with("-empty");
    let tauri = request.template_id == "rust-tauri-react";
    let mut files = vec![];
    let mut project_paths = vec![primary.clone()];
    add(
        &mut files,
        &format!("{name}.craidd"),
        marker(
            name,
            if tauri {
                "typescript"
            } else {
                &template.language
            },
        ),
    );
    if tauri {
        add(
            &mut files,
            "src-tauri/src-tauri.craidd",
            marker(&format!("{name} Rust"), "rust"),
        );
        project_paths.push(native.clone());
    }
    let projects = doc["solution"]
        .as_table_mut()
        .unwrap()
        .entry("projects")
        .or_insert(value(Array::new()))
        .as_array_mut()
        .ok_or("The solution project list must be an array.")?;
    for path in &project_paths {
        if projects.iter().any(|v| v.as_str() == Some(path)) {
            return Err(format!("The solution already declares {path}."));
        }
        projects.push(path.as_str());
    }

    let slug = name.to_ascii_lowercase().replace('_', "-");
    let mut requirements = vec![];
    let mut notes = vec![
        "Created from local templates. No downloads or tool installation during creation.".into(),
    ];
    let mut next_steps = vec![];
    if !empty {
        add(
            &mut files,
            ".gitignore",
            match template.language.as_str() {
                "rust" if tauri => "node_modules/\ndist/\nsrc-tauri/target/\n",
                "rust" => "target/\n",
                "csharp" => "bin/\nobj/\n",
                _ => "build/\n",
            },
        );
        match request.template_id.as_str() {
            "rust-console" => {
                add(&mut files, "Cargo.toml", format!("[package]\nname = \"{slug}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[[bin]]\nname = \"app\"\npath = \"src/main.rs\"\n"));
                add(
                    &mut files,
                    "src/main.rs",
                    "fn main() {\n    println!(\"Hello from Rust!\");\n}\n",
                );
                requirements.extend([tool("Cargo", &["cargo"]), tool("Rust compiler", &["rustc"])]);
                next_steps.push("cargo run".into());
            }
            "csharp-console" | "csharp-webapi" => {
                let web = request.template_id == "csharp-webapi";
                let sdk = if web {
                    "Microsoft.NET.Sdk.Web"
                } else {
                    "Microsoft.NET.Sdk"
                };
                let output_type = if web {
                    ""
                } else {
                    "    <OutputType>Exe</OutputType>\n"
                };
                add(&mut files, &format!("{name}.csproj"), format!("<Project Sdk=\"{sdk}\">\n  <PropertyGroup>\n{output_type}    <TargetFramework>{}</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n", request.dotnet_framework));
                add(
                    &mut files,
                    "Program.cs",
                    if web {
                        "var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\n\napp.MapGet(\"/\", () => new { message = \"Hello from ASP.NET Core!\" });\napp.MapGet(\"/health\", () => Results.Ok(new { status = \"ok\" }));\n\napp.Run();\n"
                    } else {
                        "Console.WriteLine(\"Hello from C#!\");\n"
                    },
                );
                requirements.push(tool(
                    &format!(
                        ".NET SDK for {} (version not checked)",
                        request.dotnet_framework
                    ),
                    &["dotnet"],
                ));
                notes.push(format!("Select an installed SDK that supports {}. First build may restore missing framework packs.", request.dotnet_framework));
                next_steps.push("dotnet run".into());
            }
            "cpp-console" => {
                add(&mut files, "CMakeLists.txt", format!("cmake_minimum_required(VERSION 3.16)\nproject({name} LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\nset(CMAKE_CXX_EXTENSIONS OFF)\nset(CMAKE_RUNTIME_OUTPUT_DIRECTORY \"${{CMAKE_BINARY_DIR}}\")\nforeach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)\n  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${{config}} \"${{CMAKE_BINARY_DIR}}\")\nendforeach()\nadd_executable(app src/main.cpp)\n"));
                add(&mut files, "src/main.cpp", "#include <iostream>\n\nint main() {\n    std::cout << \"Hello from C++!\\n\";\n    return 0;\n}\n");
                requirements.extend([
                    tool("CMake", &["cmake"]),
                    tool("C++ compiler", &["g++", "clang++"]),
                ]);
                next_steps.extend([
                    "cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug".into(),
                    "cmake --build build --config Debug --target app".into(),
                    "./build/app".into(),
                ]);
            }
            "rust-tauri-react" => {
                add_tauri_files(&mut files, name, &slug)?;
                requirements.extend([
                    tool("Cargo", &["cargo"]),
                    tool("Rust compiler", &["rustc"]),
                    tool("Node.js (check Vite requirements)", &["node"]),
                    tool("npm", &["npm"]),
                ]);
                notes.push("Tauri also needs the Linux system packages documented at https://v2.tauri.app/start/prerequisites/. System libraries are not checked here.".into());
                notes.push("Run npm install before the first build or run. npm and Cargo may download dependencies; no lockfiles exist until that first restore.".into());
                notes.push("Debug targets the Rust backend and uses Craidd's existing Vite server preparation. Frontend JavaScript debugging is not configured.".into());
                next_steps.extend(["npm install".into(), "npm run tauri dev".into()]);
            }
            _ => return Err("This template has no scaffold.".into()),
        }
        notes.push("Debugging requires an installed LLDB DAP adapter (Rust/C++) or netcoredbg (C#). Adapter availability is checked when debugging starts.".into());
    }

    let mut configs = ArrayOfTables::new();
    if request.setup_configs && !empty {
        let build_name = format!("{name} · Build");
        let run_name = format!("{name} · Run");
        let debug_name = format!("{name} · Debug");
        let mut group = Table::new();
        group.insert("name", value(name.as_str()));
        group.insert("kind", value("run"));
        group.insert("target", value(primary.as_str()));
        let mut slots = Table::new();
        for (key, val) in [
            ("build", &build_name),
            ("run", &run_name),
            ("debug", &debug_name),
        ] {
            slots.insert(key, value(val.as_str()));
        }
        group.insert("slots", Item::Table(slots));
        if !tauri && template.language != "cpp" {
            profiles(&mut group, template.language == "rust");
        }
        configs.push(group);
        if tauri {
            let frontend = format!("{name} · Build frontend");
            configs.push(config(
                &format!("{name} · Install dependencies"),
                "build",
                &primary,
                "npm",
                "npm install",
                &cwd,
            ));
            configs.push(config(
                &frontend,
                "build",
                &primary,
                "npm",
                "npm run build",
                &cwd,
            ));
            configs.push(config(
                &build_name,
                "build",
                &primary,
                "npm",
                "npm run tauri -- build --no-bundle",
                &cwd,
            ));
            configs.push(config(
                &run_name,
                "run",
                &primary,
                "npm",
                "npm run tauri dev",
                &cwd,
            ));
            let mut debug = config(
                &debug_name,
                "debug",
                &native,
                "cargo",
                "cargo build",
                &format!("{prefix}src-tauri"),
            );
            profiles(&mut debug, true);
            configs.push(debug);
        } else if template.language == "cpp" {
            let configure = format!("{name} · Configure");
            configs.push(config(
                &configure,
                "build",
                &primary,
                "cmake",
                "cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug",
                &cwd,
            ));
            let mut build = config(
                &build_name,
                "build",
                &primary,
                "cmake",
                "cmake --build build --config Debug --target app",
                &cwd,
            );
            before(&mut build, &configure);
            configs.push(build);
            let mut run = config(&run_name, "run", &primary, "shell", "./build/app", &cwd);
            before(&mut run, &build_name);
            configs.push(run);
            let mut debug = config(
                &debug_name,
                "debug",
                &primary,
                "cmake",
                "cmake --build build --config Debug --target app",
                &cwd,
            );
            before(&mut debug, &configure);
            configs.push(debug);
        } else {
            let cargo = template.language == "rust";
            for (cfg_name, kind, command) in [
                (
                    &build_name,
                    "build",
                    if cargo { "cargo build" } else { "dotnet build" },
                ),
                (
                    &run_name,
                    "run",
                    if cargo { "cargo run" } else { "dotnet run" },
                ),
                (
                    &debug_name,
                    "debug",
                    if cargo { "cargo build" } else { "dotnet build" },
                ),
            ] {
                let mut row = config(
                    cfg_name,
                    kind,
                    &primary,
                    if cargo { "cargo" } else { "dotnet" },
                    command,
                    &cwd,
                );
                profiles(&mut row, cargo);
                configs.push(row);
            }
        }
        if existing.is_none() {
            doc["solution"]["default_config"] = value(name.as_str());
        }
    }
    let configurations = configs
        .iter()
        .map(|row| ConfigurationPreview {
            name: row["name"].as_str().unwrap_or_default().into(),
            kind: row["kind"].as_str().unwrap_or_default().into(),
            command: row
                .get("command")
                .and_then(Item::as_str)
                .unwrap_or("Build / Run / Debug selection")
                .into(),
        })
        .collect();
    if !configs.is_empty() {
        let rows = doc
            .entry("config")
            .or_insert(Item::ArrayOfTables(ArrayOfTables::new()))
            .as_array_of_tables_mut()
            .ok_or("Existing configurations must use [[config]] tables.")?;
        for row in configs.iter() {
            if rows.iter().any(|existing| {
                existing.get("name").and_then(Item::as_str)
                    == row.get("name").and_then(Item::as_str)
            }) {
                return Err(format!(
                    "Configuration name already exists: {}",
                    row["name"].as_str().unwrap_or_default()
                ));
            }
            rows.push(row.clone());
        }
    }
    if existing.is_none() {
        doc["solution"]["default_project"] = value(primary.as_str());
    }
    let solution_content = doc.to_string();
    // Confirm the current on-disk schema is parseable, rather than emitting the target-only schema.
    solution_content
        .parse::<toml::Value>()
        .map_err(|e| format!("Invalid generated solution: {e}"))?;
    if existing.is_none() {
        add(&mut files, &format!("{name}.cln"), solution_content.clone());
    }
    if !empty {
        let commands = next_steps
            .iter()
            .map(|line| format!("    {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        add(&mut files, "README.md", format!("# {name}\n\nCreated with Craidd Studio.\n\n## Start\n\nRun these commands from this folder:\n\n{commands}\n\nCreation uses local files. Dependency restoration may use the network.\n"));
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut hasher = DefaultHasher::new();
    serde_json::to_string(request)
        .map_err(|e| e.to_string())?
        .hash(&mut hasher);
    root.hash(&mut hasher);
    solution_content.hash(&mut hasher);
    existing.as_ref().map(|e| &e.1).hash(&mut hasher);
    for file in &files {
        file.path.hash(&mut hasher);
        file.content.hash(&mut hasher);
        file.encoding.hash(&mut hasher);
    }
    Ok(CreationPlan {
        destination: destination.to_string_lossy().into_owned(),
        solution_path: solution_path.to_string_lossy().into_owned(),
        files,
        configurations,
        requirements,
        notes,
        next_steps,
        token: format!("{:x}", hasher.finish()),
        original_solution: existing.map(|e| e.1),
        solution_content,
    })
}

#[tauri::command]
pub fn preview_project_creation(request: CreationRequest) -> Result<CreationPlan, String> {
    plan(&request)
}

fn create(request: &CreationRequest, expected_token: &str) -> Result<CreationResult, String> {
    let _guard = CREATION_LOCK.lock().map_err(|e| e.to_string())?;
    let plan = plan(request)?;
    if plan.token != expected_token {
        return Err("The creation plan changed. Go back and review it again.".into());
    }
    let destination = PathBuf::from(&plan.destination);
    let new_directory = !destination.exists();
    if new_directory {
        fs::create_dir(&destination).map_err(|e| e.to_string())?;
    }
    // Recheck after reserving the directory. Individual writes also use create_new.
    ensure_empty(&destination)?;
    let mut created_files = Vec::new();
    let mut created_dirs = Vec::new();
    let mut log = vec![format!("Creating {} in {}", request.name, plan.destination)];
    let result = (|| -> Result<(), String> {
        for file in &plan.files {
            let path = destination.join(&file.path);
            let mut ancestors = Vec::new();
            let mut parent = path.parent().ok_or("File has no parent")?;
            while parent != destination && !created_dirs.iter().any(|dir| dir == parent) {
                ancestors.push(parent.to_path_buf());
                parent = parent.parent().ok_or("Directory has no parent")?;
            }
            for dir in ancestors.into_iter().rev() {
                fs::create_dir(&dir)
                    .map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
                created_dirs.push(dir);
            }
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| format!("Cannot create {}: {e}", path.display()))?;
            created_files.push(path);
            output
                .write_all(&file_bytes(file)?)
                .map_err(|e| e.to_string())?;
            log.push(format!("Created {}", file.path));
        }
        if let Some(original) = &plan.original_solution {
            let path = Path::new(&plan.solution_path);
            // Check again immediately before the metadata commit.
            if fs::read_to_string(path).map_err(|e| e.to_string())? != *original {
                return Err("The solution changed during creation. Review the plan again.".into());
            }
            let temporary = path.with_extension(format!("cln.creation-{}.tmp", std::process::id()));
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            let write_result = output
                .write_all(plan.solution_content.as_bytes())
                .and_then(|_| output.sync_all());
            drop(output);
            let commit = write_result.and_then(|_| {
                if fs::read_to_string(path)? != *original {
                    return Err(std::io::Error::other(
                        "The solution changed during creation",
                    ));
                }
                fs::rename(&temporary, path)
            });
            if let Err(error) = commit {
                let _ = fs::remove_file(&temporary);
                return Err(error.to_string());
            }
            log.push(format!("Updated {}", plan.solution_path));
        }
        Ok(())
    })();
    if let Err(error) = result {
        // Remove only paths reserved by this attempt, never recursive user data.
        for path in created_files.iter().rev() {
            let _ = fs::remove_file(path);
        }
        for path in created_dirs.iter().rev() {
            let _ = fs::remove_dir(path);
        }
        if new_directory {
            let _ = fs::remove_dir(&destination);
        }
        return Err(format!("{error}\nCreation did not complete; any files that could not be rolled back remain in {}.", destination.display()));
    }
    log.extend(plan.next_steps.iter().map(|step| format!("Next: {step}")));
    log.push("Project creation complete. No tools were run or installed.".into());
    Ok(CreationResult {
        solution_path: plan.solution_path,
        destination: plan.destination,
        log,
    })
}

#[tauri::command]
pub fn create_project_from_template(
    request: CreationRequest,
    expected_token: String,
) -> Result<CreationResult, String> {
    create(&request, &expected_token)
}

fn add_tauri_files(files: &mut Vec<CreatedFile>, name: &str, slug: &str) -> Result<(), String> {
    // generate_context! requires a default PNG even with bundling disabled.
    let icon = include_bytes!("../../templates/tauri-react/icon.png");
    files.push(CreatedFile {
        path: "src-tauri/icons/icon.png".into(),
        content: icon.iter().map(|byte| format!("{byte:02x}")).collect(),
        encoding: Some("hex".into()),
    });
    let package = serde_json::json!({ "name": slug, "version": "0.1.0", "private": true, "type": "module",
        "scripts": { "dev": "vite --host 127.0.0.1 --port 1420 --strictPort", "build": "tsc && vite build", "tauri": "tauri" },
        "dependencies": { "@tauri-apps/api": "^2", "react": "^19.1.0", "react-dom": "^19.1.0" },
        "devDependencies": { "@tauri-apps/cli": "^2", "@types/react": "^19", "@types/react-dom": "^19", "typescript": "~5.8.3", "vite": "^7.0.0" } });
    add(
        files,
        "package.json",
        serde_json::to_string_pretty(&package).map_err(|e| e.to_string())? + "\n",
    );
    add(files, "tsconfig.json", "{\n  \"compilerOptions\": {\n    \"target\": \"ES2020\", \"lib\": [\"ES2020\", \"DOM\", \"DOM.Iterable\"],\n    \"module\": \"ESNext\", \"moduleResolution\": \"bundler\",\n    \"jsx\": \"react-jsx\", \"strict\": true, \"skipLibCheck\": true, \"noEmit\": true\n  },\n  \"include\": [\"src\"]\n}\n");
    add(files, "index.html", format!("<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" /><title>{name}</title></head>\n<body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body>\n</html>\n"));
    add(files, "src/main.tsx", "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { invoke } from '@tauri-apps/api/core';\nimport { useState } from 'react';\nimport './style.css';\n\nfunction App() {\n  const [message, setMessage] = useState('Your desktop app is ready.');\n  return <main><p className=\"eyebrow\">TAURI + REACT</p><h1>Hello, desktop.</h1><p>{message}</p><button onClick={() => { void invoke<string>('greet').then(setMessage).catch(error => setMessage(String(error))); }}>Say hello from Rust</button></main>;\n}\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n");
    add(files, "src/style.css", ":root { font-family: system-ui, sans-serif; color: #e4e4e7; background: #18181b; color-scheme: dark; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; }\nmain { padding: 3rem; max-width: 36rem; }\nh1 { font-size: 3rem; letter-spacing: -.04em; margin: .5rem 0 1rem; }\np { color: #a1a1aa; line-height: 1.6; }\n.eyebrow { font-size: .75rem; letter-spacing: .15em; color: #60a5fa; }\nbutton { background: #2563eb; color: white; border: 0; border-radius: .4rem; padding: .8rem 1rem; cursor: pointer; }\nbutton:focus-visible { outline: 2px solid white; outline-offset: 3px; }\n");
    add(files, "src-tauri/Cargo.toml", format!("[package]\nname = \"{slug}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\nname = \"app_lib\"\ncrate-type = [\"staticlib\", \"cdylib\", \"rlib\"]\n\n[[bin]]\nname = \"app\"\npath = \"src/main.rs\"\n\n[build-dependencies]\ntauri-build = {{ version = \"2\", features = [] }}\n\n[dependencies]\ntauri = {{ version = \"2\", features = [] }}\n"));
    add(
        files,
        "src-tauri/build.rs",
        "fn main() { tauri_build::build() }\n",
    );
    add(files, "src-tauri/src/main.rs", "#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]\n\nfn main() { app_lib::run(); }\n");
    add(files, "src-tauri/src/lib.rs", "#[tauri::command]\nfn greet() -> String { \"Hello from Rust!\".into() }\n\npub fn run() {\n    tauri::Builder::default()\n        .invoke_handler(tauri::generate_handler![greet])\n        .run(tauri::generate_context!())\n        .expect(\"error while running the application\");\n}\n");
    let tauri = serde_json::json!({ "$schema": "https://schema.tauri.app/config/2", "productName": name,
        "version": "0.1.0", "identifier": format!("com.craidd.{}", slug.replace('-', "")),
        "build": { "beforeDevCommand": "npm run dev", "devUrl": "http://127.0.0.1:1420", "beforeBuildCommand": "npm run build", "frontendDist": "../dist" },
        "app": { "windows": [{ "label": "main", "title": name, "width": 1000, "height": 700 }], "security": { "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost http://127.0.0.1:1420 ws://127.0.0.1:1420" } },
        "bundle": { "active": false, "icon": [] } });
    add(
        files,
        "src-tauri/tauri.conf.json",
        serde_json::to_string_pretty(&tauri).map_err(|e| e.to_string())? + "\n",
    );
    add(files, "src-tauri/capabilities/default.json", "{\n  \"identifier\": \"default\",\n  \"description\": \"Main window permissions\",\n  \"windows\": [\"main\"],\n  \"permissions\": [\"core:default\"]\n}\n");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static SERIAL: AtomicUsize = AtomicUsize::new(0);
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "craidd-project-wizard-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn request(&self, template: &str) -> CreationRequest {
            CreationRequest {
                template_id: template.into(),
                name: "Demo".into(),
                parent: self.0.to_string_lossy().into_owned(),
                setup_configs: true,
                dotnet_framework: "net10.0".into(),
                solution_path: None,
            }
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn every_available_template_creates_and_loads_current_solution_schema() {
        let catalog: Vec<Template> =
            serde_json::from_str(include_str!("../../../src/lib/projectTemplates.json")).unwrap();
        for template in catalog.iter().filter(|template| template.available) {
            let sandbox = Sandbox::new();
            let request = sandbox.request(&template.id);
            let preview = plan(&request).unwrap();
            assert!(
                !sandbox.0.join("Demo").exists(),
                "Preview must be read-only"
            );
            let result = create(&request, &preview.token).unwrap();
            let loaded = super::super::solution::load_solution(result.destination.clone())
                .unwrap()
                .unwrap()
                .solution;
            let empty = template.id.ends_with("-empty");
            assert_eq!(
                loaded.projects.len(),
                if template.id == "rust-tauri-react" {
                    2
                } else {
                    1
                }
            );
            assert_eq!(loaded.configs.is_empty(), empty);
            for file in &preview.files {
                assert_eq!(
                    fs::read(Path::new(&result.destination).join(&file.path)).unwrap(),
                    file_bytes(file).unwrap()
                );
                if file.path.ends_with(".json") {
                    serde_json::from_str::<serde_json::Value>(&file.content).unwrap();
                }
                if file.path.ends_with(".toml") {
                    file.content.parse::<toml::Value>().unwrap();
                }
            }
            if empty {
                assert_eq!(preview.files.len(), 2, "Empty means only .craidd and .cln");
            }
            for config in &loaded.configs {
                if config.order.is_some() {
                    super::super::build_order::plan(&loaded, &config.name).unwrap();
                }
                if let Some(slots) = &config.slots {
                    for name in [&slots.build, &slots.run, &slots.debug]
                        .into_iter()
                        .flatten()
                    {
                        assert!(loaded.configs.iter().any(|entry| &entry.name == name));
                    }
                }
            }
        }
    }

    #[test]
    fn creation_refuses_traversal_planned_templates_and_nonempty_destinations() {
        let sandbox = Sandbox::new();
        let mut request = sandbox.request("rust-console");
        for bad in [
            "../outside",
            "/absolute",
            "a/b",
            ".",
            "My App",
            "x;touch-evil",
            "foo\nbar",
        ] {
            request.name = bad.into();
            assert!(plan(&request).is_err(), "{bad}");
        }
        request.name = "Demo".into();
        request.template_id = "rust-c-console".into();
        assert!(matches!(plan(&request), Err(error) if error.contains("planned")));
    }

    #[test]
    fn destination_rechecked_after_preview_and_existing_empty_folder_is_supported() {
        let sandbox = Sandbox::new();
        let request = sandbox.request("rust-empty");
        fs::create_dir(sandbox.0.join("Demo")).unwrap();
        let preview = plan(&request).unwrap();
        let sentinel = sandbox.0.join("Demo/.keep");
        fs::write(&sentinel, "user data").unwrap();
        assert!(create(&request, &preview.token).is_err());
        assert_eq!(fs::read_to_string(&sentinel).unwrap(), "user data");
        assert_eq!(fs::read_dir(sandbox.0.join("Demo")).unwrap().count(), 1);
        fs::remove_file(&sentinel).unwrap();
        create(&request, &preview.token).unwrap();
    }

    #[test]
    fn adding_to_solution_preserves_unknown_data_and_rejects_stale_preview() {
        let sandbox = Sandbox::new();
        let path = sandbox.0.join("Existing.cln");
        let original = "# keep comment\n[solution]\nname = \"Existing\"\nprojects = []\ndefault_config = \"Existing selection\"\n\n[custom]\nvalue = 42\n\n[[config]]\nname = \"Existing selection\"\nkind = \"build\"\ntarget = \".\"\nmethod = \"shell\"\ncommand = \"echo existing\"\n";
        fs::write(&path, original).unwrap();
        let mut request = sandbox.request("cpp-console");
        request.solution_path = Some(path.to_string_lossy().into_owned());
        let stale = plan(&request).unwrap();
        fs::write(&path, format!("{original}\n# concurrent edit\n")).unwrap();
        assert!(create(&request, &stale.token).is_err());
        assert!(!sandbox.0.join("Demo").exists());
        let preview = plan(&request).unwrap();
        assert!(preview
            .files
            .iter()
            .all(|file| !file.path.ends_with(".cln")));
        create(&request, &preview.token).unwrap();
        let saved = fs::read_to_string(&path).unwrap();
        assert!(saved.contains("# keep comment") && saved.contains("# concurrent edit"));
        let parsed: toml::Value = saved.parse().unwrap();
        assert_eq!(parsed["custom"]["value"].as_integer(), Some(42));
        assert_eq!(
            parsed["solution"]["default_config"].as_str(),
            Some("Existing selection")
        );
        let loaded =
            super::super::solution::load_solution(sandbox.0.to_string_lossy().into_owned())
                .unwrap()
                .unwrap()
                .solution;
        assert_eq!(loaded.projects[0].path, "Demo/Demo.craidd");
        assert_eq!(loaded.configs.len(), preview.configurations.len() + 1);
        for cfg in &loaded.configs {
            if cfg.order.is_some() {
                super::super::build_order::plan(&loaded, &cfg.name).unwrap();
            }
        }
    }

    #[test]
    fn disabling_configuration_setup_never_saves_power_configs() {
        let sandbox = Sandbox::new();
        let mut request = sandbox.request("rust-console");
        request.setup_configs = false;
        let preview = plan(&request).unwrap();
        assert!(preview.configurations.is_empty());
        create(&request, &preview.token).unwrap();
        let loaded = super::super::solution::load_solution(
            sandbox.0.join("Demo").to_string_lossy().into_owned(),
        )
        .unwrap()
        .unwrap()
        .solution;
        assert!(loaded.configs.is_empty());
    }

    #[test]
    fn symbolic_link_destination_is_rejected() {
        let sandbox = Sandbox::new();
        let other = sandbox.0.join("other");
        fs::create_dir(&other).unwrap();
        std::os::unix::fs::symlink(&other, sandbox.0.join("Demo")).unwrap();
        assert!(plan(&sandbox.request("rust-empty")).is_err());
        assert_eq!(fs::read_dir(&other).unwrap().count(), 0);
    }

    #[test]
    #[ignore = "Writes fixtures for explicit external toolchain smoke checks"]
    fn scaffold_smoke_fixtures() {
        let root = std::env::var("CRAIDD_WIZARD_SMOKE_ROOT").expect("Set an empty smoke-test root");
        fs::create_dir(&root).unwrap();
        for (template, name) in [
            ("rust-console", "RustConsole"),
            ("csharp-console", "CSharpConsole"),
            ("csharp-webapi", "CSharpApi"),
            ("cpp-console", "CppConsole"),
            ("rust-tauri-react", "TauriReact"),
        ] {
            let request = CreationRequest {
                template_id: template.into(),
                name: name.into(),
                parent: root.clone(),
                setup_configs: true,
                dotnet_framework: "net10.0".into(),
                solution_path: None,
            };
            let preview = plan(&request).unwrap();
            let result = create(&request, &preview.token).unwrap();
            println!("Scaffolded {}", result.destination);
        }
    }
}
