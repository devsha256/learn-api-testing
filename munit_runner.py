"""
munit_runner.py
---------------
Runs MUnit tests for multiple Mule projects in parallel.
Each project opens a dedicated PowerShell window showing live Maven output.

Usage:
    python munit_runner.py --root C:/Repos --list projects.csv --script mvn-munit.sh --logs ./logs --threads 4
    python munit_runner.py --help
"""

import argparse
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="munit_runner.py",
        description="Run MUnit tests across multiple Mule projects in parallel.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
    python munit_runner.py --root C:/VistrCorp/AzureRepos --list projects.csv --script mvn-munit.sh --logs ./logs --threads 4
    python munit_runner.py --root C:/Repos --list repos.txt --script /path/to/mvn-munit.sh --logs C:/audit/logs

NOTES:
    - --root     root directory where all repository folders live.
    - --list     plain text or CSV file with one repository folder name per line, no header.
    - --script   full path to mvn-munit.sh to execute for each project.
    - --logs     directory where Maven output logs will be written, one file per project.
    - --threads  number of projects to run in parallel (default: 4).
    - Each project opens in its own PowerShell window with live Maven output.
    - Press ENTER in each window to close it after the run completes.
        """,
    )
    parser.add_argument(
        "--root",
        required=True,
        metavar="DIR",
        help="Root directory containing all repository folders.",
    )
    parser.add_argument(
        "--list",
        required=True,
        metavar="FILE",
        help="Path to txt/csv file containing repository folder names, one per line.",
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
        help="Directory where Maven output logs will be written.",
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
    return [
        line.strip()
        for line in list_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def validate_paths(args: argparse.Namespace) -> tuple[Path, Path, Path, Path]:
    root_dir    = Path(args.root)
    list_file   = Path(args.list)
    script_file = Path(args.script)
    logs_dir    = Path(args.logs)

    errors = []
    if not root_dir.exists():
        errors.append(f"Root directory not found: {root_dir}")
    if not list_file.exists():
        errors.append(f"Project list not found: {list_file}")
    if not script_file.exists():
        errors.append(f"Maven script not found: {script_file}")
    if errors:
        for e in errors:
            print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)

    logs_dir.mkdir(parents=True, exist_ok=True)
    return root_dir, list_file, script_file, logs_dir


def build_powershell_command(
    project: str,
    root_dir: Path,
    script_file: Path,
    logs_dir: Path,
) -> str:
    """
    Build a single-line PowerShell command string for the child window.
    Uses cmd /c bash to avoid PowerShell misinterpreting bash stderr as errors.
    All statements separated by semicolons - no line breaks, no backticks.
    """
    log_file      = (logs_dir / f"{project}.log").as_posix()
    exitcode_file = (logs_dir / f"{project}.exitcode").as_posix()
    script_path   = script_file.as_posix()
    root_path     = root_dir.as_posix()

    return (
        f"$Host.UI.RawUI.WindowTitle = 'MUNIT: {project}'; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"Write-Host '  PROJECT: {project}' -ForegroundColor Cyan; "
        f"Write-Host '  ROOT   : {root_path}' -ForegroundColor Cyan; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"cmd /c \"bash '{script_path}' '{root_path}' '{project}' 2>&1\" | Tee-Object -FilePath '{log_file}'; "
        f"$code = $LASTEXITCODE; "
        f"Set-Content -Path '{exitcode_file}' -Value $code; "
        f"Write-Host ''; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"if ($code -eq 0) {{ Write-Host '  PASSED: {project}' -ForegroundColor Green }} "
        f"else {{ Write-Host '  FAILED: {project} (exit $code)' -ForegroundColor Red }}; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"Read-Host 'Press ENTER to close this window'"
    )


def launch_project(
    project: str,
    root_dir: Path,
    script_file: Path,
    logs_dir: Path,
) -> dict:
    project_path = root_dir / project
    if not project_path.exists():
        print(f"[!] SKIP: {project} not found at {project_path}")
        return {"project": project, "exit_code": -1, "skipped": True}

    cmd  = build_powershell_command(project, root_dir, script_file, logs_dir)
    proc = subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    print(f"[>] Launched: {project} (PID {proc.pid})")
    proc.wait()

    exitcode_file = logs_dir / f"{project}.exitcode"
    exit_code = int(exitcode_file.read_text().strip()) if exitcode_file.exists() else proc.returncode

    return {"project": project, "exit_code": exit_code, "skipped": False}


def run_all(
    projects: list[str],
    root_dir: Path,
    script_file: Path,
    logs_dir: Path,
    threads: int,
) -> list[dict]:
    results = []
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = {
            executor.submit(launch_project, p, root_dir, script_file, logs_dir): p
            for p in projects
        }
        for future in as_completed(futures):
            result = future.result()
            if result.get("skipped"):
                print(f"  [SKIP] {result['project']}")
            elif result["exit_code"] == 0:
                print(f"  [\033[92mPASSED\033[0m] {result['project']}")
            else:
                print(f"  [\033[91mFAILED\033[0m] {result['project']} (exit {result['exit_code']})")
            results.append(result)
    return results


def print_summary(results: list[dict]) -> None:
    passed  = [r for r in results if not r.get("skipped") and r["exit_code"] == 0]
    failed  = [r for r in results if not r.get("skipped") and r["exit_code"] != 0]
    skipped = [r for r in results if r.get("skipped")]

    print()
    print("=" * 50)
    print("  MUNIT RUN SUMMARY")
    print("=" * 50)
    print(f"  Total   : {len(results)}")
    print(f"  Passed  : {len(passed)}")
    print(f"  Failed  : {len(failed)}")
    print(f"  Skipped : {len(skipped)}")
    print("=" * 50)

    if failed:
        print()
        print("  Failed projects:")
        for r in failed:
            print(f"    - {r['project']} (exit {r['exit_code']})")
    if skipped:
        print()
        print("  Skipped projects (folder not found):")
        for r in skipped:
            print(f"    - {r['project']}")
    print()


def main() -> None:
    args = parse_args()
    root_dir, list_file, script_file, logs_dir = validate_paths(args)
    projects = load_projects(list_file)

    if not projects:
        print("[ERROR] No projects found in list file.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Root       : {root_dir}")
    print(f"[*] Projects   : {len(projects)}")
    print(f"[*] Script     : {script_file}")
    print(f"[*] Logs       : {logs_dir}")
    print(f"[*] Threads    : {args.threads}")
    print()

    results = run_all(projects, root_dir, script_file, logs_dir, args.threads)
    print_summary(results)


if __name__ == "__main__":
    main()
