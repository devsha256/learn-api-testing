"""
munit_runner.py
---------------
Runs MUnit tests for multiple Mule projects in parallel.
Each project opens a dedicated PowerShell window showing live Maven output.

Usage:
    python munit_runner.py --list projects.csv --script mvn-munit.sh --logs ./logs --threads 4
    python munit_runner.py --help
"""

import argparse
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def parse_args() -> argparse.Namespace:
    """Build CLI interface with full --help man-page style output."""
    parser = argparse.ArgumentParser(
        prog="munit_runner.py",
        description="Run MUnit tests across multiple Mule projects in parallel.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
    python munit_runner.py --list projects.csv --script mvn-munit.sh --logs ./logs --threads 4
    python munit_runner.py --list repos.txt --script /path/to/mvn-munit.sh --logs C:/audit/logs

NOTES:
    - --list expects a plain text or CSV file with one repository folder name per line, no header.
    - --script expects the full path to mvn-munit.sh.
    - Each project opens in its own PowerShell window showing live Maven output.
    - Press ENTER in each window to close it after the run completes.
    - Exit codes per project are written to the log directory as <project>.exitcode.
        """,
    )
    parser.add_argument(
        "--list",
        required=True,
        metavar="FILE",
        help="Path to a txt/csv file containing repository folder names, one per line.",
    )
    parser.add_argument(
        "--script",
        required=True,
        metavar="FILE",
        help="Full path to mvn-munit.sh to execute for each project.",
    )
    parser.add_argument(
        "--logs",
        required=True,
        metavar="DIR",
        help="Directory where Maven output logs will be written, one file per project.",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=4,
        metavar="N",
        help="Number of projects to run in parallel (default: 4).",
    )
    return parser.parse_args()


def load_projects(list_file: Path) -> list[str]:
    """Read project names from a newline-separated file, skipping blanks and comments."""
    return [
        line.strip()
        for line in list_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def validate_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    """Resolve and validate all required paths, exit with a clear message on failure."""
    list_file   = Path(args.list)
    script_file = Path(args.script)
    logs_dir    = Path(args.logs)

    errors = []
    if not list_file.exists():
        errors.append(f"Project list not found: {list_file}")
    if not script_file.exists():
        errors.append(f"Maven script not found: {script_file}")
    if errors:
        for e in errors:
            print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)

    logs_dir.mkdir(parents=True, exist_ok=True)
    return list_file, script_file, logs_dir


def build_powershell_command(project: str, script_file: Path, logs_dir: Path) -> str:
    """
    Build the PowerShell child window command string.
    Runs mvn-munit.sh via bash, tees output to log file,
    then waits for ENTER before closing.
    All on single lines to avoid heredoc backtick issues.
    """
    log_file = logs_dir / f"{project}.log"

    return (
        f"$Host.UI.RawUI.WindowTitle = 'MUNIT: {project}'; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"Write-Host '  PROJECT: {project}' -ForegroundColor Cyan; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"bash '{script_file.as_posix()}' '{project}' 2>&1 | "
        f"Tee-Object -FilePath '{log_file.as_posix()}'; "
        f"$code = $LASTEXITCODE; "
        f"Set-Content -Path '{(logs_dir / f'{project}.exitcode').as_posix()}' -Value $code; "
        f"Write-Host ''; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"if ($code -eq 0) {{ Write-Host '  PASSED: {project}' -ForegroundColor Green }} "
        f"else {{ Write-Host '  FAILED: {project} (exit $code)' -ForegroundColor Red }}; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"Read-Host 'Press ENTER to close this window'"
    )


def launch_project(project: str, script_file: Path, logs_dir: Path) -> dict:
    """Launch a single project in a new PowerShell window and wait for it to close."""
    cmd = build_powershell_command(project, script_file, logs_dir)
    proc = subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    print(f"[>] Launched: {project} (PID {proc.pid})")
    proc.wait()

    exitcode_file = logs_dir / f"{project}.exitcode"
    exit_code = int(exitcode_file.read_text().strip()) if exitcode_file.exists() else proc.returncode

    return {"project": project, "exit_code": exit_code, "pid": proc.pid}


def run_all(projects: list[str], script_file: Path, logs_dir: Path, threads: int) -> list[dict]:
    """Execute all projects in parallel up to the thread limit, collect results."""
    results = []
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = {
            executor.submit(launch_project, project, script_file, logs_dir): project
            for project in projects
        }
        for future in as_completed(futures):
            result = future.result()
            status = "PASSED" if result["exit_code"] == 0 else "FAILED"
            colour = "\033[92m" if status == "PASSED" else "\033[91m"
            reset  = "\033[0m"
            print(f"  [{colour}{status}{reset}] {result['project']} (exit {result['exit_code']})")
            results.append(result)
    return results


def print_summary(projects: list[str], results: list[dict]) -> None:
    """Print a final summary table to stdout."""
    passed = [r for r in results if r["exit_code"] == 0]
    failed = [r for r in results if r["exit_code"] != 0]

    print()
    print("=" * 50)
    print("  MUNIT RUN SUMMARY")
    print("=" * 50)
    print(f"  Total   : {len(projects)}")
    print(f"  Passed  : {len(passed)}")
    print(f"  Failed  : {len(failed)}")
    print("=" * 50)

    if failed:
        print()
        print("  Failed projects:")
        for r in failed:
            print(f"    - {r['project']} (exit {r['exit_code']})")
        print()


def main() -> None:
    args        = parse_args()
    list_file, script_file, logs_dir = validate_paths(args)
    projects    = load_projects(list_file)

    if not projects:
        print("[ERROR] No projects found in list file.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Projects   : {len(projects)}")
    print(f"[*] Script     : {script_file}")
    print(f"[*] Logs       : {logs_dir}")
    print(f"[*] Threads    : {args.threads}")
    print()

    results = run_all(projects, script_file, logs_dir, args.threads)
    print_summary(projects, results)


if __name__ == "__main__":
    main()
