//! Owner-window scoped metric imports; all file work is on blocking workers.
use crate::metric_csv::{self as csv, Axis, Column, Dataset, JoinRule, Metadata};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

#[derive(Default, Clone)]
pub struct MetricManager(Arc<Mutex<HashMap<String, Arc<Job>>>>);
struct Job {
    id: String,
    owner: String,
    paths: Vec<String>,
    cancel: AtomicBool,
    summary_busy: AtomicBool,
    read: AtomicU64,
    total: AtomicU64,
    state: Mutex<String>,
    error: Mutex<Option<String>>,
    data: Mutex<Option<Dataset>>,
    joins: Mutex<Vec<JoinRule>>,
}
impl Job {
    fn trace(&self, event: &str) {
        if std::env::var_os("CRAIDD_METRIC_TRACE").is_some() {
            eprintln!(
                "craidd:metrics {}",
                serde_json::json!({
                    "id": self.id, "owner": self.owner, "event": event,
                    "bytesRead": self.read.load(Ordering::Relaxed),
                    "cancelled": self.cancel.load(Ordering::Relaxed),
                    "state": self.state.lock().ok().map(|s| s.clone()),
                    "epochMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().map(|t| t.as_millis())
                })
            );
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        // Emit only after the owned dataset has actually been dropped.
        if let Ok(data) = self.data.get_mut() {
            drop(data.take());
        }
        self.trace("storage-released");
    }
}
static NEXT: AtomicU64 = AtomicU64::new(1);
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Request {
    Start {
        paths: Vec<String>,
        snapshot: bool,
    },
    Status {
        id: String,
    },
    Cancel {
        id: String,
    },
    Dispose {
        id: String,
    },
    Row {
        id: String,
        table: usize,
        row: usize,
    },
    Page {
        id: String,
        table: usize,
        start: usize,
        count: usize,
    },
    Nearest {
        id: String,
        table: usize,
        start: usize,
        end: usize,
        x: f64,
    },
    Hover {
        id: String,
        table: usize,
        start: usize,
        end: usize,
        x: f64,
    },
    Summary {
        id: String,
        table: usize,
        columns: Vec<usize>,
        start: usize,
        end: usize,
    },
    PreviewInterpret {
        id: String,
        table: usize,
        columns: Vec<Column>,
        axis: Axis,
        rules: Option<Vec<JoinRule>>,
        thresholds: Option<Vec<csv::Threshold>>,
    },
    CommitInterpret {
        id: String,
        table: usize,
        columns: Vec<Column>,
        axis: Axis,
        rules: Vec<JoinRule>,
        thresholds: Vec<csv::Threshold>,
        expected_revision: u32,
    },
    Thresholds {
        id: String,
        table: usize,
        thresholds: Vec<csv::Threshold>,
    },
    Graph {
        id: String,
        table: usize,
        column: usize,
        start: usize,
        end: usize,
    },
    Worst {
        id: String,
        table: usize,
        column: usize,
        start: usize,
        end: usize,
        count: usize,
    },
    Interpret {
        id: String,
        table: usize,
        columns: Vec<Column>,
        axis: Axis,
    },
    BulkInterpret {
        id: String,
        table: usize,
        selection: Option<Vec<usize>>,
        unit: String,
        meaning: Option<String>,
    },
    Join {
        id: String,
        rules: Vec<JoinRule>,
    },
    Save {
        id: String,
        path: String,
        ranges: Vec<[usize; 2]>,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    id: String,
    paths: Vec<String>,
    kind: &'static str,
    state: String,
    error: Option<String>,
    bytes_read: u64,
    total_bytes: u64,
    tables: Vec<Metadata>,
    joins: Vec<JoinRule>,
    rows: Vec<usize>,
    memory_bytes: usize,
    max_memory_bytes: usize,
    max_rows: usize,
    max_file_bytes: u64,
    max_sets: usize,
}

impl MetricManager {
    pub fn close(&self, owner: &str) {
        if let Ok(mut jobs) = self.0.lock() {
            jobs.retain(|_, job| {
                if job.owner == owner {
                    job.cancel.store(true, Ordering::Relaxed);
                    job.trace("owner-close-cancel");
                    false
                } else {
                    true
                }
            });
        }
    }
    pub fn handle(&self, owner: &str, request: Request) -> Result<serde_json::Value, String> {
        if let Request::Start { paths, snapshot } = request {
            if paths.is_empty() || paths.len() > 8 || snapshot && paths.len() != 1 {
                return Err("Choose 1–8 CSV files, or one metric snapshot".into());
            }
            let mut unique = std::collections::HashSet::new();
            let mut total = 0u64;
            for path in &paths {
                let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
                if !unique.insert(canonical) {
                    return Err("Same file selected twice".into());
                }
                let info = std::fs::metadata(path).map_err(|e| e.to_string())?;
                if !info.is_file() {
                    return Err("Choose regular files".into());
                }
                total = total.checked_add(info.len()).ok_or("File size overflow")?;
            }
            if total > csv::MAX_BYTES {
                return Err("File set exceeds 1 GiB".into());
            }
            let id = format!(
                "metrics-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let job = Arc::new(Job {
                id: id.clone(),
                owner: owner.into(),
                paths: paths.clone(),
                cancel: AtomicBool::new(false),
                summary_busy: AtomicBool::new(false),
                read: AtomicU64::new(0),
                total: AtomicU64::new(total),
                state: Mutex::new("loading".into()),
                error: Mutex::new(None),
                data: Mutex::new(None),
                joins: Mutex::new(Vec::new()),
            });
            let mut jobs = self.0.lock().map_err(|e| e.to_string())?;
            if jobs.values().filter(|j| j.owner == owner).count() >= 2 {
                return Err(
                    "Two source sets already retained in this window; remove one first".into(),
                );
            }
            jobs.insert(id.clone(), job.clone());
            drop(jobs);
            let set_id = id.clone();
            std::thread::spawn(move || {
                job.trace("reader-started");
                let result = (|| {
                    if snapshot {
                        let (data, joins) = csv::load(&paths[0], &job.cancel)?;
                        *job.joins.lock().map_err(|e| e.to_string())? = joins;
                        return Ok(data);
                    }
                    let mut tables = Vec::new();
                    let mut base = 0;
                    for path in &paths {
                        let retained = tables.iter().map(csv::Table::memory_bytes).sum::<usize>();
                        let mut table = csv::parse_limited(
                            path,
                            &job.cancel,
                            |read, _| {
                                job.read.store(base + read, Ordering::Relaxed);
                            },
                            csv::MAX_MEMORY.saturating_sub(retained),
                        )?;
                        table.meta.source_id = format!("{set_id}:{}", tables.len());
                        base += table.meta.size;
                        tables.push(table);
                        if tables.iter().map(csv::Table::memory_bytes).sum::<usize>()
                            > csv::MAX_MEMORY
                        {
                            return Err("File set exceeds 512 MiB retained-memory limit".into());
                        }
                    }
                    Ok(Dataset { tables })
                })();
                match result {
                    Ok(data) if !job.cancel.load(Ordering::Relaxed) => {
                        let state = if data.tables.iter().any(|t| t.meta.completion == "partial") {
                            "partial"
                        } else {
                            "complete"
                        };
                        *job.data.lock().unwrap() = Some(data);
                        job.read.store(total, Ordering::Relaxed);
                        *job.state.lock().unwrap() = state.into();
                    }
                    Err(error) => {
                        *job.error.lock().unwrap() = Some(error);
                        *job.state.lock().unwrap() = if job.cancel.load(Ordering::Relaxed) {
                            "cancelled"
                        } else {
                            "failed"
                        }
                        .into();
                    }
                    _ => {
                        *job.state.lock().unwrap() = "cancelled".into();
                    }
                }
                job.trace("reader-finished");
            });
            return Ok(serde_json::json!({"id":id}));
        }
        let id = match &request {
            Request::Status { id }
            | Request::Cancel { id }
            | Request::Dispose { id }
            | Request::Row { id, .. }
            | Request::Page { id, .. }
            | Request::Nearest { id, .. }
            | Request::Hover { id, .. }
            | Request::Summary { id, .. }
            | Request::PreviewInterpret { id, .. }
            | Request::CommitInterpret { id, .. }
            | Request::Thresholds { id, .. }
            | Request::Graph { id, .. }
            | Request::Worst { id, .. }
            | Request::Interpret { id, .. }
            | Request::BulkInterpret { id, .. }
            | Request::Join { id, .. }
            | Request::Save { id, .. } => id,
            _ => unreachable!(),
        };
        let job = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .filter(|j| j.owner == owner)
            .cloned()
            .ok_or("Metric source unavailable in this window")?;
        if matches!(request, Request::Dispose { .. }) {
            job.cancel.store(true, Ordering::Relaxed);
            self.0.lock().map_err(|e| e.to_string())?.remove(id);
            return Ok(serde_json::Value::Null);
        }
        if matches!(request, Request::Cancel { .. }) {
            job.cancel.store(true, Ordering::Relaxed);
            return Ok(serde_json::Value::Null);
        }
        if matches!(request, Request::Status { .. }) {
            let state = job.state.lock().map_err(|e| e.to_string())?.clone();
            let data = job.data.lock().map_err(|e| e.to_string())?;
            return serde_json::to_value(Status {
                id: id.clone(),
                paths: job.paths.clone(),
                kind: "importedMetrics",
                state,
                error: job.error.lock().map_err(|e| e.to_string())?.clone(),
                bytes_read: job.read.load(Ordering::Relaxed),
                total_bytes: job.total.load(Ordering::Relaxed),
                tables: data
                    .as_ref()
                    .map(|d| d.tables.iter().map(|t| t.meta.clone()).collect())
                    .unwrap_or_default(),
                rows: data
                    .as_ref()
                    .map(|d| d.tables.iter().map(|t| t.lines.len()).collect())
                    .unwrap_or_default(),
                memory_bytes: data
                    .as_ref()
                    .map(|d| d.tables.iter().map(csv::Table::memory_bytes).sum())
                    .unwrap_or(0),
                joins: job.joins.lock().map_err(|e| e.to_string())?.clone(),
                max_memory_bytes: csv::MAX_MEMORY,
                max_rows: csv::MAX_ROWS,
                max_file_bytes: csv::MAX_BYTES,
                max_sets: 2,
            })
            .map_err(|e| e.to_string());
        }
        if let Request::Summary {
            table,
            columns,
            start,
            end,
            ..
        } = &request
        {
            if columns.len() > 8 || columns.is_empty() {
                return Err("Choose 1–8 numeric columns".into());
            }
            if job.summary_busy.swap(true, Ordering::AcqRel) {
                return Err("Summary already running; retry after it finishes".into());
            }
            struct Busy<'a>(&'a AtomicBool);
            impl Drop for Busy<'_> {
                fn drop(&mut self) {
                    self.0.store(false, Ordering::Release);
                }
            }
            let _busy = Busy(&job.summary_busy);
            let (copied, n) = {
                let data = job.data.lock().map_err(|e| e.to_string())?;
                let t = data
                    .as_ref()
                    .and_then(|d| d.tables.get(*table))
                    .ok_or("Source is not ready")?;
                let end = (*end).min(t.lines.len());
                if *start >= end {
                    return Err("Empty summary range".into());
                }
                let mut copied = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for c in columns {
                    if !seen.insert(*c) {
                        return Err("Duplicate summary column".into());
                    }
                    match t.values.get(*c) {
                        Some(csv::Values::Numbers(v)) => copied.push((*c, v[*start..end].to_vec())),
                        _ => return Err("Choose numeric summary columns".into()),
                    }
                }
                (copied, end - *start)
            };
            return csv::summarize(copied, n, &job.cancel);
        }
        let mut guard = job.data.lock().map_err(|e| e.to_string())?;
        let data = guard.as_mut().ok_or("Source is not ready")?;
        let table = |i: usize| {
            data.tables
                .get(i)
                .ok_or_else(|| "Unknown file group".to_string())
        };
        let json = |v| serde_json::to_value(v).map_err(|e| e.to_string());
        match request {
            Request::Hover {
                table: i,
                start,
                end,
                x,
                ..
            } => {
                let row = csv::nearest(table(i)?, start, end, x)?;
                serde_json::to_value(csv::page(table(i)?, row, 1)?.remove(0))
                    .map_err(|e| e.to_string())
            }
            Request::PreviewInterpret {
                table: i,
                columns,
                axis,
                rules,
                thresholds,
                ..
            } => {
                let saved = job.joins.lock().map_err(|e| e.to_string())?;
                validate_settings(
                    data,
                    i,
                    &columns,
                    &axis,
                    rules.as_deref().unwrap_or(&saved),
                    thresholds.as_deref().unwrap_or(&table(i)?.meta.thresholds),
                )
            }
            Request::CommitInterpret {
                table: i,
                columns,
                axis,
                rules,
                thresholds,
                expected_revision,
                ..
            } => {
                let mut saved = job.joins.lock().map_err(|e| e.to_string())?;
                if table(i)?.meta.interpretation_revision != expected_revision {
                    return Err(
                        "Interpretation changed; review the current values before applying".into(),
                    );
                }
                validate_settings(data, i, &columns, &axis, &rules, &thresholds)?;
                let t = data.tables.get_mut(i).unwrap();
                t.interpret(columns, axis)?;
                t.meta.thresholds = thresholds;
                *saved = rules;
                Ok(serde_json::Value::Null)
            }
            Request::Thresholds {
                table: i,
                thresholds,
                ..
            } => {
                let t = data.tables.get_mut(i).ok_or("Unknown file group")?;
                if t.meta.snapshot {
                    return Err("Snapshot thresholds are immutable".into());
                }
                if thresholds.len() > 16
                    || thresholds.iter().any(|r| {
                        !r.value.is_finite()
                            || r.label.len() > 80
                            || !t.meta.columns.get(r.column).is_some_and(|c| c.numeric)
                    })
                {
                    return Err("Choose up to 16 numeric thresholds with finite values and labels under 80 bytes".into());
                }
                t.meta.thresholds = thresholds;
                t.meta.interpretation_revision += 1;
                Ok(serde_json::Value::Null)
            }
            Request::Row { table: i, row, .. } => Ok(
                serde_json::json!({"row":table(i)?.row(row)?,"companions":csv::companions(data,i,row,&job.joins.lock().map_err(|e|e.to_string())?)?}),
            ),
            Request::Page {
                table: i,
                start,
                count,
                ..
            } => {
                serde_json::to_value(csv::page(table(i)?, start, count)?).map_err(|e| e.to_string())
            }
            Request::Nearest {
                table: i,
                start,
                end,
                x,
                ..
            } => {
                let row = csv::nearest(table(i)?, start, end, x)?;
                Ok(
                    serde_json::json!({"row":table(i)?.row(row)?,"companions":csv::companions(data,i,row,&job.joins.lock().map_err(|e|e.to_string())?)?}),
                )
            }
            Request::Graph {
                table: i,
                column,
                start,
                end,
                ..
            } => json(csv::graph(table(i)?, column, start, end)?),
            Request::Worst {
                table: i,
                column,
                start,
                end,
                count,
                ..
            } => serde_json::to_value(csv::worst(table(i)?, column, start, end, count)?)
                .map_err(|e| e.to_string()),
            Request::Interpret {
                table: i,
                columns,
                axis,
                ..
            } => {
                apply_interpretation(
                    data,
                    &job.joins.lock().map_err(|e| e.to_string())?,
                    i,
                    columns,
                    axis,
                )?;
                Ok(serde_json::Value::Null)
            }
            Request::BulkInterpret {
                table: i,
                selection,
                unit,
                meaning,
                ..
            } => {
                let current = table(i)?;
                let columns = csv::bulk_columns(
                    &current.meta.columns,
                    selection.as_deref(),
                    &unit,
                    meaning.as_deref(),
                )?;
                let axis = current.meta.axis.clone();
                apply_interpretation(
                    data,
                    &job.joins.lock().map_err(|e| e.to_string())?,
                    i,
                    columns,
                    axis,
                )?;
                Ok(serde_json::Value::Null)
            }
            Request::Join { rules, .. } => {
                if rules.len() > 8 || data.tables.iter().any(|t| t.meta.snapshot) {
                    return Err("Snapshots have immutable join rules; limit is eight rules".into());
                }
                for rule in &rules {
                    let left = table(rule.left)?;
                    let right = table(rule.right)?;
                    if rule.left == rule.right
                        || rule.left_column >= left.values.len()
                        || rule.right_column >= right.values.len()
                        || rule.tolerance.is_some_and(|t| !t.is_finite() || t < 0.)
                    {
                        return Err("Invalid join rule".into());
                    }
                    if let Some(t) = rule.tolerance {
                        let a = &left.meta.columns[rule.left_column];
                        let b = &right.meta.columns[rule.right_column];
                        if !a.numeric || !b.numeric || a.unit != b.unit {
                            return Err(format!(
                                "Tolerance {t} requires numeric keys with the same declared unit"
                            ));
                        }
                    }
                }
                *job.joins.lock().map_err(|e| e.to_string())? = rules;
                Ok(serde_json::Value::Null)
            }
            Request::Save { path, ranges, .. } => {
                csv::save(
                    data,
                    &job.joins.lock().map_err(|e| e.to_string())?,
                    &path,
                    &ranges,
                    &job.cancel,
                )?;
                Ok(serde_json::Value::Null)
            }
            _ => unreachable!(),
        }
    }
}

