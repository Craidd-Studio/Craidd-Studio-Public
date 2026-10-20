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
            | Request::Graph { id, .. }
            | Request::Worst { id, .. }
            | Request::Interpret { id, .. }
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
        let mut guard = job.data.lock().map_err(|e| e.to_string())?;
        let data = guard.as_mut().ok_or("Source is not ready")?;
        let table = |i: usize| {
            data.tables
                .get(i)
                .ok_or_else(|| "Unknown file group".to_string())
        };
        let json = |v| serde_json::to_value(v).map_err(|e| e.to_string());
        match request {
            Request::Row { table: i, row, .. } => Ok(
                serde_json::json!({"row":table(i)?.row(row)?,"companions":csv::companions(data,i,row,&job.joins.lock().map_err(|e|e.to_string())?)?}),
            ),
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
                if columns.len() != table(i)?.meta.columns.len() {
                    return Err("Column schema changed".into());
                }
                for rule in job
                    .joins
                    .lock()
                    .map_err(|e| e.to_string())?
                    .iter()
                    .filter(|r| r.tolerance.is_some())
                {
                    let left = if rule.left == i {
                        &columns
                    } else {
                        &table(rule.left)?.meta.columns
                    };
                    let right = if rule.right == i {
                        &columns
                    } else {
                        &table(rule.right)?.meta.columns
                    };
                    if left[rule.left_column].unit != right[rule.right_column].unit {
                        return Err("Unit override conflicts with a declared toleranced join; edit or clear that join first".into());
                    }
                }
                data.tables
                    .get_mut(i)
                    .ok_or("Unknown file group")?
                    .interpret(columns, axis)?;
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
}
