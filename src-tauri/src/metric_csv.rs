//! Finished-file metric imports. No target/process control and no producer writes.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    sync::atomic::{AtomicBool, Ordering},
};

pub const MAX_ROWS: usize = 2_000_000;
pub const MAX_BYTES: u64 = 1_073_741_824;
pub const MAX_MEMORY: usize = 512 * 1024 * 1024;
const MAX_RECORD: usize = 1024 * 1024;
const MAX_COLUMNS: usize = 128;
const MAGIC: &[u8; 8] = b"CRMET001";

fn regular_file(path: &str) -> Result<File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    // Nonblocking open prevents a replaced path/FIFO from trapping a worker.
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOCTTY)
        .open(path)
        .map_err(|e| format!("Cannot read {path}: {e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Choose a regular file".into());
    }
    Ok(file)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub numeric: bool,
    pub unit: String,
    pub meaning: String,
    #[serde(default)]
    pub unit_suggested: bool,
    #[serde(default)]
    pub meaning_suggested: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub records: usize,
    pub retained: usize,
    pub invalid: usize,
    pub empty_cells: usize,
    pub unsupported: usize,
    pub unterminated: usize,
    pub missing_columns: usize,
    pub examples: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub kind: String,
    pub column: Option<usize>,
    pub window_seconds: Option<f64>,
}
impl Default for Axis {
    fn default() -> Self {
        Self {
            kind: "ordinal".into(),
            column: None,
            window_seconds: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Threshold {
    pub column: usize,
    pub value: f64,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub source_id: String,
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
    pub sha256: String,
    pub columns: Vec<Column>,
    pub coverage: Coverage,
    pub axis: Axis,
    pub generation: u32,
    pub interpretation_revision: u32,
    pub completion: String,
    pub schema_sidecar: Option<String>,
    pub snapshot: bool,
    pub original_range: Option<[usize; 2]>,
    #[serde(default)]
    pub thresholds: Vec<Threshold>,
}
pub enum Values {
    Numbers(Vec<f64>),
    Text { ends: Vec<u32>, bytes: Vec<u8> },
}
pub struct Table {
    pub meta: Metadata,
    pub lines: Vec<u32>,
    pub values: Vec<Values>,
    pub axis: Vec<f64>,
}
pub struct Dataset {
    pub tables: Vec<Table>,
}

fn problem(c: &mut Coverage, line: usize, message: &str) {
    if c.examples.len() < 20 {
        c.examples.push(format!("Line {line}: {message}"));
    }
}
fn number(s: &str) -> Option<f64> {
    s.trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
        // Binary64 charts must not silently round large integer counters.
        .filter(|n| n.fract() != 0. || n.abs() <= 9_007_199_254_740_991.)
}
fn suggestions(name: &str) -> (Option<String>, bool) {
    const STATS: &[&str] = &[
        "mean", "avg", "min", "max", "sum", "total", "p50", "p90", "p95", "p99", "p999",
    ];
    const UNITS: &[&str] = &["kb_s", "bytes", "pct", "ms", "us", "hz", "kb", "s"];
    let literal = name.to_ascii_lowercase();
    let (base, statistic) = literal
        .rsplit_once('_')
        .filter(|(base, suffix)| !base.is_empty() && STATS.contains(suffix))
        .map_or((literal.as_str(), false), |(base, _)| (base, true));
    // Stacked statistics and competing unit tokens are ambiguous. Keep the header literal.
    if statistic
        && base
            .rsplit_once('_')
            .is_some_and(|(_, suffix)| STATS.contains(&suffix))
    {
        return (None, false);
    }
    let found = UNITS.iter().find_map(|unit| {
        base.strip_suffix(&format!("_{unit}"))
            .filter(|prefix| !prefix.trim_matches('_').is_empty())
            .map(|prefix| (*unit, prefix))
    });
    if let Some((unit, prefix)) = found {
        if prefix.split('_').any(|token| UNITS.contains(&token)) {
            return (None, false);
        }
        return (Some(unit.into()), statistic);
    }
    (None, statistic)
}

/// Build one explicit bulk edit; the caller applies it through the normal atomic
/// interpretation/join validation. None selects only currently unitless numeric columns.
pub fn bulk_columns(
    columns: &[Column],
    selection: Option<&[usize]>,
    unit: &str,
    meaning: Option<&str>,
) -> Result<Vec<Column>, String> {
    let unit = unit.trim();
    if unit.is_empty()
        || unit.len() > 80
        || meaning.is_some_and(|m| {
            !["unknown", "gauge", "counter", "rate", "window statistic"].contains(&m)
        })
    {
        return Err("Choose a nonempty unit (up to 80 bytes) and a valid optional meaning".into());
    }
    let indices: Vec<_> = match selection {
        Some(selected) => selected.to_vec(),
        None => columns
            .iter()
            .enumerate()
            .filter(|(_, c)| c.numeric && c.unit == "unitless")
            .map(|(i, _)| i)
            .collect(),
    };
    if indices.is_empty() {
        return Err("Choose numeric columns, or a group with unitless numeric columns".into());
    }
    let mut seen = std::collections::HashSet::new();
    for &i in &indices {
        if !seen.insert(i) || !columns.get(i).is_some_and(|c| c.numeric) {
            return Err(
                "Bulk selection must contain distinct numeric columns in this file group".into(),
            );
        }
    }
    let mut result = columns.to_vec();
    for i in indices {
        result[i].unit = unit.into();
        result[i].unit_suggested = false;
        if let Some(meaning) = meaning {
            result[i].meaning = meaning.into();
            result[i].meaning_suggested = false;
        }
    }
    Ok(result)
}
// Record boundaries are tracked separately so unsupported multiline records are
// consumed as ONE rejected record, never shifted into subsequent columns.
fn fields(line: &str) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    let mut value = String::new();
    let mut chars = line.chars().peekable();
    let mut quoted = false;
    let mut closed = false;
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    value.push('"');
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                value.push(c);
            }
        } else if c == ',' {
            fields.push(std::mem::take(&mut value));
            closed = false;
        } else if c == '"' && value.is_empty() && !closed {
            quoted = true;
        } else if closed || c == '"' {
            return Err("Malformed quoting".into());
        } else {
            value.push(c);
        }
    }
    if quoted {
        return Err("Unterminated quoted field".into());
    }
    fields.push(value);
    Ok(fields)
}