// Shared by individual and bulk edits, so neither can bypass snapshot, axis or join guards.
fn validate_settings(
    data: &Dataset,
    i: usize,
    columns: &[Column],
    axis: &Axis,
    rules: &[JoinRule],
    thresholds: &[csv::Threshold],
) -> Result<serde_json::Value, String> {
    let t = data.tables.get(i).ok_or("Unknown file group")?;
    let mut preview = t.preview_interpretation(columns.to_vec(), axis)?;
    if rules.len() > 8 {
        return Err("Use at most eight companion rules".into());
    }
    for rule in rules {
        if rule.left == rule.right || rule.tolerance.is_some_and(|v| !v.is_finite() || v < 0.) {
            return Err("Invalid join rule".into());
        }
        let left = if rule.left == i {
            columns
        } else {
            &data
                .tables
                .get(rule.left)
                .ok_or("Unknown companion group")?
                .meta
                .columns
        };
        let right = if rule.right == i {
            columns
        } else {
            &data
                .tables
                .get(rule.right)
                .ok_or("Unknown companion group")?
                .meta
                .columns
        };
        let a = left
            .get(rule.left_column)
            .ok_or("Choose a named left key")?;
        let b = right
            .get(rule.right_column)
            .ok_or("Choose a named right key")?;
        if rule.tolerance.is_some() && (!a.numeric || !b.numeric || a.unit != b.unit) {
            return Err("Toleranced joins require numeric keys with the same declared unit".into());
        }
    }
    if thresholds.len() > 16
        || thresholds.iter().any(|v| {
            !v.value.is_finite()
                || v.label.len() > 80
                || !columns.get(v.column).is_some_and(|c| c.numeric)
        })
    {
        return Err(
            "Use up to 16 numeric threshold lines with finite values and short labels".into(),
        );
    }
    preview["joins"] = serde_json::to_value(rules).unwrap();
    preview["thresholds"] = serde_json::to_value(thresholds).unwrap();
    Ok(preview)
}
fn check_join_units(
    data: &Dataset,
    rules: &[JoinRule],
    i: usize,
    columns: &[Column],
) -> Result<(), String> {
    let table = data.tables.get(i).ok_or("Unknown file group")?;
    if columns.len() != table.meta.columns.len() {
        return Err("Column schema changed".into());
    }
    for rule in rules.iter().filter(|r| r.tolerance.is_some()) {
        let left: &[Column] = if rule.left == i {
            columns
        } else {
            &data
                .tables
                .get(rule.left)
                .ok_or("Unknown file group")?
                .meta
                .columns
        };
        let right: &[Column] = if rule.right == i {
            columns
        } else {
            &data
                .tables
                .get(rule.right)
                .ok_or("Unknown file group")?
                .meta
                .columns
        };
        if left[rule.left_column].unit != right[rule.right_column].unit {
            return Err("Unit override conflicts with a declared toleranced join; edit or clear that join first".into());
        }
    }
    Ok(())
}
fn apply_interpretation(
    data: &mut Dataset,
    rules: &[JoinRule],
    i: usize,
    columns: Vec<Column>,
    axis: Axis,
) -> Result<(), String> {
    check_join_units(data, rules, i, &columns)?;
    data.tables.get_mut(i).unwrap().interpret(columns, axis)
}

