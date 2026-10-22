//! Native stack samples. No conversion to process observations, Gold durations or CSV windows.
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    io::{BufRead, Read, Seek, SeekFrom},
};

pub const RAW_CAP: u64 = 512 * 1024 * 1024;
pub const SAMPLE_LIMIT: usize = 500_000;
pub const FRAME_LIMIT: usize = 100_000;
pub const FRAME_TEXT_LIMIT: usize = 16 * 1024 * 1024;
pub const STACK_REF_LIMIT: usize = 8_000_000;
pub const DIAGNOSTIC_LIMIT: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Unwind {
    Fp,
    Dwarf {
        #[serde(rename = "stackBytes")]
        stack_bytes: u32,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub frequency: u32,
    pub duration_seconds: u32,
    pub unwind: Unwind,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            frequency: 99,
            duration_seconds: 10,
            unwind: Unwind::Fp,
        }
    }
}
impl Options {
    pub fn validate(&self) -> Result<(), String> {
        if ![99, 999].contains(&self.frequency) {
            return Err("Choose 99 or 999 Hz; higher rates require overhead qualification".into());
        }
        if !(1..=120).contains(&self.duration_seconds) {
            return Err("Capture duration must be 1–120 seconds".into());
        }
        if let Unwind::Dwarf { stack_bytes } = self.unwind {
            if ![8192, 16384].contains(&stack_bytes) {
                return Err("DWARF stack size must be 8192 or 16384 bytes".into());
            }
        }
        Ok(())
    }
    pub fn call_graph(&self) -> String {
        match self.unwind {
            Unwind::Fp => "fp".into(),
            Unwind::Dwarf { stack_bytes } => format!("dwarf,{stack_bytes}"),
        }
    }
    pub fn estimated_bytes(&self, threads: usize) -> u64 {
        // Measured 8192-byte DWARF: 2,730,260 / 319. Other settings are extrapolations.
        let bytes = match self.unwind {
            Unwind::Fp => 218,
            Unwind::Dwarf { stack_bytes } => u64::from(stack_bytes) + 367,
        };
        bytes
            .saturating_mul(threads as u64)
            .saturating_mul(self.frequency.into())
            .saturating_mul(self.duration_seconds.into())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    pub path: String,
    pub line: u32,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SymbolOrigin {
    #[default]
    PerfReported,
    ElfBuildId,
    PerfMap,
    Unresolved,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub address: String,
    pub symbol: String,
    pub module: String,
    pub resolved: bool,
    #[serde(default)]
    pub symbol_origin: SymbolOrigin,
    pub source: Option<SourceLocation>,
}
#[derive(Clone, Debug)]
pub struct Sample {
    pub pid: u32,
    pub tid: u32,
    pub time_ns: u64,
    pub period: u64,
    pub frames: Vec<u32>,
}
#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub loss_scan_complete: Option<bool>,
    pub parsed_samples: u64,
    pub retained_samples: u64,
    pub omitted_samples: u64,
    pub lost_records: u64,
    pub lost_count: u64,
    pub lost_sample_records: u64,
    pub lost_sample_count: u64,
    pub unparsed_loss_records: u64,
    pub unknown_records: u64,
    pub truncated_stacks: u64,
    pub diagnostics: Vec<String>,
}
impl Coverage {
    pub fn diagnostic(&mut self, text: &str) {
        self.unknown_records += 1;
        if self.diagnostics.len() < DIAGNOSTIC_LIMIT {
            self.diagnostics.push(text.chars().take(1024).collect());
        }
    }
    pub fn partial(&self) -> bool {
        self.loss_scan_complete == Some(false)
            || self.omitted_samples > 0
            || self.lost_records > 0
            || self.lost_sample_records > 0
            || self.unknown_records > 0
            || self.truncated_stacks > 0
    }
}
#[derive(Default, Debug)]
pub struct SampleSet {
    pub frames: Vec<Frame>,
    pub samples: Vec<Sample>,
    pub threads: BTreeMap<u32, String>,
    pub coverage: Coverage,
    pub first_ns: Option<u64>,
    pub last_ns: Option<u64>,
}
impl SampleSet {
    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({"coverage":self.coverage,"frameCount":self.frames.len(),"threads":self.threads,
            "firstMonotonicNs":self.first_ns,"lastMonotonicNs":self.last_ns,
            "units":"sampled cpu-clock event period (ns); not exact function time",
            "lossAccounting":"LOST and LOST_SAMPLES are separate reports and may overlap; never summed",
            "retention":{"samples":SAMPLE_LIMIT,"frames":FRAME_LIMIT,"stackReferences":STACK_REF_LIMIT}})
    }
    /// One branch at a time; path contains frame IDs returned by a prior query.
    pub fn branch(&self, query: &TreeQuery) -> Result<serde_json::Value, String> {
        if query.path.len() > 256 || query.limit == 0 || query.limit > 200 {
            return Err("Tree queries allow a path of 256 frames and 1–200 children".into());
        }
        if query.start_ns.zip(query.end_ns).is_some_and(|(a, b)| a > b) {
            return Err("Invalid capture time range".into());
        }
        let anchor = self.first_ns.unwrap_or(0);
        let mut children: HashMap<u32, (u64, u64, u64)> = HashMap::new();
        let mut total_weight = 0_u64;
        let mut selected_samples = 0_u64;
        let mut path_weight = 0_u64;
        for sample in &self.samples {
            if query.tid.is_some_and(|t| t != sample.tid) {
                continue;
            }
            if query
                .thread_name
                .as_ref()
                .is_some_and(|n| !self.threads.get(&sample.tid).is_some_and(|v| v.contains(n)))
            {
                continue;
            }
            let time = sample.time_ns.saturating_sub(anchor);
            if query.start_ns.is_some_and(|v| time < v) || query.end_ns.is_some_and(|v| time > v) {
                continue;
            }
            if query.module.as_ref().is_some_and(|m| {
                !sample
                    .frames
                    .iter()
                    .any(|i| self.frames[*i as usize].module == *m)
            }) {
                continue;
            }
            total_weight = total_weight.saturating_add(sample.period);
            selected_samples += 1;
            let frame_at = |n: usize| match query.direction {
                Direction::BottomUp => sample.frames[n],
                Direction::TopDown => sample.frames[sample.frames.len() - 1 - n],
            };
            if sample.frames.len() < query.path.len()
                || query
                    .path
                    .iter()
                    .enumerate()
                    .any(|(n, id)| frame_at(n) != *id)
            {
                continue;
            }
            path_weight = path_weight.saturating_add(sample.period);
            if sample.frames.len() == query.path.len() {
                continue;
            }
            let id = frame_at(query.path.len());
            let value = children.entry(id).or_default();
            value.0 = value.0.saturating_add(sample.period);
            value.2 += 1;
            // Only the sampled leaf receives self weight, even in the reversed tree.
            if match query.direction {
                Direction::TopDown => query.path.len() + 1 == sample.frames.len(),
                Direction::BottomUp => query.path.is_empty(),
            } {
                value.1 = value.1.saturating_add(sample.period);
            }
        }
        let count = children.len();
        let mut children: Vec<_> = children.into_iter().collect();
        children.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(a.0.cmp(&b.0)));
        let rows: Vec<_> = children.into_iter().take(query.limit).map(|(id,(inclusive,own,samples))| serde_json::json!({
            "frameId":id,"frame":self.frames[id as usize],"inclusiveWeight":inclusive,"selfWeight":own,
            "sampleCount":samples,"sampledEventSharePct":if total_weight>0 {100.0*inclusive as f64/total_weight as f64}else{0.0}
        })).collect();
        Ok(
            serde_json::json!({"children":rows,"childCount":count,"omittedChildren":count.saturating_sub(query.limit),
            "selectedSamples":selected_samples,"totalWeight":total_weight,"pathWeight":path_weight,
            "moduleFilterBasis":"samples containing this exact module; complete calling context retained",
            "clock":"elapsed ns from first retained monotonic sample; no session clock mapping"}),
        )
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    TopDown,
    BottomUp,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TreeQuery {
    pub direction: Direction,
    #[serde(default)]
    pub path: Vec<u32>,
    pub limit: usize,
    pub tid: Option<u32>,
    pub thread_name: Option<String>,
    pub module: Option<String>,
    pub start_ns: Option<u64>,
    pub end_ns: Option<u64>,
}

fn timestamp(s: &str) -> Option<u64> {
    let (seconds, fraction) = s.split_once('.')?;
    if fraction.len() > 9 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    seconds
        .parse::<u64>()
        .ok()?
        .checked_mul(1_000_000_000)?
        .checked_add(
            fraction
                .parse::<u64>()
                .ok()?
                .checked_mul(10_u64.pow(9 - fraction.len() as u32))?,
        )
}

/// Streaming parser for explicit perf-script fields, leaf-first frames. Malformed records never inherit another sample's stack.
pub fn parse_script(reader: impl BufRead) -> Result<SampleSet, String> {
    let header = Regex::new(
        r"^\s*(.*?)\s+(\d+)(?:/|\s+)(\d+)\s+(\d+\.\d+):\s+(\d+)\s+([^\s]+):(?:\s+(.*))?$",
    )
    .unwrap();
    let mut result = SampleSet::default();
    let mut intern = HashMap::<(String, String, String), u32>::new();
    let mut frame_text_bytes = 0_usize;
    let mut current: Option<Sample> = None;
    let mut refs = 0_usize;
    let mut rejected = false;
    fn finish(set: &mut SampleSet, current: &mut Option<Sample>, refs: &mut usize, rejected: bool) {
        if let Some(s) = current.take() {
            set.coverage.parsed_samples += 1;
            if rejected
                || s.frames.is_empty()
                || set.samples.len() >= SAMPLE_LIMIT
                || *refs + s.frames.len() > STACK_REF_LIMIT
            {
                set.coverage.omitted_samples += 1;
                return;
            }
            set.first_ns = Some(set.first_ns.map_or(s.time_ns, |v| v.min(s.time_ns)));
            set.last_ns = Some(set.last_ns.map_or(s.time_ns, |v| v.max(s.time_ns)));
            *refs += s.frames.len();
            set.samples.push(s);
            set.coverage.retained_samples += 1;
        }
    }
    // take() bounds a single unexpected record, including symbol names.
    let mut reader = reader;
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        let mut bounded = std::io::Read::take(&mut reader, 65537);
        let count = bounded
            .read_until(b'\n', &mut buffer)
            .map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if count > 65536 {
            finish(&mut result, &mut current, &mut refs, true);
            rejected = true;
            result
                .coverage
                .diagnostic("Record exceeds 64 KiB; sample rejected");
            if !buffer.ends_with(b"\n") {
                loop {
                    buffer.clear();
                    let n = std::io::Read::take(&mut reader, 65536)
                        .read_until(b'\n', &mut buffer)
                        .map_err(|e| e.to_string())?;
                    if n == 0 || buffer.ends_with(b"\n") {
                        break;
                    }
                }
            }
            continue;
        }
        let line = String::from_utf8_lossy(&buffer);
        let line = line.trim_end();
        if line.is_empty() {
            finish(&mut result, &mut current, &mut refs, rejected);
            rejected = false;
            continue;
        }
        if line.trim_start().starts_with('#') {
            continue;
        }
        if let Some(c) = header.captures(line) {
            finish(&mut result, &mut current, &mut refs, rejected);
            rejected = false;
            let parsed = c[2]
                .parse::<u32>()
                .ok()
                .zip(c[3].parse::<u32>().ok())
                .zip(timestamp(&c[4]))
                .zip(c[5].parse::<u64>().ok());
            if let Some((((pid, tid), time_ns), period)) = parsed {
                if !c[6].starts_with("cpu-clock") {
                    result.coverage.diagnostic(line);
                    rejected = true;
                }
                if c[1].len() > 256
                    || (result.threads.len() >= 4096 && !result.threads.contains_key(&tid))
                {
                    result.coverage.diagnostic("Thread identity limit reached");
                    rejected = true;
                } else {
                    result
                        .threads
                        .entry(tid)
                        .or_insert_with(|| c[1].trim().into());
                }
                current = Some(Sample {
                    pid,
                    tid,
                    time_ns,
                    period,
                    frames: Vec::new(),
                });
                if let Some(tail) = c.get(7).filter(|v| !v.as_str().trim().is_empty()) {
                    if let Some(f) = frame_parts(tail.as_str()) {
                        if !push_frame(
                            &mut result,
                            &mut intern,
                            &mut current,
                            &f,
                            &mut frame_text_bytes,
                        ) {
                            rejected = true;
                        }
                    } else {
                        result.coverage.diagnostic(line);
                        rejected = true;
                    }
                }
            } else {
                result.coverage.diagnostic(line);
            }
        } else if let Some(f) = frame_parts(line) {
            if current.is_none() {
                result.coverage.diagnostic(line);
                continue;
            }
            if current.as_ref().unwrap().frames.len() >= 256 {
                if !rejected {
                    result.coverage.truncated_stacks += 1;
                }
                rejected = true;
                continue;
            }
            if !push_frame(
                &mut result,
                &mut intern,
                &mut current,
                &f,
                &mut frame_text_bytes,
            ) {
                rejected = true;
            }
        } else if let Some(id) = current.as_ref().and_then(|s| s.frames.last()).copied() {
            let text = line.trim();
            if let Some((path, n)) = text.rsplit_once(':').filter(|(p, _)| p.starts_with('/')) {
                if let Ok(n) = n.parse::<u32>() {
                    if n > 0 && result.frames[id as usize].source.is_none() {
                        if path.len() <= 4096
                            && frame_text_bytes.saturating_add(path.len()) <= FRAME_TEXT_LIMIT
                        {
                            frame_text_bytes += path.len();
                            result.frames[id as usize].source = Some(SourceLocation {
                                path: path.into(),
                                line: n,
                            });
                        } else {
                            result
                                .coverage
                                .diagnostic("Source mapping text limit reached; mapping omitted");
                        }
                    }
                } else {
                    result.coverage.diagnostic(line);
                    rejected = true;
                }
            } else if text.ends_with(']') && text.contains('[') {
                // perf's unresolved source rendering: module[address], retained as an unresolved frame.
            } else {
                finish(&mut result, &mut current, &mut refs, rejected);
                result.coverage.diagnostic(line);
                rejected = true;
            }
        } else {
            finish(&mut result, &mut current, &mut refs, rejected);
            result.coverage.diagnostic(line);
            rejected = true;
        }
    }
    finish(&mut result, &mut current, &mut refs, rejected);
    Ok(result)
}
// The final balanced parenthesized group is the module. Method arguments and
// `(deleted)` paths can contain parentheses too; the first '(' is not a boundary.
fn frame_parts(line: &str) -> Option<(&str, &str, &str)> {
    let line = line.trim();
    let split = line.find(char::is_whitespace)?;
    let address = &line[..split];
    if address.is_empty() || address.len() > 32 || !address.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let body = line[split..].trim();
    if !body.ends_with(')') {
        return None;
    }
    let mut depth = 0_u32;
    for (index, ch) in body.char_indices().rev() {
        if ch == ')' {
            depth += 1;
        } else if ch == '(' {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                let symbol = body[..index].trim_end();
                if symbol.is_empty() || !body[..index].ends_with(char::is_whitespace) {
                    return None;
                }
                return Some((address, symbol, &body[index + 1..body.len() - 1]));
            }
        }
    }
    None
}

