//! Runs the production parser independently for reproducible correctness/scale evidence.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/metric_csv.rs"]
mod csv;
use std::{sync::atomic::AtomicBool, time::Instant};

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("Usage: craidd-metric-fixture <CSV>");
    let start = Instant::now();
    let mut progress = 0;
    let table =
        csv::parse(&path, &AtomicBool::new(false), |_, _| progress += 1).expect("Import failed");
    let parse_ms = start.elapsed().as_secs_f64() * 1000.;
    let mut timings = Vec::new();
    for (column, a, b) in [
        (1, 0, table.lines.len()),
        (2, table.lines.len() / 4, table.lines.len() * 3 / 4),
        (3, table.lines.len() / 2, table.lines.len() * 3 / 4),
    ] {
        if !table.meta.columns.get(column).is_some_and(|c| c.numeric) {
            continue;
        }
        let now = Instant::now();
        let graph = csv::graph(&table, column, a, b).unwrap();
        timings.push(serde_json::json!({"column":column,"start":a,"end":b,"ms":now.elapsed().as_secs_f64()*1000.,"points":graph.points.len()}));
    }
    let now = Instant::now();
    let row = table.row(table.lines.len() / 2).unwrap();
    let row_ms = now.elapsed().as_secs_f64() * 1000.;
    let now = Instant::now();
    let worst = csv::worst(&table, 1, 0, table.lines.len(), 20).unwrap();
    let worst_ms = now.elapsed().as_secs_f64() * 1000.;
    println!(
        "{}",
        serde_json::json!({"file":path,"size":table.meta.size,"rows":table.lines.len(),"sha256":table.meta.sha256,"parseMs":parse_ms,"retainedBytes":table.memory_bytes(),"progressCallbacks":progress,"graphQueries":timings,"rowInspectionMs":row_ms,"rowCells":row.cells.len(),"worstMs":worst_ms,"worstRows":worst.len()})
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use csv::{Axis, Dataset, JoinRule};
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };
    static SEQ: AtomicUsize = AtomicUsize::new(1);
    fn dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "craidd-metric-tests-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        p
    }
    fn parse(text: &str) -> (PathBuf, csv::Table) {
        let d = dir();
        let p = d.join("input.csv");
        fs::write(&p, text).unwrap();
        let t = csv::parse(p.to_str().unwrap(), &AtomicBool::new(false), |_, _| {}).unwrap();
        (d, t)
    }
    #[test]
    fn statistic_suffix_unit_and_meaning_suggestions_reproduce_program_headers() {
        for suffix in [
            "mean", "avg", "min", "max", "sum", "total", "p50", "p90", "p95", "p99", "p999",
        ] {
            let (d, t) = parse(&format!(
                "elapsed_s,loop_ms_{suffix},queue_us_{suffix},rx_kb_s\n0,1,2,3\n"
            ));
            assert_eq!(t.meta.columns[1].unit, "ms", "loop_ms_{suffix}");
            assert_eq!(t.meta.columns[2].unit, "us", "queue_us_{suffix}");
            assert_eq!(t.meta.columns[1].meaning, "window statistic", "{suffix}");
            assert_eq!(t.meta.columns[3].unit, "kb_s");
            assert!(t.meta.columns[1].unit_suggested && t.meta.columns[1].meaning_suggested);
            fs::remove_dir_all(d).unwrap();
        }
    }
    #[test]
    fn ambiguous_names_stay_literal_and_unknown() {
        for name in [
            "loop_ms_us_p95",
            "loop_ms_p95_p99",
            "queue_ms_s",
            "loop_ms_p95_extra",
            "loop_ms_p100",
        ] {
            let (d, t) = parse(&format!("{name}\n1\n"));
            assert_eq!(t.meta.columns[0].name, name);
            assert_eq!(t.meta.columns[0].unit, "unitless", "{name}");
            assert_eq!(t.meta.columns[0].meaning, "unknown", "{name}");
            assert!(!t.meta.columns[0].unit_suggested && !t.meta.columns[0].meaning_suggested);
            fs::remove_dir_all(d).unwrap();
        }
        let (d, t) = parse("elapsed_s,LOOP_MS_P999,rx_kb_s_total,objects_total\n0,1,2,3\n");
        assert_eq!(t.meta.columns[1].name, "LOOP_MS_P999");
        assert_eq!(t.meta.columns[1].unit, "ms");
        assert_eq!(t.meta.columns[2].unit, "kb_s");
        assert_eq!(t.meta.columns[3].meaning, "window statistic");
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn bulk_edits_preserve_unselected_fields_and_saved_snapshot_bytes() {
        let (d, t) = parse("elapsed_s,recv,update,note\n0,1,2,ok\n1,3,4,next\n");
        let mut data = Dataset { tables: vec![t] };
        let path = d.join("before.crmetrics");
        csv::save(
            &data,
            &[],
            path.to_str().unwrap(),
            &[[0, 2]],
            &AtomicBool::new(false),
        )
        .unwrap();
        let before = fs::read(&path).unwrap();
        let table = &mut data.tables[0];
        let cols = csv::bulk_columns(&table.meta.columns, None, "ms", None).unwrap();
        table.interpret(cols, table.meta.axis.clone()).unwrap();
        assert_eq!(table.meta.columns[0].unit, "s");
        assert_eq!(table.meta.columns[3].unit, "unitless");
        assert_eq!(table.meta.columns[1].meaning, "unknown");
        let cols = csv::bulk_columns(
            &table.meta.columns,
            Some(&[1]),
            "us",
            Some("window statistic"),
        )
        .unwrap();
        table.interpret(cols, table.meta.axis.clone()).unwrap();
        assert_eq!(table.meta.columns[1].unit, "us");
        assert_eq!(table.meta.columns[2].unit, "ms");
        assert!(!table.meta.columns[1].unit_suggested && !table.meta.columns[1].meaning_suggested);
        for selection in [vec![], vec![9], vec![3], vec![1, 1]] {
            assert!(csv::bulk_columns(&table.meta.columns, Some(&selection), "ms", None).is_err());
        }
        assert!(csv::bulk_columns(&table.meta.columns, None, "ms", None).is_err());
        let (mut saved, _) = csv::load(path.to_str().unwrap(), &AtomicBool::new(false)).unwrap();
        assert_eq!(saved.tables[0].meta.columns[1].unit, "unitless");
        let cols = csv::bulk_columns(&saved.tables[0].meta.columns, None, "ms", None).unwrap();
        assert!(saved.tables[0].interpret(cols, Axis::default()).is_err());
        assert_eq!(fs::read(path).unwrap(), before);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn old_column_metadata_does_not_gain_new_suggestions_on_reopen() {
        let c: csv::Column = serde_json::from_str(
            r#"{"name":"loop_ms_p99","numeric":true,"unit":"unitless","meaning":"unknown"}"#,
        )
        .unwrap();
        assert!(!c.unit_suggested && !c.meaning_suggested);
        assert_eq!(c.unit, "unitless");
    }
    #[test]
    fn public_acceptance_fixtures_have_the_documented_integrity_and_join() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures");
        let main = csv::parse(
            root.join("run.csv").to_str().unwrap(),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        let sections = csv::parse(
            root.join("run-sections.csv").to_str().unwrap(),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        assert_eq!(main.lines.len(), 5);
        assert_eq!(main.meta.coverage.invalid, 2);
        assert_eq!(main.meta.coverage.unsupported, 1);
        assert_eq!(main.meta.coverage.empty_cells, 1);
        assert_eq!(sections.lines.len(), 3);
        assert_eq!(
            main.row(4).unwrap().cells[3],
            serde_json::json!("last, quoted")
        );
        let data = Dataset {
            tables: vec![main, sections],
        };
        let rules = vec![JoinRule {
            left: 0,
            right: 1,
            left_column: 0,
            right_column: 0,
            tolerance: None,
        }];
        let joined = csv::companions(&data, 0, 1, &rules).unwrap();
        assert_eq!(
            joined[0].row.as_ref().unwrap().cells[1],
            serde_json::json!(60.)
        );
        assert!(csv::companions(&data, 0, 2, &rules).unwrap()[0]
            .row
            .is_none());
    }
    #[test]
    fn exact_cells_quotes_crlf_and_integrity() {
        let(d,t)=parse("\u{feff}time,p99_ms,note\r\n0,1.25,\"a,b\"\r\n1,2,\"say \"\"hi\"\"\"\r\n2,bad,no\r\n3,4\r\n4,,empty\r\n5,6,last");
        assert_eq!(t.lines, vec![2, 3, 6, 7]);
        assert_eq!(t.meta.coverage.invalid, 2);
        assert_eq!(t.meta.coverage.missing_columns, 1);
        assert_eq!(t.meta.coverage.empty_cells, 1);
        assert_eq!(t.meta.coverage.unterminated, 1);
        assert_eq!(t.cell(0, 2).unwrap(), "a,b");
        assert_eq!(t.cell(1, 2).unwrap(), "say \"hi\"");
        assert_eq!(t.numeric(0, 1), Some(1.25));
        assert_eq!(t.numeric(2, 1), None);
        assert_eq!(t.meta.columns[1].unit, "ms");
        assert_eq!(t.meta.columns[1].meaning, "unknown");
        assert_eq!(t.meta.axis.kind, "ordinal");
        assert_eq!(t.meta.axis.window_seconds, None);
        assert_eq!(
            t.meta.sha256,
            format!(
                "{:x}",
                sha2::Sha256::digest(fs::read(d.join("input.csv")).unwrap())
            )
        );
        fs::remove_dir_all(d).unwrap();
    }
    use sha2::Digest;
    #[test]
    fn multiline_continuations_never_become_rows() {
        let (d, t) =
            parse("t,value,note\n0,1,ok\n1,2,\"first\n2,999,looks-like-a-row\nlast\"\n3,4,ok\n");
        assert_eq!(t.lines, vec![2, 6]);
        assert_eq!(t.meta.coverage.records, 3);
        assert_eq!(t.meta.coverage.unsupported, 1);
        assert_eq!(csv::worst(&t, 1, 0, 2, 20).unwrap()[0].cells[1], 4.);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn bad_unquoted_quote_does_not_consume_next_record() {
        let (d, t) = parse("t,value,note\n0,1,ok\n1,2,bad\"quote\n2,3,recovered\n");
        assert_eq!(t.lines, vec![2, 4]);
        assert_eq!(t.meta.coverage.invalid, 1);
        assert_eq!(t.meta.coverage.unsupported, 0);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn immutable_snapshot_reopens_after_original_deleted() {
        let (d, mut t) = parse("t,p99_ms,note,empty\n0,10,\"héllo\",\n1,30,world,\n2,20,last,\n");
        let mut columns = t.meta.columns.clone();
        columns[1].meaning = "window statistic".into();
        t.interpret(
            columns,
            Axis {
                kind: "elapsed".into(),
                column: Some(0),
                window_seconds: Some(1.),
            },
        )
        .unwrap();
        let mut data = Dataset { tables: vec![t] };
        let snap = d.join("copy.crmetrics");
        csv::save(
            &data,
            &[],
            snap.to_str().unwrap(),
            &[[1, 3]],
            &AtomicBool::new(false),
        )
        .unwrap();
        data.tables[0].meta.columns[1].unit = "us".into();
        fs::remove_file(d.join("input.csv")).unwrap();
        let (mut reopened, _) = csv::load(snap.to_str().unwrap(), &AtomicBool::new(false)).unwrap();
        let table = &mut reopened.tables[0];
        assert_eq!(table.meta.columns[1].unit, "ms");
        assert_eq!(table.row(0).unwrap().cells[2], "world");
        assert_eq!(table.meta.original_range, Some([1, 3]));
        assert_eq!(table.axis, vec![1., 2.]);
        assert!(table
            .interpret(table.meta.columns.clone(), Axis::default())
            .is_err());
        assert!(
            csv::save(
                &data,
                &[],
                snap.to_str().unwrap(),
                &[[0, 1]],
                &AtomicBool::new(false)
            )
            .is_err(),
            "never overwrite an existing artifact"
        );
        let mut bytes = fs::read(&snap).unwrap();
        bytes.truncate(bytes.len() - 1);
        fs::write(&snap, bytes).unwrap();
        assert!(csv::load(snap.to_str().unwrap(), &AtomicBool::new(false)).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn named_key_joins_preserve_missing_and_ambiguous() {
        let (d, a) = parse("key,value\n0,1\n1,2\n2,3\n3,4\n");
        let (e, b) = parse("time,value\n2,20\n0,10\n2,30\n");
        let data = Dataset { tables: vec![a, b] };
        let rules = vec![JoinRule {
            left: 0,
            right: 1,
            left_column: 0,
            right_column: 0,
            tolerance: None,
        }];
        assert_eq!(
            csv::companions(&data, 0, 0, &rules).unwrap()[0]
                .row
                .as_ref()
                .unwrap()
                .cells[1],
            10.
        );
        assert_eq!(
            csv::companions(&data, 0, 1, &rules).unwrap()[0].state,
            "unjoined"
        );
        assert_eq!(
            csv::companions(&data, 0, 2, &rules).unwrap()[0].state,
            "ambiguous"
        );
        assert!(csv::companions(&data, 0, 2, &rules).unwrap()[0]
            .row
            .is_none());
        fs::remove_dir_all(d).unwrap();
        fs::remove_dir_all(e).unwrap();
    }
    #[test]
    fn tolerance_requires_same_units_and_unique_match() {
        let (d, a) = parse("time_s,value\n1,3\n");
        let (e, b) = parse("time_s,value\n1.01,8\n");
        let mut data = Dataset { tables: vec![a, b] };
        let rules = vec![JoinRule {
            left: 0,
            right: 1,
            left_column: 0,
            right_column: 0,
            tolerance: Some(0.02),
        }];
        assert_eq!(
            csv::companions(&data, 0, 0, &rules).unwrap()[0].state,
            "joined"
        );
        data.tables[1].meta.columns[0].unit = "ms".into();
        assert!(csv::companions(&data, 0, 0, &rules).is_err());
        fs::remove_dir_all(d).unwrap();
        fs::remove_dir_all(e).unwrap();
    }
    #[test]
    fn ordinal_unknown_duration_iso_and_invalid_time_are_explicit() {
        let (d, mut t) =
            parse("stamp,value\n2026-10-20T10:00:00Z,1\n2026-10-20T11:00:01+01:00,2\n");
        let axis = Axis {
            kind: "iso8601".into(),
            column: Some(0),
            window_seconds: None,
        };
        t.interpret(t.meta.columns.clone(), axis).unwrap();
        assert_eq!(t.axis[1] - t.axis[0], 1.);
        assert!(t
            .interpret(
                t.meta.columns.clone(),
                Axis {
                    kind: "ordinal".into(),
                    column: None,
                    window_seconds: Some(1.)
                }
            )
            .is_err());
        assert!(t
            .interpret(
                t.meta.columns.clone(),
                Axis {
                    kind: "elapsed".into(),
                    column: Some(1),
                    window_seconds: Some(-1.)
                }
            )
            .is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn cancelled_missing_header_duplicates_nan_and_malformed_are_safe() {
        let d = dir();
        let p = d.join("bad.csv");
        assert!(csv::parse(p.to_str().unwrap(), &AtomicBool::new(false), |_, _| {}).is_err());
        for text in ["", "a,a\n1,2\n", "a,,b\n1,2,3\n"] {
            fs::write(&p, text).unwrap();
            assert!(csv::parse(p.to_str().unwrap(), &AtomicBool::new(false), |_, _| {}).is_err());
        }
        fs::write(&p, "t,v\n0,1\n1,NaN\n2,inf\n").unwrap();
        let t = csv::parse(p.to_str().unwrap(), &AtomicBool::new(false), |_, _| {}).unwrap();
        assert_eq!(t.meta.coverage.invalid, 2);
        assert!(csv::parse(p.to_str().unwrap(), &AtomicBool::new(true), |_, _| {}).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn unreadable_deleted_and_resource_limited_files_report_errors() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir();
        let path = d.join("source.csv");
        fs::write(&path, "t,value\n0,1\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0)).unwrap();
        assert!(csv::parse(path.to_str().unwrap(), &AtomicBool::new(false), |_, _| {}).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(csv::parse_limited(
            path.to_str().unwrap(),
            &AtomicBool::new(false),
            |_, _| {},
            1
        )
        .is_err());
        fs::write(
            &path,
            format!(
                "t,value\n{}",
                (0..5000).map(|i| format!("{i},1\n")).collect::<String>()
            ),
        )
        .unwrap();
        let mut removed = false;
        assert!(
            csv::parse(path.to_str().unwrap(), &AtomicBool::new(false), |_, _| {
                if !removed {
                    fs::remove_file(&path).unwrap();
                    removed = true;
                }
            })
            .is_err()
        );
        assert!(removed);
        fs::write(&path, format!("t,value\n0,{}", "x".repeat(1024 * 1024))).unwrap();
        assert!(csv::parse(path.to_str().unwrap(), &AtomicBool::new(false), |_, _| {}).is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn time_units_convert_without_changing_original_cells() {
        let (d, mut t) = parse("time_ms,p99_ms\n0,10\n1000,20\n");
        t.interpret(
            t.meta.columns.clone(),
            Axis {
                kind: "elapsed".into(),
                column: Some(0),
                window_seconds: None,
            },
        )
        .unwrap();
        assert_eq!(t.axis, vec![0., 1.]);
        assert_eq!(t.numeric(1, 0), Some(1000.));
        let old = t.meta.interpretation_revision;
        let mut cols = t.meta.columns.clone();
        cols[0].unit = "bytes".into();
        assert!(t
            .interpret(
                cols,
                Axis {
                    kind: "elapsed".into(),
                    column: Some(0),
                    window_seconds: None
                }
            )
            .is_err());
        assert_eq!(t.meta.interpretation_revision, old);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn unsafe_integer_counters_are_never_silently_rounded() {
        let (d, t) = parse("counter,value\n1,2\n9007199254740993,3\n2,4\n");
        assert_eq!(t.meta.coverage.invalid, 1);
        assert_eq!(t.lines, vec![2, 4]);
        fs::remove_dir_all(d).unwrap();
        let (d, t) = parse("identifier\n9007199254740993\n");
        assert!(!t.meta.columns[0].numeric);
        assert_eq!(t.cell(0, 0).unwrap(), "9007199254740993");
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn malformed_iso_timestamps_do_not_become_valid_clocks() {
        for stamp in [
            "2026-10-20T-1:00:00Z",
            "2026-10-20T10:00:0e0Z",
            "2026-02-30T10:00:00Z",
            "2026-10-20T10:00:00",
        ] {
            let (d, mut t) = parse(&format!("stamp,value\n{stamp},1\n"));
            assert!(t
                .interpret(
                    t.meta.columns.clone(),
                    Axis {
                        kind: "iso8601".into(),
                        column: Some(0),
                        window_seconds: None
                    }
                )
                .is_err());
            assert_eq!(t.meta.axis.kind, "ordinal");
            fs::remove_dir_all(d).unwrap();
        }
    }
    #[test]
    fn snapshot_slices_preserve_ordinal_axis_and_source_provenance() {
        let (d, t) = parse("value\n10\n20\n30\n40\n");
        let source = t.meta.source_id.clone();
        let data = Dataset { tables: vec![t] };
        let first = d.join("first.crmetrics");
        csv::save(
            &data,
            &[],
            first.to_str().unwrap(),
            &[[1, 4]],
            &AtomicBool::new(false),
        )
        .unwrap();
        let (copy, _) = csv::load(first.to_str().unwrap(), &AtomicBool::new(false)).unwrap();
        assert_eq!(copy.tables[0].x(0), 2.);
        let second = d.join("second.crmetrics");
        csv::save(
            &copy,
            &[],
            second.to_str().unwrap(),
            &[[1, 2]],
            &AtomicBool::new(false),
        )
        .unwrap();
        let (copy, _) = csv::load(second.to_str().unwrap(), &AtomicBool::new(false)).unwrap();
        assert_eq!(copy.tables[0].x(0), 3.);
        assert_eq!(copy.tables[0].meta.source_id, source);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn editor_pages_and_point_selection_keep_original_irregular_time_rows() {
        let (d,mut t)=parse("elapsed_s,value_ms,note\n0,1,a\n0.1,8,b\n40,9,c\n90,2,d\n");
        t.interpret(t.meta.columns.clone(),Axis{kind:"elapsed".into(),column:Some(0),window_seconds:None}).unwrap();
        assert_eq!(csv::nearest(&t,0,4,39.9).unwrap(),2);
        assert_eq!(csv::nearest(&t,1,3,90.).unwrap(),2);
        assert_eq!(csv::nearest(&t,1,3,-3.).unwrap(),1);
        assert!(csv::nearest(&t,0,4,f64::NAN).is_err());
        assert!(csv::nearest(&t,4,4,0.).is_err());
        let rows=csv::page(&t,2,50).unwrap();
        assert_eq!(rows.len(),2); assert_eq!(rows[0].index,2);assert_eq!(rows[0].line,4);
        assert_eq!(rows[0].cells[2],"c");assert_eq!(rows[0].x,40.);
        assert!(csv::page(&t,0,101).is_err());assert!(csv::page(&t,0,0).is_err());assert!(csv::page(&t,5,1).is_err());
        assert!(csv::page(&t,4,1).unwrap().is_empty());
        assert_eq!(t.meta.axis.window_seconds,None);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn page_text_is_bounded_without_changing_original_row_cells() {
        let text="界".repeat(300);
        let (d,t)=parse(&format!("value,note\n1,{text}\n"));
        let rows=csv::page(&t,0,1).unwrap();
        assert_eq!(rows[0].cells[1].as_str().unwrap().chars().count(),161);
        assert_eq!(rows[0].truncated_columns,vec![1]);
        assert!(t.row(0).unwrap().truncated_columns.is_empty());
        assert!(rows[0].cells[1].as_str().unwrap().ends_with('…'));
        assert_eq!(t.row(0).unwrap().cells[1],text);
        fs::remove_dir_all(d).unwrap();
    }

}
