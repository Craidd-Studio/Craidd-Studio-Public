//! Persisted Gold source intent. Never sent to DAP setBreakpoints.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter};
static LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    pub file: String,
    pub start: u32,
    pub end: Option<u32>,
    pub solo: bool,
    pub condition: String,
}
fn path() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("HOME").ok_or("HOME unavailable")?)
            .join(".craidd-studio/gold.json"),
    )
}
fn read() -> Result<HashMap<String, Vec<Marker>>, String> {
    let p = path()?;
    if !p.exists() {
        return Ok(HashMap::new());
    }
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn key(path: &str) -> Result<String, String> {
    fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn load_gold(solution_path: String) -> Result<Vec<Marker>, String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    Ok(read()?.remove(&key(&solution_path)?).unwrap_or_default())
}
#[tauri::command]
pub fn edit_gold(
    app: AppHandle,
    solution_path: String,
    operation: String,
    file: String,
    line: u32,
    id: Option<String>,
    condition: Option<String>,
) -> Result<Vec<Marker>, String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let k = key(&solution_path)?;
    let mut all = read()?;
    let points = all.entry(k.clone()).or_default();
    let before = points.clone();
    let file = if operation == "remove" {
        file
    } else {
        key(&file)?
    };
    if line == 0 {
        return Err("Gold requires a source line".into());
    }
    match operation.as_str() {
        "start" | "solo" => {
            if points.len() >= 500 {
                return Err("Gold marker limit reached".into());
            }
            if points
                .iter()
                .any(|p| p.file == file && (p.start == line || p.end == Some(line)))
            {
                return Err("This line already has a Gold marker".into());
            }
            if operation == "solo" {
                points.retain(|p| !p.solo);
            }
            points.push(Marker {
                id: format!("g{}", super::profiling::stamp()),
                file,
                start: line,
                end: None,
                solo: operation == "solo",
                condition: String::new(),
            });
        }
        "end" => {
            if points
                .iter()
                .any(|p| p.file == file && (p.start == line || p.end == Some(line)))
            {
                return Err("This line already has a Gold marker".into());
            }
            let p = points
                .iter_mut()
                .find(|p| Some(&p.id) == id.as_ref() && !p.solo && p.end.is_none())
                .ok_or("Select an awaiting Start")?;
            if p.file != file || line <= p.start {
                return Err(
                    "End must follow Start in the same source file and lexical block".into(),
                );
            }
            p.end = Some(line);
        }
        "remove" => points.retain(|p| Some(&p.id) != id.as_ref()),
        "condition" => {
            let value = condition.unwrap_or_default();
            if !safe_condition(&value) {
                return Err("Use only scalar identifiers, numeric literals, comparisons and boolean operators; calls and member access are unsupported".into());
            }
            points
                .iter_mut()
                .find(|p| Some(&p.id) == id.as_ref())
                .ok_or("Marker no longer exists")?
                .condition = value;
        }
        _ => return Err("Unknown Gold operation".into()),
    }
    let invalidated = before
        .iter()
        .filter(|p| !points.contains(p))
        .map(|p| p.id.clone())
        .collect::<Vec<_>>();
    let result = points.clone();
    let path = path()?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())?;
    for id in invalidated {
        super::profiling::invalidate_marker(&app, &id);
    }
    let _ = app.emit(
        "craidd:gold-changed",
        serde_json::json!({"solutionPath":k,"points":result}),
    );
    Ok(result)
}
fn safe_condition(v: &str) -> bool {
    if v.len() > 256 {
        return false;
    }
    if v.is_empty() {
        return true;
    }
    let allowed = regex::Regex::new(r"^[a-zA-Z0-9_\s()!<>=&|]+$").unwrap();
    let call = regex::Regex::new(r"[a-zA-Z_][a-zA-Z0-9_]*\s*\(").unwrap();
    allowed.is_match(v)
        && !call.is_match(v)
        && !v.contains("++")
        && !v.contains("--")
        && !v.contains("/*")
        && !v.contains("//")
        && !v.contains(".")
        && !v
            .replace("==", "")
            .replace("!=", "")
            .replace("<=", "")
            .replace(">=", "")
            .contains('=')
        && !v.contains("->")
}
#[tauri::command]
pub fn export_gold_instrumentation(solution_path: String, file: String) -> Result<String, String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let k = key(&solution_path)?;
    let file = key(&file)?;
    let points = read()?
        .remove(&k)
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p.file == file)
        .collect::<Vec<_>>();
    prepare_source(&file, points)
}
fn prepare_source(file: &str, points: Vec<Marker>) -> Result<String, String> {
    if points.is_empty() {
        return Err("Place Gold markers in this file first".into());
    }
    if points.iter().any(|p| !p.solo && p.end.is_none()) {
        return Err("Complete all Start/End pairs before preparing".into());
    }
    let source = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let lines = source.lines().collect::<Vec<_>>();
    let name = std::path::Path::new(&file)
        .file_name()
        .ok_or("Invalid source name")?;
    if !["cpp", "cc", "cxx"].contains(
        &std::path::Path::new(&file)
            .extension()
            .and_then(|p| p.to_str())
            .unwrap_or(""),
    ) {
        return Err("Prepared source provider currently supports Linux C++ only".into());
    }
    if points.iter().any(|p| {
        p.start == 0
            || p.end == Some(0)
            || !regex::Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
                .unwrap()
                .is_match(&p.id)
            || p.start as usize > lines.len()
            || p.end.is_some_and(|e| e as usize > lines.len())
            || !safe_condition(&p.condition)
    }) {
        return Err("Marker no longer matches this source; review markers".into());
    }
    for p in &points {
        let expected = if p.solo {
            "CRAIDD_GOLD_SOLO();"
        } else {
            "CRAIDD_GOLD_START();"
        };
        if lines[p.start as usize - 1].trim() != expected
            || p.end
                .is_some_and(|end| lines[end as usize - 1].trim() != "CRAIDD_GOLD_END();")
        {
            return Err("The first C++ provider requires explicit CRAIDD_GOLD_START(); / CRAIDD_GOLD_END(); / CRAIDD_GOLD_SOLO(); statement anchors. Arbitrary source-line instrumentation is not qualified. See support/profiling and the Unity anchored fixture.".into());
        }
    }
    let dir = std::env::temp_dir().join(format!("craidd-gold-{}", super::profiling::stamp()));
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let mut generated = format!(
        "#include \"craidd_gold.hpp\"\n#line 1 {}\n",
        serde_json::to_string(&file).unwrap()
    );
    for (i, line) in lines.iter().enumerate() {
        let n = i as u32 + 1;
        let mut replacement = None;
        for p in &points {
            let cond = if p.condition.is_empty() {
                "true"
            } else {
                &p.condition
            };
            if p.start == n {
                for identifier in regex::Regex::new(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
                    .unwrap()
                    .find_iter(cond)
                {
                    generated+=&format!("static_assert(std::is_arithmetic_v<std::remove_cv_t<std::remove_reference_t<decltype({})>>>, \"Gold conditions require scalar locals\");\n#line {n} {}\n",identifier.as_str(),serde_json::to_string(file).unwrap());
                }
                replacement = Some(if p.solo {
                    format!(
                        r#"craidd_gold::solo("{}","Solo line {}",({}));"#,
                        p.id, n, cond
                    )
                } else {
                    format!(
                        r#"craidd_gold::Range {}("{}","Range {}-{}",({}));"#,
                        p.id,
                        p.id,
                        n,
                        p.end.unwrap(),
                        cond
                    )
                });
            }
            if p.end == Some(n) {
                replacement = Some(format!("{}.finish();", p.id));
            }
        }
        generated += replacement.as_deref().unwrap_or(line);
        generated += "\n";
    }
    fs::write(dir.join(name), generated).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("craidd_gold.hpp"),
        include_str!("../../../support/profiling/craidd_gold.hpp"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        dir.join("markers.json"),
        serde_json::to_vec_pretty(&points).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    fs::write(dir.join("README.txt"),format!("Prepared source COPY of {file}. Original source was not changed.\nBuild this copy with the original include paths and flags; include the original source directory for relative includes. A pair must compile in the same lexical block. Explicit anchor statements are replaced one-for-one. Early return/throw is incomplete.\nRun with CRAIDD_PROFILE_SOCKET from Craidd Profiler. Existing loaded binaries are never patched. Rebuild/restart after marker or condition changes.\nExplicit allocation events cover instrumented calls only. CPU is current-thread time, never hardware cycles.\n")).map_err(|e|e.to_string())?;
    Ok(dir.to_string_lossy().into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conditions_do_not_run_calls_or_assignments() {
        assert!(safe_condition("count >= 3 && enabled"));
        for s in ["work()", "a = 2", "i++", "x->a", "x.a", "a/*hi*/", "x / 0"] {
            assert!(!safe_condition(s), "{s}");
        }
    }
    #[test]
    fn prepared_anchor_copy_compiles_and_keeps_original_untouched() {
        let dir = std::env::temp_dir().join(format!(
            "craidd-gold-input-{}",
            super::super::profiling::stamp()
        ));
        fs::create_dir(&dir).unwrap();
        let file = dir.join("anchor.cpp");
        let original="#include \"craidd_gold.hpp\"\nint main(){\n int count=7;\n CRAIDD_GOLD_START();\n count+=3;\n CRAIDD_GOLD_END();\n return count==10?0:1;\n}\n";
        fs::write(&file, original).unwrap();
        let marker = Marker {
            id: "g1".into(),
            file: file.to_string_lossy().into(),
            start: 4,
            end: Some(6),
            solo: false,
            condition: "count >= 3".into(),
        };
        let bundle = prepare_source(file.to_str().unwrap(), vec![marker.clone()]).unwrap();
        let binary = dir.join("probe");
        let output = std::process::Command::new("c++")
            .args(["-std=c++17", "-pthread"])
            .arg(PathBuf::from(&bundle).join("anchor.cpp"))
            .arg("-o")
            .arg(&binary)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(std::process::Command::new(binary)
            .status()
            .unwrap()
            .success());
        assert_eq!(fs::read_to_string(&file).unwrap(), original);
        fs::write(&file, original.replace("CRAIDD_GOLD_START();", "count++;")).unwrap();
        assert!(prepare_source(file.to_str().unwrap(), vec![marker])
            .unwrap_err()
            .contains("explicit"));
        fs::remove_dir_all(bundle).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