fn push_frame(
    set: &mut SampleSet,
    intern: &mut HashMap<(String, String, String), u32>,
    sample: &mut Option<Sample>,
    f: &(&str, &str, &str),
    text_bytes: &mut usize,
) -> bool {
    let (address, symbol, module) = *f;
    let symbol = symbol.trim();
    let raw = symbol
        .rsplit_once("+0x")
        .filter(|(_, offset)| !offset.is_empty() && offset.bytes().all(|b| b.is_ascii_hexdigit()))
        .map_or(symbol, |(name, _)| name);
    if address.len() > 32 || symbol.len() > 4096 || module.len() > 4096 {
        return false;
    }
    let resolved = raw != "[unknown]" && raw != "??" && !raw.starts_with("0x");
    let value = Frame {
        address: address.into(),
        symbol: if resolved {
            raw.into()
        } else {
            format!("{}+address 0x{}", module, address)
        },
        module: module.into(),
        resolved,
        symbol_origin: SymbolOrigin::PerfReported,
        source: None,
    };
    let key = (
        value.module.clone(),
        value.symbol.clone(),
        if resolved {
            String::new()
        } else {
            value.address.clone()
        },
    );
    if !intern.contains_key(&key) {
        let bytes = value.address.len() + value.symbol.len() * 2 + value.module.len() * 2;
        if set.frames.len() >= FRAME_LIMIT || text_bytes.saturating_add(bytes) > FRAME_TEXT_LIMIT {
            return false;
        }
        *text_bytes += bytes;
    }
    let id = *intern.entry(key).or_insert_with(|| {
        let id = set.frames.len() as u32;
        set.frames.push(value);
        id
    });
    let frames = &mut sample.as_mut().unwrap().frames;
    frames.push(id);
    true
}

