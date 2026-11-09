//! Test support: write a shell-script stand-in that can be executed at once.
//!
//! Executing a file that some process still has open for writing fails with
//! ETXTBSY ("text file busy"). Tests run in parallel, and another test's
//! `fork` can inherit this file's write descriptor until its own `exec`, so
//! the window outlives our `close`. After writing, the script is therefore
//! trial-executed (it exits at once when `CRAIDD_EXEC_PROBE=1`) until the
//! kernel stops refusing it.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

const ETXTBSY: i32 = 26;

/// `contents` must start with a `#!/bin/sh` line.
pub(crate) fn install_script(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let (shebang, rest) = contents.split_once('\n').expect("a script starts with a shebang line");
    let text = format!("{shebang}\n[ \"$CRAIDD_EXEC_PROBE\" = 1 ] && exit 0\n{rest}");
    let mut file = fs::File::create(path).unwrap();
    file.write_all(text.as_bytes()).unwrap();
    file.sync_all().unwrap();
    drop(file);
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match Command::new(path).env("CRAIDD_EXEC_PROBE", "1").output() {
            Err(error) if error.raw_os_error() == Some(ETXTBSY) && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            _ => return,
        }
    }
}