#[tauri::command]
pub async fn metric_action(
    w: tauri::WebviewWindow,
    manager: tauri::State<'_, MetricManager>,
    request: Request,
) -> Result<serde_json::Value, String> {
    let manager = manager.inner().clone();
    let owner = w.label().to_string();
    tauri::async_runtime::spawn_blocking(move || manager.handle(&owner, request))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, String) {
        let p = std::env::temp_dir().join(format!(
            "craidd-metric-owner-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&p).unwrap();
        let file = p.join("run.csv");
        std::fs::write(&file, "time_s,p99_ms,note\n0,10,a\n1,20,b\n").unwrap();
        (p, file.to_string_lossy().into())
    }
    fn wait(manager: &MetricManager, id: &str) -> serde_json::Value {
        for _ in 0..500 {
            let status = manager
                .handle("a", Request::Status { id: id.into() })
                .unwrap();
            if status["state"] != "loading" {
                return status;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        panic!("import timeout");
    }
    #[test]
    fn ownership_queries_limits_and_close_do_not_modify_file() {
        let (root, path) = fixture();
        let before = std::fs::read(&path).unwrap();
        let manager = MetricManager::default();
        let start = manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path.clone()],
                    snapshot: false,
                },
            )
            .unwrap();
        let id = start["id"].as_str().unwrap();
        let s = wait(&manager, id);
        assert_eq!(s["rows"][0], 2);
        assert!(manager
            .handle("b", Request::Status { id: id.into() })
            .is_err());
        let row = manager
            .handle(
                "a",
                Request::Row {
                    id: id.into(),
                    table: 0,
                    row: 1,
                },
            )
            .unwrap();
        assert_eq!(row["row"]["cells"][1], 20.);
        assert!(manager
            .handle(
                "a",
                Request::Row {
                    id: id.into(),
                    table: 0,
                    row: 9
                }
            )
            .is_err());
        assert!(manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path.clone(), path.clone()],
                    snapshot: false
                }
            )
            .is_err());
        let _ = manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path.clone()],
                    snapshot: false,
                },
            )
            .unwrap();
        assert!(manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path.clone()],
                    snapshot: false
                }
            )
            .is_err());
        manager.close("a");
        assert!(manager
            .handle("a", Request::Status { id: id.into() })
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unit_conflict_error_does_not_replace_join_rules() {
        let (root, path) = fixture();
        let other = root.join("other.csv");
        std::fs::write(&other, "time_ms,value\n0,1\n1,2\n").unwrap();
        let manager = MetricManager::default();
        let start = manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path, other.to_string_lossy().into()],
                    snapshot: false,
                },
            )
            .unwrap();
        let id = start["id"].as_str().unwrap();
        wait(&manager, id);
        let rule = JoinRule {
            left: 0,
            right: 1,
            left_column: 0,
            right_column: 0,
            tolerance: Some(1.),
        };
        assert!(manager
            .handle(
                "a",
                Request::Join {
                    id: id.into(),
                    rules: vec![rule]
                }
            )
            .unwrap_err()
            .contains("unit"));
        assert_eq!(wait(&manager, id)["joins"], serde_json::json!([]));
        manager.close("a");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unit_edit_cannot_break_an_existing_toleranced_join() {
        let (root, path) = fixture();
        let other = root.join("other.csv");
        std::fs::write(&other, "time_s,value\n0,1\n1,2\n").unwrap();
        let manager = MetricManager::default();
        let start = manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path, other.to_string_lossy().into()],
                    snapshot: false,
                },
            )
            .unwrap();
        let id = start["id"].as_str().unwrap();
        let before = wait(&manager, id);
        manager
            .handle(
                "a",
                Request::Join {
                    id: id.into(),
                    rules: vec![JoinRule {
                        left: 0,
                        right: 1,
                        left_column: 0,
                        right_column: 0,
                        tolerance: Some(0.1),
                    }],
                },
            )
            .unwrap();
        let mut columns: Vec<Column> =
            serde_json::from_value(before["tables"][0]["columns"].clone()).unwrap();
        columns[0].unit = "ms".into();
        assert!(manager
            .handle(
                "a",
                Request::Interpret {
                    id: id.into(),
                    table: 0,
                    columns,
                    axis: Axis::default()
                }
            )
            .unwrap_err()
            .contains("conflicts"));
        assert!(manager
            .handle(
                "a",
                Request::BulkInterpret {
                    id: id.into(),
                    table: 0,
                    selection: Some(vec![0]),
                    unit: "ms".into(),
                    meaning: None
                }
            )
            .unwrap_err()
            .contains("conflicts"));
        let after = wait(&manager, id);
        assert_eq!(after["tables"][0]["columns"][0]["unit"], "s");
        assert_eq!(
            after["tables"][0]["interpretationRevision"],
            before["tables"][0]["interpretationRevision"]
        );
        assert_eq!(after["joins"].as_array().unwrap().len(), 1);
        manager.close("a");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bulk_command_is_atomic_and_uses_snapshot_and_join_guards() {
        let (root, path) = fixture();
        let manager = MetricManager::default();
        let start = manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![path],
                    snapshot: false,
                },
            )
            .unwrap();
        let id = start["id"].as_str().unwrap();
        let before = wait(&manager, id);
        let snap = root.join("saved.crmetrics");
        manager
            .handle(
                "a",
                Request::Save {
                    id: id.into(),
                    path: snap.to_string_lossy().into(),
                    ranges: vec![[0, 2]],
                },
            )
            .unwrap();
        let bytes = std::fs::read(&snap).unwrap();
        assert!(manager
            .handle(
                "a",
                Request::BulkInterpret {
                    id: id.into(),
                    table: 0,
                    selection: Some(vec![1, 9]),
                    unit: "us".into(),
                    meaning: None
                }
            )
            .is_err());
        assert_eq!(wait(&manager, id)["tables"], before["tables"]);
        manager
            .handle(
                "a",
                Request::BulkInterpret {
                    id: id.into(),
                    table: 0,
                    selection: Some(vec![1]),
                    unit: "us".into(),
                    meaning: Some("window statistic".into()),
                },
            )
            .unwrap();
        let after = wait(&manager, id);
        assert_eq!(after["tables"][0]["columns"][1]["unit"], "us");
        assert_eq!(
            after["tables"][0]["columns"][0],
            before["tables"][0]["columns"][0]
        );
        assert_eq!(
            after["tables"][0]["interpretationRevision"]
                .as_u64()
                .unwrap(),
            before["tables"][0]["interpretationRevision"]
                .as_u64()
                .unwrap()
                + 1
        );
        let opened = manager
            .handle(
                "a",
                Request::Start {
                    paths: vec![snap.to_string_lossy().into()],
                    snapshot: true,
                },
            )
            .unwrap();
        let saved_id = opened["id"].as_str().unwrap();
        wait(&manager, saved_id);
        assert!(manager
            .handle(
                "a",
                Request::BulkInterpret {
                    id: saved_id.into(),
                    table: 0,
                    selection: Some(vec![1]),
                    unit: "ms".into(),
                    meaning: None
                }
            )
            .unwrap_err()
            .contains("immutable"));
        assert_eq!(std::fs::read(snap).unwrap(), bytes);
        manager.close("a");
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod editor_completion_tests {
    use super::*;
    fn action(
        manager: &MetricManager,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        manager.handle("editor", serde_json::from_value(request).unwrap())
    }
    #[test]
    fn preview_commit_quantiles_gaps_and_snapshot_thresholds() {
        let dir = std::env::temp_dir().join(format!(
            "metric-editor-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("run.csv");
        std::fs::write(
            &file,
            "elapsed_s,loop_ms_p99,note\n0,10,a\n1,,b\n2,30,c\nbad,record\n3,50,d\n",
        )
        .unwrap();
        let manager = MetricManager::default();
        let id = action(
            &manager,
            serde_json::json!({"op":"start","paths":[file],"snapshot":false}),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut status = serde_json::Value::Null;
        for _ in 0..500 {
            status = action(&manager, serde_json::json!({"op":"status","id":id})).unwrap();
            if status["state"] != "loading" {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let columns = status["tables"][0]["columns"].clone();
        let axis = serde_json::json!({"kind":"elapsed","column":0,"windowSeconds":1.0});
        let thresholds = serde_json::json!([{"column":1,"value":40.0,"label":"User budget"}]);
        let preview = serde_json::json!({"op":"previewInterpret","id":id,"table":0,"columns":columns,"axis":axis,"rules":[],"thresholds":thresholds});
        assert_eq!(action(&manager, preview).unwrap()["lastX"], 3.0);
        assert_eq!(
            action(&manager, serde_json::json!({"op":"status","id":id})).unwrap()["tables"][0]
                ["axis"]["kind"],
            "ordinal"
        );
        let revision = status["tables"][0]["interpretationRevision"]
            .as_u64()
            .unwrap();
        let commit = serde_json::json!({"op":"commitInterpret","id":id,"table":0,"columns":columns,"axis":axis,"rules":[],"thresholds":thresholds,"expectedRevision":revision});
        let mut invalid = commit.clone();
        invalid["thresholds"][0]["column"] = serde_json::json!(999);
        assert!(action(&manager, invalid).is_err());
        assert_eq!(
            action(&manager, serde_json::json!({"op":"status","id":id})).unwrap()["tables"][0]
                ["interpretationRevision"],
            revision
        );
        action(&manager, commit.clone()).unwrap();
        assert!(action(&manager, commit).is_err());
        let summary = action(
            &manager,
            serde_json::json!({"op":"summary","id":id,"table":0,"columns":[1],"start":0,"end":4}),
        )
        .unwrap();
        assert_eq!(summary["columns"][0]["count"], 3);
        assert_eq!(summary["columns"][0]["missing"], 1);
        assert_eq!(summary["columns"][0]["median"], 30.0);
        assert_eq!(summary["columns"][0]["q1"], 20.0);
        assert_eq!(summary["columns"][0]["q3"], 40.0);
        let graph = action(
            &manager,
            serde_json::json!({"op":"graph","id":id,"table":0,"column":1,"start":0,"end":4}),
        )
        .unwrap();
        let vertices = graph["vertices"].as_array().unwrap();
        assert_eq!(vertices.len(), 3);
        assert!(vertices.iter().all(|v| v["breakBefore"] == true));
        assert_eq!(vertices[2]["value"], 50.0);
        let snapshot = dir.join("copy.crmetrics");
        action(
            &manager,
            serde_json::json!({"op":"save","id":id,"path":snapshot,"ranges":[[0,4]]}),
        )
        .unwrap();
        let bytes = std::fs::read(&snapshot).unwrap();
        action(
            &manager,
            serde_json::json!({"op":"thresholds","id":id,"table":0,"thresholds":[]}),
        )
        .unwrap();
        assert_eq!(std::fs::read(&snapshot).unwrap(), bytes);
        let reopened = action(
            &manager,
            serde_json::json!({"op":"start","paths":[snapshot],"snapshot":true}),
        )
        .unwrap();
        let sid = reopened["id"].as_str().unwrap();
        let mut loaded = serde_json::Value::Null;
        for _ in 0..500 {
            loaded = action(&manager, serde_json::json!({"op":"status","id":sid})).unwrap();
            if loaded["state"] != "loading" {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(loaded["tables"][0]["thresholds"], thresholds);
        assert!(action(
            &manager,
            serde_json::json!({"op":"thresholds","id":sid,"table":0,"thresholds":[]})
        )
        .is_err());
        manager.close("editor");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