#[cfg(test)]
pub fn parse_loss(reader: impl BufRead, coverage: &mut Coverage) -> Result<(), String> {
    coverage.loss_scan_complete = Some(false);
    let lost = Regex::new(r"(?i)\blost\s*[:= ]\s*(\d+)").unwrap();
    let counter = Regex::new(r"(?i)lost samples\s*:\s*(\d+)").unwrap();
    let mut reader = reader;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = std::io::Read::take(&mut reader, 65536)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        let text = String::from_utf8_lossy(&line);
        let pattern = if text.contains("PERF_RECORD_LOST:") {
            coverage.lost_records += 1;
            Some((&lost, false))
        } else if text.contains("PERF_RECORD_LOST_SAMPLES:") {
            coverage.lost_sample_records += 1;
            Some((&counter, true))
        } else {
            None
        };
        if let Some((pattern, is_counter)) = pattern {
            if let Some(value) = pattern
                .captures(&text)
                .and_then(|c| c[1].parse::<u64>().ok())
            {
                if is_counter {
                    coverage.lost_sample_count = coverage.lost_sample_count.saturating_add(value);
                } else {
                    coverage.lost_count = coverage.lost_count.saturating_add(value);
                }
            } else {
                coverage.unparsed_loss_records += 1;
                coverage.diagnostic(&text);
            }
        }
    }
    coverage.loss_scan_complete = Some(true);
    Ok(())
}