impl Table {
    pub fn memory_bytes(&self) -> usize {
        self.lines.capacity() * 4
            + self.axis.capacity() * 8
            + self
                .values
                .iter()
                .map(|v| match v {
                    Values::Numbers(n) => n.capacity() * 8,
                    Values::Text { ends, bytes } => ends.capacity() * 4 + bytes.capacity(),
                })
                .sum::<usize>()
    }
    pub fn cell(&self, row: usize, col: usize) -> Option<serde_json::Value> {
        if row >= self.lines.len() {
            return None;
        }
        match self.values.get(col)? {
            Values::Numbers(v) => Some(if v[row].is_nan() {
                serde_json::Value::Null
            } else {
                serde_json::json!(v[row])
            }),
            Values::Text { ends, bytes } => {
                let start = if row == 0 { 0 } else { ends[row - 1] as usize };
                Some(serde_json::json!(std::str::from_utf8(
                    &bytes[start..ends[row] as usize]
                )
                .ok()?))
            }
        }
    }
    pub fn numeric(&self, row: usize, col: usize) -> Option<f64> {
        match self.values.get(col)? {
            Values::Numbers(v) => v.get(row).copied().filter(|v| v.is_finite()),
            _ => None,
        }
    }
    fn interpretation_values(
        &self,
        mut columns: Vec<Column>,
        axis: &Axis,
    ) -> Result<(Vec<Column>, Vec<f64>), String> {
        if self.meta.snapshot {
            return Err(
                "Snapshot interpretation is immutable; import the original as a new source to edit"
                    .into(),
            );
        }
        if columns.len() != self.meta.columns.len() {
            return Err("Column schema changed".into());
        }
        for (a, b) in columns.iter().zip(&self.meta.columns) {
            if a.name != b.name || a.numeric != b.numeric {
                return Err("Column names/storage kinds cannot be changed".into());
            }
            if a.unit.len() > 80
                || !["gauge", "counter", "rate", "window statistic", "unknown"]
                    .contains(&a.meaning.as_str())
            {
                return Err("Invalid column meaning/unit".into());
            }
        }
        for (column, old) in columns.iter_mut().zip(&self.meta.columns) {
            column.unit_suggested &= old.unit_suggested && column.unit == old.unit;
            column.meaning_suggested &= old.meaning_suggested && column.meaning == old.meaning;
        }
        let times = self.axis_values_with(axis, &columns)?;
        Ok((columns, times))
    }
    pub fn preview_interpretation(
        &self,
        columns: Vec<Column>,
        axis: &Axis,
    ) -> Result<serde_json::Value, String> {
        let (columns, times) = self.interpretation_values(columns, axis)?;
        let n = self.lines.len();
        Ok(serde_json::json!({"columns":columns,"axis":axis,"rows":n,
            "firstX":if n==0 {None}else{Some(times.first().copied().unwrap_or((1+self.meta.original_range.map(|r|r[0]).unwrap_or(0)) as f64))},
            "lastX":if n==0 {None}else{Some(times.last().copied().unwrap_or((n+self.meta.original_range.map(|r|r[0]).unwrap_or(0)) as f64))},
            "basis":"Preview only; rows, saved interpretation and snapshots are unchanged"}))
    }
    pub fn interpret(&mut self, columns: Vec<Column>, axis: Axis) -> Result<(), String> {
        let (columns, times) = self.interpretation_values(columns, &axis)?;
        self.meta.columns = columns;
        self.meta.axis = axis;
        self.axis = times;
        self.meta.interpretation_revision += 1;
        Ok(())
    }
    fn axis_values(&self, axis: &Axis) -> Result<Vec<f64>, String> {
        self.axis_values_with(axis, &self.meta.columns)
    }
    fn axis_values_with(&self, axis: &Axis, columns: &[Column]) -> Result<Vec<f64>, String> {
        if axis
            .window_seconds
            .is_some_and(|v| !v.is_finite() || v <= 0.)
        {
            return Err("Window duration must be positive seconds".into());
        }
        if axis.kind == "ordinal" {
            if axis.window_seconds.is_some() {
                return Err("Ordinal axes cannot declare a time window".into());
            }
            return Ok(Vec::new());
        }
        if !["elapsed", "epoch", "iso8601"].contains(&axis.kind.as_str()) {
            return Err("Unknown clock domain".into());
        }
        let col = axis
            .column
            .filter(|c| *c < self.values.len())
            .ok_or("Choose a named time column")?;
        let scale = if axis.kind == "iso8601" {
            1.
        } else {
            match columns[col].unit.as_str() {
                "s" | "unitless" => 1.,
                "ms" => 0.001,
                "us" => 0.000001,
                _ => return Err("Time column must use s, ms, us or unitless (seconds)".into()),
            }
        };
        let mut times = Vec::with_capacity(self.lines.len());
        for i in 0..self.lines.len() {
            let t = if axis.kind == "iso8601" {
                self.cell(i, col)
                    .and_then(|v| v.as_str().and_then(iso_seconds))
            } else {
                self.numeric(i, col).map(|v| v * scale)
            }
            .filter(|v| v.is_finite())
            .ok_or_else(|| format!("Missing/invalid time at retained row {}", i + 1))?;
            if axis.kind == "elapsed" && t < 0. {
                return Err("Elapsed seconds must be non-negative".into());
            }
            if times.last().is_some_and(|last| *last > t) {
                return Err(
                    "Time column is not monotonic; choose ordinal or another column".into(),
                );
            }
            times.push(t);
        }
        Ok(times)
    }
    pub fn x(&self, row: usize) -> f64 {
        self.axis
            .get(row)
            .copied()
            .unwrap_or((row + self.meta.original_range.map(|r| r[0]).unwrap_or(0) + 1) as f64)
    }
}

