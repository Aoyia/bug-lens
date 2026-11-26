//! `bug-lens-cli` 二进制主入口。

use bug_lens_cli::run_triage_cli;
use std::env;
use std::io::{self, Write};
use std::process;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match run_triage_cli(&args) {
        Ok(out) => {
            let mut stdout = io::stdout().lock();
            let _ = writeln!(stdout, "{out}");
        }
        Err(err) => {
            let mut stderr = io::stderr().lock();
            let _ = writeln!(stderr, "Error: {err}");
            process::exit(1);
        }
    }
}