/// Scan regular little-endian PERFILE2 record headers without formatting stack dumps.
/// Qualified only for this collector's uncompressed cpu-clock files. ABI references
/// and installed-version parity evidence are recorded in the backend results doc.
pub fn parse_perf_loss(
    reader: &mut (impl Read + Seek),
    file_bytes: u64,
    coverage: &mut Coverage,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    coverage.loss_scan_complete = Some(false);
    let mut header = [0_u8; 72];
    reader.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    reader.read_exact(&mut header).map_err(|e| e.to_string())?;
    if &header[..8] != b"PERFILE2" {
        return Err("Unsupported perf header/endian/pipe format; loss coverage unknown".into());
    }
    let number = |offset: usize| u64::from_le_bytes(header[offset..offset + 8].try_into().unwrap());
    let header_size = number(8);
    let offset = number(40);
    let bytes = number(48);
    let end = offset
        .checked_add(bytes)
        .ok_or("Invalid perf event section extent")?;
    if header_size < 72
        || header_size > file_bytes
        || offset < header_size
        || bytes == 0
        || end > file_bytes
        || file_bytes > RAW_CAP
    {
        return Err(
            "Missing, truncated or unfinalized perf event section; loss coverage unknown".into(),
        );
    }
    let mut position = offset;
    while position < end {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Loss scan cancelled".into());
        }
        if end - position < 8 {
            return Err("Truncated perf event header".into());
        }
        reader
            .seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let mut h = [0_u8; 8];
        reader.read_exact(&mut h).map_err(|e| e.to_string())?;
        let kind = u32::from_le_bytes(h[..4].try_into().unwrap());
        let size = u16::from_le_bytes(h[6..8].try_into().unwrap()) as u64;
        if size < 8 || size > end - position {
            return Err("Invalid or truncated perf record extent".into());
        }
        if kind == 2 {
            coverage.lost_records += 1;
            if size < 24 {
                coverage.unparsed_loss_records += 1;
                return Err("Truncated LOST record".into());
            }
            let mut payload = [0_u8; 16];
            reader.read_exact(&mut payload).map_err(|e| e.to_string())?;
            coverage.lost_count = coverage
                .lost_count
                .saturating_add(u64::from_le_bytes(payload[8..16].try_into().unwrap()));
        } else if kind == 13 {
            coverage.lost_sample_records += 1;
            if size < 16 {
                coverage.unparsed_loss_records += 1;
                return Err("Truncated LOST_SAMPLES record".into());
            }
            let mut payload = [0_u8; 8];
            reader.read_exact(&mut payload).map_err(|e| e.to_string())?;
            coverage.lost_sample_count = coverage
                .lost_sample_count
                .saturating_add(u64::from_le_bytes(payload));
        } else if !matches!(kind, 1..=21 | 68 | 69 | 73 | 74 | 78 | 82) {
            coverage.diagnostic(&format!(
                "Unqualified raw record type {kind} at byte {position}; loss coverage unknown"
            ));
            return Err(
                "Raw record layout is outside the qualified uncompressed capture format".into(),
            );
        }
        position += size;
    }
    coverage.loss_scan_complete = Some(true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const SCRIPT:&str="worker same 41/42 123.000000001: 100 cpu-clock:u:\n  aa known_hot+0x2 (/app/lib.so)\n  bb parent (/app/main)\n\nworker same 41/43 123.010000001: 300 cpu-clock:u:\n  cc [unknown] (/app/lib.so)\n  bb parent (/app/main)\n\n";
    fn query(direction: Direction) -> TreeQuery {
        TreeQuery {
            direction,
            path: vec![],
            limit: 20,
            tid: None,
            thread_name: None,
            module: None,
            start_ns: None,
            end_ns: None,
        }
    }
    #[test]
    fn stack_weight_identity_and_filters() {
        let set = parse_script(SCRIPT.as_bytes()).unwrap();
        assert_eq!(set.samples.len(), 2);
        assert_eq!(set.samples[0].time_ns, 123000000001);
        assert_eq!(set.threads[&43], "worker same");
        assert!(!set.frames[2].resolved);
        let top = set.branch(&query(Direction::TopDown)).unwrap();
        assert_eq!(top["children"][0]["inclusiveWeight"], 400);
        assert_eq!(top["children"][0]["selfWeight"], 0);
        let bottom = set.branch(&query(Direction::BottomUp)).unwrap();
        assert_eq!(bottom["children"][0]["selfWeight"], 300);
        let mut q = query(Direction::BottomUp);
        q.tid = Some(42);
        assert_eq!(set.branch(&q).unwrap()["totalWeight"], 100);
        q.tid = None;
        q.start_ns = Some(1);
        assert_eq!(set.branch(&q).unwrap()["totalWeight"], 300);
        q.start_ns = None;
        q.module = Some("/no/module".into());
        assert_eq!(set.branch(&q).unwrap()["selectedSamples"], 0);
        q.module = Some("/app/lib.so".into());
        q.direction = Direction::TopDown;
        let lens = set.branch(&q).unwrap();
        assert_eq!(lens["children"][0]["frame"]["module"], "/app/main");
        assert_eq!(lens["totalWeight"], 400);
        q.module = None;
        q.thread_name = Some("worker same".into());
        assert_eq!(set.branch(&q).unwrap()["selectedSamples"], 2);
    }
    #[test]
    fn malformed_record_never_borrows_neighbour_frames() {
        let text = SCRIPT.replace(
            "  aa known_hot+0x2 (/app/lib.so)",
            "invalid\n  aa known_hot+0x2 (/app/lib.so)",
        );
        let set = parse_script(text.as_bytes()).unwrap();
        assert_eq!(set.samples.len(), 1);
        assert!(set.coverage.partial());
    }
    #[test]
    fn losses_are_not_double_counted() {
        let mut c = Coverage::default();
        parse_loss(
            "PERF_RECORD_LOST: id:1: lost: 652\nPERF_RECORD_LOST_SAMPLES: lost samples: 652\n"
                .as_bytes(),
            &mut c,
        )
        .unwrap();
        assert_eq!(c.lost_records, 1);
        assert_eq!(c.lost_count, 652);
        assert_eq!(c.lost_sample_records, 1);
        assert_eq!(c.lost_sample_count, 652);
        assert!(c.partial());
    }
    #[test]
    fn settings_refuse_unqualified_modes() {
        let mut o = Options::default();
        o.validate().unwrap();
        o.frequency = 1000;
        assert!(o.validate().is_err());
        o.frequency = 999;
        o.unwind = Unwind::Dwarf { stack_bytes: 16384 };
        o.validate().unwrap();
        o.duration_seconds = 121;
        assert!(o.validate().is_err());
        assert_eq!(timestamp("12.123456789"), Some(12123456789));
        assert_eq!(timestamp("12.1234567891"), None);
    }
    #[test]
    fn same_function_aggregates_addresses_and_recursive_calls_survive() {
        let script="w 1/2 1.000000001: 100 cpu-clock:u:\n aa hot+0x1 (/lib.so)\n bb parent (/lib.so)\n bb parent (/lib.so)\n\nw 1/2 1.000000002: 200 cpu-clock:u:\n ac hot+0x3 (/lib.so)\n bb parent (/lib.so)\n\n";
        let set = parse_script(script.as_bytes()).unwrap();
        assert_eq!(set.samples[0].frames.len(), 3);
        assert_eq!(set.frames.len(), 2);
        let tree = set.branch(&query(Direction::BottomUp)).unwrap();
        assert_eq!(tree["children"][0]["selfWeight"], 300);
    }
    #[test]
    fn source_metadata_is_optional_and_does_not_shift_stack() {
        let text = SCRIPT.replace(
            "  bb parent (/app/main)",
            "  bb parent (/app/main)\n /project/main.cpp:42",
        );
        let set = parse_script(text.as_bytes()).unwrap();
        assert_eq!(set.samples.len(), 2);
        assert_eq!(set.frames[1].source.as_ref().unwrap().line, 42);
    }
    #[test]
    fn oversized_symbol_is_rejected_with_bounded_storage() {
        let text = format!(
            "w 1/2 1.000000001: 100 cpu-clock:u:\n aa {} (/lib.so)\n\n",
            "x".repeat(5000)
        );
        let set = parse_script(text.as_bytes()).unwrap();
        assert!(set.samples.is_empty());
        assert_eq!(set.coverage.omitted_samples, 1);
        assert!(set.frames.is_empty());
    }
    #[test]
    fn oversized_source_mapping_does_not_bypass_text_budget() {
        let text = format!(
            "w 1/2 1.000000001: 100 cpu-clock:u:\n aa hot (/lib.so)\n /{}:7\n\n",
            "x".repeat(5000)
        );
        let set = parse_script(text.as_bytes()).unwrap();
        assert_eq!(set.samples.len(), 1);
        assert!(set.frames[0].source.is_none());
        assert!(set.coverage.partial());
    }
    #[test]
    fn recorded_installed_version_and_positive_loss() {
        let set = parse_script(
            include_str!("../../workspaces/profiling-perf-backend/fixtures/perf-7.2.11-stacks.txt")
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(set.samples.len(), 3);
        assert_eq!(set.coverage.unknown_records, 0);
        assert!(set
            .frames
            .iter()
            .any(|f| f.symbol == "generated_workload_entry"));
        let mut coverage = Coverage::default();
        parse_loss(
            include_str!("../../workspaces/profiling-perf-backend/fixtures/perf-7.2.11-loss.txt")
                .as_bytes(),
            &mut coverage,
        )
        .unwrap();
        assert_eq!(coverage.lost_records, 3);
        assert_eq!(coverage.lost_count, 652);
        assert_eq!(coverage.lost_sample_records, 3);
        assert_eq!(coverage.lost_sample_count, 652);
    }
    #[test]
    fn binary_loss_extent_checks_and_separate_counters() {
        fn file(data: &[u8]) -> Vec<u8> {
            let mut h = vec![0_u8; 72];
            h[..8].copy_from_slice(b"PERFILE2");
            h[8..16].copy_from_slice(&72_u64.to_le_bytes());
            h[40..48].copy_from_slice(&72_u64.to_le_bytes());
            h[48..56].copy_from_slice(&(data.len() as u64).to_le_bytes());
            h.extend(data);
            h
        }
        let mut data = Vec::new();
        for (kind, payload) in [(2_u32, vec![7_u64, 652]), (13_u32, vec![652])] {
            data.extend(kind.to_le_bytes());
            data.extend(0_u16.to_le_bytes());
            data.extend(((8 + payload.len() * 8) as u16).to_le_bytes());
            for n in payload {
                data.extend(n.to_le_bytes());
            }
        }
        let bytes = file(&data);
        let mut coverage = Coverage::default();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        parse_perf_loss(
            &mut std::io::Cursor::new(&bytes),
            bytes.len() as u64,
            &mut coverage,
            &cancel,
        )
        .unwrap();
        assert_eq!(coverage.lost_count, 652);
        assert_eq!(coverage.lost_sample_count, 652);
        assert_eq!(coverage.loss_scan_complete, Some(true));
        let mut broken = bytes.clone();
        broken.pop();
        assert!(parse_perf_loss(
            &mut std::io::Cursor::new(&broken),
            broken.len() as u64,
            &mut coverage,
            &cancel
        )
        .is_err());
        assert_eq!(coverage.loss_scan_complete, Some(false));
        let mut unsupported = bytes;
        unsupported[72..76].copy_from_slice(&81_u32.to_le_bytes());
        assert!(parse_perf_loss(
            &mut std::io::Cursor::new(&unsupported),
            unsupported.len() as u64,
            &mut coverage,
            &cancel
        )
        .is_err());
    }
    #[test]
    fn extracted_live_binary_loss_matches_perf_dump() {
        let bytes = include_bytes!(
            "../../workspaces/profiling-perf-backend/fixtures/perf-7.2.11-positive-loss.data"
        );
        let mut coverage = Coverage::default();
        parse_perf_loss(
            &mut std::io::Cursor::new(bytes),
            bytes.len() as u64,
            &mut coverage,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(coverage.lost_records, 2);
        assert_eq!(coverage.lost_count, 1126);
        assert_eq!(coverage.lost_sample_records, 2);
        assert_eq!(coverage.lost_sample_count, 1126);
    }
    #[test]
    fn method_arguments_and_deleted_module_names_are_not_boundaries() {
        let script="jit-hot-0 10/11 1.000000001: 100 cpu-clock:u:\n aa ManagedPerfFixture:KnownJitHot (long) (/tmp/perf-10.map)\n bb native::operator() (/memfd:doublemapper (deleted))\n\n";
        let set = parse_script(script.as_bytes()).unwrap();
        assert_eq!(set.samples.len(), 1);
        assert_eq!(
            set.frames[0].symbol,
            "ManagedPerfFixture:KnownJitHot (long)"
        );
        assert_eq!(set.frames[0].module, "/tmp/perf-10.map");
        assert_eq!(set.frames[1].module, "/memfd:doublemapper (deleted)");
        assert_eq!(set.frames[1].symbol, "native::operator()");
    }
}