// ISO-8601 timestamps require an explicit Z or ±HH:MM offset. No local-time guess.
fn iso_seconds(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    if b.len() < 20
        || b.get(4) != Some(&b'-')
        || b.get(7) != Some(&b'-')
        || ![b'T', b't'].contains(b.get(10)?)
        || b.get(13) != Some(&b':')
        || b.get(16) != Some(&b':')
    {
        return None;
    }
    let n = |a: usize, z: usize| {
        let value = s.get(a..z)?;
        if !value.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        value.parse::<i64>().ok()
    };
    let year = n(0, 4)?;
    let month = n(5, 7)?;
    let day = n(8, 10)?;
    let hour = n(11, 13)?;
    let min = n(14, 16)?;
    let (end, offset) = if s.ends_with('Z') || s.ends_with('z') {
        (s.len() - 1, 0)
    } else {
        let at = s.len().checked_sub(6)?;
        let sign = *b.get(at)?;
        if ![b'+', b'-'].contains(&sign) || b.get(at + 3) != Some(&b':') {
            return None;
        }
        let h = n(at + 1, at + 3)?;
        let m = n(at + 4, at + 6)?;
        if h > 23 || m > 59 {
            return None;
        }
        (at, (h * 3600 + m * 60) * if sign == b'+' { 1 } else { -1 })
    };
    let seconds = s.get(17..end)?;
    if seconds.len() < 2
        || !seconds.as_bytes()[..2].iter().all(u8::is_ascii_digit)
        || seconds.len() > 2
            && (seconds.as_bytes()[2] != b'.'
                || seconds.len() == 3
                || !seconds.as_bytes()[3..].iter().all(u8::is_ascii_digit))
    {
        return None;
    }
    let sec = seconds.parse::<f64>().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1..=12).contains(&month)
        || day < 1
        || day > days[(month - 1) as usize]
        || hour > 23
        || min > 59
        || !(0. ..60.).contains(&sec)
    {
        return None;
    }
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = y.div_euclid(400);
    let yo = y - era * 400;
    let m = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * m + 2) / 5 + day - 1;
    let epoch_days = era * 146097 + yo * 365 + yo / 4 - yo / 100 + doy - 719468;
    Some((epoch_days * 86400 + hour * 3600 + min * 60 - offset) as f64 + sec)
}

#[allow(dead_code)] // Standalone fixture entry point; the IDE supplies a file-set budget.
pub fn parse(
    path: &str,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<Table, String> {
    parse_limited(path, cancelled, &mut progress, MAX_MEMORY)
}
pub fn parse_limited(
    path: &str,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
    memory_limit: usize,
) -> Result<Table, String> {
    let file = regular_file(path)?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > MAX_BYTES {
        return Err("Import requires a regular file of at most 1 GiB".into());
    }
    let size = before.len();
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut hash = Sha256::new();
    let mut raw = Vec::new();
    let mut bytes_read = 0u64;
    let mut line_no = 0u32;
    let mut table = Table {
        meta: Metadata {
            source_id: String::new(),
            path: path.into(),
            size,
            modified_ms: before
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            sha256: String::new(),
            columns: Vec::new(),
            coverage: Coverage::default(),
            axis: Axis::default(),
            generation: 1,
            interpretation_revision: 1,
            completion: "complete".into(),
            schema_sidecar: None,
            snapshot: false,
            original_range: None,
            thresholds: Vec::new(),
        },
        lines: Vec::new(),
        values: Vec::new(),
        axis: Vec::new(),
    };
    let mut kinds: Vec<Option<bool>> = Vec::new();
    let mut multiline = false;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Import cancelled".into());
        }
        raw.clear();
        // `take` bounds even malicious lines without newlines.
        let count = reader
            .by_ref()
            .take((MAX_RECORD + 1) as u64)
            .read_until(b'\n', &mut raw)
            .map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if count > MAX_RECORD {
            return Err("CSV line exceeds 1 MiB limit".into());
        }
        bytes_read += count as u64;
        if bytes_read > size {
            return Err(
                "File grew during finished-file import; retry a stable file (follow is M2)".into(),
            );
        }
        hash.update(&raw);
        line_no += 1;
        if line_no % 4096 == 0 {
            progress(bytes_read, size);
        }
        let terminated = raw.last() == Some(&b'\n');
        if terminated {
            raw.pop();
            if raw.last() == Some(&b'\r') {
                raw.pop();
            }
        }
        if raw.iter().any(|b| *b == 0) {
            return Err("CSV contains NUL bytes".into());
        }
        let text = std::str::from_utf8(&raw).map_err(|_| "CSV must be UTF-8")?;
        if line_no == 1 {
            let header = fields(text.trim_start_matches('\u{feff}'))?;
            if header.is_empty()
                || header.len() > MAX_COLUMNS
                || header.iter().any(|s| s.is_empty())
            {
                return Err("Header requires 1–128 nonempty column names".into());
            }
            let mut unique = std::collections::HashSet::new();
            if header.iter().any(|h| !unique.insert(h)) {
                return Err("Duplicate column names".into());
            }
            table.meta.columns = header
                .iter()
                .map(|name| {
                    let (unit, statistic) = suggestions(name);
                    Column {
                        name: name.clone(),
                        numeric: false,
                        unit_suggested: unit.is_some(),
                        unit: unit.unwrap_or_else(|| "unitless".into()),
                        meaning: if statistic {
                            "window statistic"
                        } else {
                            "unknown"
                        }
                        .into(),
                        meaning_suggested: statistic,
                    }
                })
                .collect();
            kinds = vec![None; header.len()];
            table.values = (0..header.len())
                .map(|_| Values::Numbers(Vec::new()))
                .collect();
            continue;
        }
        // Escaped quotes contribute an even number; quoted multiline fields
        // remain unsupported and are discarded through their closing newline.
        let odd = text.bytes().filter(|c| *c == b'"').count() % 2 == 1;
        if multiline {
            if odd {
                multiline = false;
            }
            continue;
        }
        table.meta.coverage.records += 1;
        if !terminated {
            table.meta.coverage.unterminated += 1;
        }
        let row = match fields(text) {
            Ok(v) => v,
            Err(e) if e == "Unterminated quoted field" => {
                multiline = true;
                table.meta.coverage.unsupported += 1;
                problem(
                    &mut table.meta.coverage,
                    line_no as usize,
                    "Multiline or unterminated quoted record unsupported",
                );
                continue;
            }
            Err(e) => {
                table.meta.coverage.invalid += 1;
                problem(&mut table.meta.coverage, line_no as usize, &e);
                continue;
            }
        };
        if row.len() != kinds.len() {
            table.meta.coverage.invalid += 1;
            table.meta.coverage.missing_columns += kinds.len().saturating_sub(row.len());
            problem(
                &mut table.meta.coverage,
                line_no as usize,
                "Wrong field count; entire record skipped",
            );
            continue;
        }
        let mut invalid = false;
        for (i, v) in row.iter().enumerate() {
            if v.is_empty() {
                continue;
            }
            if kinds[i] == Some(true) && number(v).is_none() {
                invalid = true;
                break;
            }
        }
        if invalid {
            table.meta.coverage.invalid += 1;
            problem(
                &mut table.meta.coverage,
                line_no as usize,
                "Non-numeric/non-finite or unsafe-integer value in numeric column; entire record skipped",
            );
            continue;
        }
        if table.lines.len() >= MAX_ROWS {
            return Err("Import exceeds 2,000,000 retained rows".into());
        }
        for (i, value) in row.iter().enumerate() {
            if value.is_empty() {
                table.meta.coverage.empty_cells += 1;
            }
            if kinds[i].is_none() && !value.is_empty() {
                let numeric = number(value).is_some();
                kinds[i] = Some(numeric);
                table.meta.columns[i].numeric = numeric;
                if !numeric {
                    table.values[i] = Values::Text {
                        ends: vec![0; table.lines.len()],
                        bytes: Vec::new(),
                    };
                }
            }
            match &mut table.values[i] {
                Values::Numbers(v) => {
                    if v.len() == v.capacity() {
                        v.reserve_exact(8192);
                    }
                    v.push(number(value).unwrap_or(f64::NAN));
                }
                Values::Text { ends, bytes } => {
                    if ends.len() == ends.capacity() {
                        ends.reserve_exact(8192);
                    }
                    bytes.extend_from_slice(value.as_bytes());
                    ends.push(bytes.len() as u32);
                }
            }
        }
        if table.lines.len() == table.lines.capacity() {
            table.lines.reserve_exact(8192);
        }
        table.lines.push(line_no);
        if table.memory_bytes() > memory_limit {
            return Err("File set exceeds 512 MiB retained-memory limit".into());
        }
    }
    if table.meta.columns.is_empty() {
        return Err("CSV has no header".into());
    }
    for (column, values) in table.meta.columns.iter_mut().zip(&table.values) {
        column.numeric = matches!(values, Values::Numbers(_));
        if !column.numeric {
            column.meaning = "unknown".into();
            column.meaning_suggested = false;
        }
    }
    if multiline && table.meta.coverage.unterminated == 0 {
        table.meta.coverage.unterminated += 1;
    }
    let after = reader.get_ref().metadata().map_err(|e| e.to_string())?;
    let named = fs::metadata(path).map_err(|e| format!("File disappeared during import: {e}"))?;
    use std::os::unix::fs::MetadataExt;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || before.ino() != named.ino()
        || before.dev() != named.dev()
    {
        return Err("File changed/replaced during finished-file import".into());
    }
    table.meta.coverage.retained = table.lines.len();
    table.meta.sha256 = format!("{:x}", hash.finalize());
    table.meta.source_id = format!("csv:{}", table.meta.sha256);
    if table.meta.coverage.invalid + table.meta.coverage.unsupported > 0 {
        table.meta.completion = "partial".into();
    }
    if table.memory_bytes() > memory_limit {
        return Err("File set exceeds 512 MiB retained-memory limit".into());
    }
    progress(bytes_read, size);
    Ok(table)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRule {
    pub left: usize,
    pub right: usize,
    pub left_column: usize,
    pub right_column: usize,
    pub tolerance: Option<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub index: usize,
    pub line: u32,
    pub x: f64,
    pub cells: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub truncated_columns: Vec<usize>,
}
impl Table {
    pub fn row(&self, i: usize) -> Result<Row, String> {
        if i >= self.lines.len() {
            return Err("Row outside retained range".into());
        }
        Ok(Row {
            index: i,
            truncated_columns: Vec::new(),
            line: self.lines[i],
            x: self.x(i),
            cells: (0..self.values.len())
                .map(|c| self.cell(i, c).unwrap_or_default())
                .collect(),
        })
    }
}
/// Bounded original rows for the editor table. Never materialize the entire file in IPC.
pub fn page(t: &Table, start: usize, count: usize) -> Result<Vec<Row>, String> {
    if count == 0 || count > 100 || start > t.lines.len() {
        return Err("Row pages allow 1–100 rows inside the retained range".into());
    }
    (start..start.saturating_add(count).min(t.lines.len()))
        .map(|i| {
            let mut row = t.row(i)?;
            for (index, cell) in row.cells.iter_mut().enumerate() {
                if let serde_json::Value::String(text) = cell {
                    if text.chars().count() > 160 {
                        *text = text.chars().take(160).collect::<String>() + "…";
                        row.truncated_columns.push(index);
                    }
                }
            }
            Ok(row)
        })
        .collect()
}
/// Time axes are validated monotonic; ordinal axes use the same lower-bound search.
pub fn nearest(t: &Table, start: usize, end: usize, x: f64) -> Result<usize, String> {
    let end = end.min(t.lines.len());
    if !x.is_finite() || start >= end {
        return Err("Invalid point selection range".into());
    }
    let (mut lo, mut hi) = (start, end);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if t.x(mid) < x {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if lo == start {
        return Ok(start);
    }
    if lo == end {
        return Ok(end - 1);
    }
    Ok(if (t.x(lo) - x).abs() < (t.x(lo - 1) - x).abs() {
        lo
    } else {
        lo - 1
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinedRow {
    pub table: usize,
    pub state: String,
    pub row: Option<Row>,
}
pub fn companions(
    data: &Dataset,
    table: usize,
    row: usize,
    rules: &[JoinRule],
) -> Result<Vec<JoinedRow>, String> {
    let left = data.tables.get(table).ok_or("Unknown file group")?;
    if row >= left.lines.len() {
        return Err("Row outside retained range".into());
    }
    let mut output = Vec::new();
    for rule in rules {
        if rule.left != table {
            continue;
        }
        let right = data
            .tables
            .get(rule.right)
            .ok_or("Unknown companion group")?;
        if rule.left == rule.right
            || rule.left_column >= left.values.len()
            || rule.right_column >= right.values.len()
        {
            return Err("Invalid named-column join".into());
        }
        if rule.tolerance.is_some_and(|v| !v.is_finite() || v < 0.) {
            return Err("Join tolerance must be finite and nonnegative".into());
        }
        if rule.tolerance.is_some()
            && (!left.meta.columns[rule.left_column].numeric
                || !right.meta.columns[rule.right_column].numeric
                || left.meta.columns[rule.left_column].unit
                    != right.meta.columns[rule.right_column].unit)
        {
            return Err(
                "Toleranced join requires numeric columns with identical declared units".into(),
            );
        }
        let key = left.cell(row, rule.left_column).unwrap_or_default();
        let mut found = None;
        let mut ambiguous = false;
        if !key.is_null() && key != serde_json::json!("") {
            for i in 0..right.lines.len() {
                let matches = if let Some(t) = rule.tolerance {
                    key.as_f64()
                        .zip(right.numeric(i, rule.right_column))
                        .is_some_and(|(a, b)| (a - b).abs() <= t)
                } else {
                    right.cell(i, rule.right_column).is_some_and(|v| v == key)
                };
                if matches {
                    if found.is_some() {
                        ambiguous = true;
                        break;
                    }
                    found = Some(i);
                }
            }
        }
        output.push(JoinedRow {
            table: rule.right,
            state: if ambiguous {
                "ambiguous"
            } else if found.is_some() {
                "joined"
            } else {
                "unjoined"
            }
            .into(),
            row: if ambiguous {
                None
            } else {
                found.map(|i| right.row(i)).transpose()?
            },
        });
    }
    Ok(output)
}

#[derive(Serialize)]
pub struct Point {
    pub x: f64,
    pub until: f64,
    pub min: f64,
    pub max: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vertex {
    pub row: usize,
    pub x: f64,
    pub value: f64,
    pub break_before: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub column: usize,
    pub points: Vec<Point>,
    pub vertices: Vec<Vertex>,
    pub start: usize,
    pub end: usize,
    pub x_start: f64,
    pub x_end: f64,
}
pub fn graph(t: &Table, column: usize, start: usize, end: usize) -> Result<Graph, String> {
    let Some(Values::Numbers(values)) = t.values.get(column) else {
        return Err("Choose a numeric series".into());
    };
    let end = end.min(t.lines.len());
    if start >= end {
        return Err("Empty row range".into());
    }
    let step = (end - start).div_ceil(600);
    let mut points = Vec::with_capacity(600);
    let mut vertices = Vec::with_capacity(2400);
    let mut previous: Option<usize> = None;
    for from in (start..end).step_by(step) {
        let to = (from + step).min(end);
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        let mut first = None;
        let mut last = None;
        let mut low = from;
        let mut high = from;
        for (offset, v) in values[from..to].iter().enumerate() {
            let index = from + offset;
            if v.is_finite() {
                first.get_or_insert(index);
                last = Some(index);
                if *v < min {
                    min = *v;
                    low = index;
                }
                if *v > max {
                    max = *v;
                    high = index;
                }
            }
        }
        if let (Some(first), Some(last)) = (first, last) {
            let mut indices = vec![first, low, high, last];
            indices.sort_unstable();
            indices.dedup();
            for row in indices {
                let break_before = previous.is_none_or(|prev| {
                    values[prev + 1..row].iter().any(|v| !v.is_finite())
                        || t.lines[row].saturating_sub(t.lines[prev]) as usize > row - prev
                });
                vertices.push(Vertex {
                    row,
                    x: t.x(row),
                    value: values[row],
                    break_before,
                });
                previous = Some(row);
            }
            points.push(Point {
                x: t.x(from),
                until: t.x(to - 1),
                min,
                max,
            });
        }
    }
    Ok(Graph {
        column,
        points,
        vertices,
        start,
        end,
        x_start: t.x(start),
        x_end: t.x(end - 1),
    })
}
pub fn worst(
    t: &Table,
    column: usize,
    start: usize,
    end: usize,
    count: usize,
) -> Result<Vec<Row>, String> {
    let Some(Values::Numbers(values)) = t.values.get(column) else {
        return Err("Choose a numeric series".into());
    };
    let end = end.min(values.len());
    if start > end {
        return Err("Invalid range".into());
    }
    // Small bounded heap gives exact top N without sorting/copying a million rows.
    #[derive(PartialEq)]
    struct Entry(f64, usize);
    impl Eq for Entry {}
    impl PartialOrd for Entry {
        fn partial_cmp(&self, b: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(b))
        }
    }
    impl Ord for Entry {
        fn cmp(&self, b: &Self) -> std::cmp::Ordering {
            self.0.total_cmp(&b.0).then_with(|| b.1.cmp(&self.1))
        }
    }
    let mut heap = std::collections::BinaryHeap::new();
    let count = count.clamp(1, 100);
    for (i, v) in values.iter().enumerate().take(end).skip(start) {
        if !v.is_finite() {
            continue;
        }
        let entry = Entry(*v, i);
        if heap.len() < count {
            heap.push(std::cmp::Reverse(entry));
        } else if heap
            .peek()
            .is_some_and(|e: &std::cmp::Reverse<Entry>| entry > e.0)
        {
            heap.pop();
            heap.push(std::cmp::Reverse(entry));
        }
    }
    let mut entries: Vec<_> = heap.into_iter().map(|e| e.0).collect();
    entries.sort_by(|a, b| b.cmp(a));
    entries.into_iter().map(|e| t.row(e.1)).collect()
}

#[derive(Serialize, Deserialize)]
struct SnapshotHeader {
    version: u32,
    tables: Vec<Metadata>,
    rows: Vec<usize>,
    joins: Vec<JoinRule>,
}
fn put_u64(w: &mut impl Write, n: u64) -> Result<(), String> {
    w.write_all(&n.to_le_bytes()).map_err(|e| e.to_string())
}
fn get_u64(r: &mut impl Read) -> Result<u64, String> {
    let mut b = [0; 8];
    r.read_exact(&mut b).map_err(|e| e.to_string())?;
    Ok(u64::from_le_bytes(b))
}
pub fn save(
    data: &Dataset,
    rules: &[JoinRule],
    path: &str,
    ranges: &[[usize; 2]],
    cancel: &AtomicBool,
) -> Result<(), String> {
    if ranges.len() != data.tables.len() {
        return Err("Choose a row range for each file group".into());
    }
    for (t, [a, b]) in data.tables.iter().zip(ranges) {
        if a > b || *b > t.lines.len() {
            return Err("Invalid snapshot range".into());
        }
    }
    let mut meta: Vec<_> = data
        .tables
        .iter()
        .zip(ranges)
        .map(|(t, r)| {
            let mut m = t.meta.clone();
            m.snapshot = true;
            let base = t.meta.original_range.map(|r| r[0]).unwrap_or(0);
            m.original_range = Some([base + r[0], base + r[1]]);
            m.coverage.retained = r[1] - r[0];
            m
        })
        .collect();
    // Provenance and original counters survive; retained count states the copy's scope.
    let header = serde_json::to_vec(&SnapshotHeader {
        version: 1,
        tables: std::mem::take(&mut meta),
        rows: ranges.iter().map(|r| r[1] - r[0]).collect(),
        joins: rules.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    // create_new prevents replacing either a producer file or an existing snapshot.
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Snapshot needs a new path: {e}"))?;
    let result = (|| {
        let mut w = BufWriter::new(file);
        w.write_all(MAGIC).map_err(|e| e.to_string())?;
        put_u64(&mut w, header.len() as u64)?;
        w.write_all(&header).map_err(|e| e.to_string())?;
        for (table, [start, end]) in data.tables.iter().zip(ranges) {
            for line in &table.lines[*start..*end] {
                w.write_all(&line.to_le_bytes())
                    .map_err(|e| e.to_string())?;
            }
            for values in &table.values {
                if cancel.load(Ordering::Relaxed) {
                    return Err("Snapshot cancelled".into());
                }
                match values {
                    Values::Numbers(v) => {
                        for value in &v[*start..*end] {
                            w.write_all(&value.to_le_bytes())
                                .map_err(|e| e.to_string())?;
                        }
                    }
                    Values::Text { ends, bytes } => {
                        let first = if *start == 0 { 0 } else { ends[start - 1] };
                        let last = if *end == 0 { 0 } else { ends[end - 1] };
                        put_u64(&mut w, (last - first) as u64)?;
                        for end in &ends[*start..*end] {
                            w.write_all(&(end - first).to_le_bytes())
                                .map_err(|e| e.to_string())?;
                        }
                        w.write_all(&bytes[first as usize..last as usize])
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        w.flush().map_err(|e| e.to_string())?;
        if w.get_ref().metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {
            return Err("Snapshot exceeds 1 GiB limit".into());
        }
        w.get_ref().sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}
pub fn load(path: &str, cancel: &AtomicBool) -> Result<(Dataset, Vec<JoinRule>), String> {
    let file = regular_file(path)?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_BYTES {
        return Err("Snapshot exceeds 1 GiB".into());
    }
    let mut r = BufReader::new(file);
    let mut magic = [0; 8];
    r.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if &magic != MAGIC {
        return Err("Not a metric snapshot version 1".into());
    }
    let length = get_u64(&mut r)?;
    if length > 1024 * 1024 {
        return Err("Snapshot metadata exceeds limit".into());
    }
    let mut raw = vec![0; length as usize];
    r.read_exact(&mut raw).map_err(|e| e.to_string())?;
    let header: SnapshotHeader = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    if header.version != 1
        || header.tables.is_empty()
        || header.tables.len() > 8
        || header.tables.len() != header.rows.len()
        || header.joins.len() > 8
    {
        return Err("Invalid snapshot schema".into());
    }
    let mut tables = Vec::new();
    let mut budget = 0usize;
    for (meta, rows) in header.tables.into_iter().zip(header.rows) {
        if rows > MAX_ROWS
            || meta.columns.is_empty()
            || meta.columns.len() > MAX_COLUMNS
            || !meta.snapshot
            || meta.coverage.retained != rows
        {
            return Err("Invalid snapshot table".into());
        }
        budget = budget
            .checked_add(
                rows.checked_mul(4 + meta.columns.len() * 8)
                    .ok_or("Snapshot memory overflow")?,
            )
            .ok_or("Snapshot memory overflow")?;
        if budget > MAX_MEMORY {
            return Err("Snapshot exceeds retained-memory limit".into());
        }
        let mut lines = vec![0u32; rows];
        for line in &mut lines {
            let mut b = [0; 4];
            r.read_exact(&mut b).map_err(|e| e.to_string())?;
            *line = u32::from_le_bytes(b);
        }
        let mut values = Vec::new();
        for col in &meta.columns {
            if cancel.load(Ordering::Relaxed) {
                return Err("Snapshot open cancelled".into());
            }
            if col.numeric {
                let mut v = vec![0.; rows];
                for n in &mut v {
                    let mut b = [0; 8];
                    r.read_exact(&mut b).map_err(|e| e.to_string())?;
                    *n = f64::from_le_bytes(b);
                    if n.is_infinite() {
                        return Err("Invalid snapshot numeric value".into());
                    }
                }
                values.push(Values::Numbers(v));
            } else {
                let len = get_u64(&mut r)?;
                if len > MAX_MEMORY as u64 {
                    return Err("Snapshot text exceeds limit".into());
                }
                budget = budget
                    .checked_add(len as usize)
                    .ok_or("Snapshot memory overflow")?;
                if budget > MAX_MEMORY {
                    return Err("Snapshot exceeds retained-memory limit".into());
                }
                let mut ends = vec![0u32; rows];
                let mut previous = 0;
                for e in &mut ends {
                    let mut b = [0; 4];
                    r.read_exact(&mut b).map_err(|e| e.to_string())?;
                    *e = u32::from_le_bytes(b);
                    if *e < previous || *e as u64 > len {
                        return Err("Invalid snapshot text offsets".into());
                    }
                    previous = *e;
                }
                if previous as u64 != len {
                    return Err("Invalid snapshot text length".into());
                }
                let mut bytes = vec![0; len as usize];
                r.read_exact(&mut bytes).map_err(|e| e.to_string())?;
                let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid UTF-8 snapshot")?;
                if ends.iter().any(|e| !text.is_char_boundary(*e as usize)) {
                    return Err("Invalid text boundary".into());
                }
                values.push(Values::Text { ends, bytes });
            }
        }
        let mut table = Table {
            meta,
            lines,
            values,
            axis: Vec::new(),
        };
        table.axis = table.axis_values(&table.meta.axis)?;
        tables.push(table);
    }
    let mut extra = [0];
    if r.read(&mut extra).map_err(|e| e.to_string())? != 0 {
        return Err("Trailing snapshot bytes".into());
    }
    let data = Dataset { tables };
    if data.tables.iter().map(Table::memory_bytes).sum::<usize>() > MAX_MEMORY {
        return Err("Snapshot exceeds retained-memory limit".into());
    }
    for rule in &header.joins {
        if rule.left >= data.tables.len()
            || rule.right >= data.tables.len()
            || rule.left_column >= data.tables[rule.left].values.len()
            || rule.right_column >= data.tables[rule.right].values.len()
        {
            return Err("Invalid snapshot join rule".into());
        }
    }
    Ok((data, header.joins))
}

/// Exact order statistics of original row values, not reconstructed run percentiles.
pub fn summarize(
    mut columns: Vec<(usize, Vec<f64>)>,
    total_rows: usize,
    cancelled: &AtomicBool,
) -> Result<serde_json::Value, String> {
    let mut result = Vec::new();
    for (column, mut values) in columns.drain(..) {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Summary cancelled".into());
        }
        values.retain(|v| v.is_finite());
        let count = values.len();
        let quantile = |values: &mut Vec<f64>, q: f64| -> Option<f64> {
            if values.is_empty() {
                return None;
            }
            let pos = (values.len() - 1) as f64 * q;
            let lower = pos.floor() as usize;
            let upper = pos.ceil() as usize;
            let low = *values
                .select_nth_unstable_by(lower, |a, b| a.total_cmp(b))
                .1;
            let high = *values
                .select_nth_unstable_by(upper, |a, b| a.total_cmp(b))
                .1;
            Some(low + (high - low) * (pos - lower as f64))
        };
        let median = quantile(&mut values, 0.5);
        let q1 = quantile(&mut values, 0.25);
        let q3 = quantile(&mut values, 0.75);
        let maximum = values.iter().copied().reduce(f64::max);
        result.push(serde_json::json!({"column":column,"count":count,"missing":total_rows-count,"median":median,"q1":q1,"q3":q3,"maximum":maximum}));
    }
    Ok(
        serde_json::json!({"columns":result,"rows":total_rows,"basis":"Original retained row values; linear-interpolated order statistics, never a run percentile"}),
    )
}
