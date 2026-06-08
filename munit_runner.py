"""
munit_runner.py
---------------
Runs MUnit tests for multiple Mule projects in parallel or consolidates coverage reports.

Usage:
    # Mode: munit (Default)
    python munit_runner.py --mode munit --root C:/Repos --list projects.csv --script mvn-munit.sh --logs ./logs --threads 4
    
    # Mode: report
    python munit_runner.py --mode report --root C:/Repos --list projects.csv --reports ./consolidated_reports
"""

import argparse
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="munit_runner.py",
        description="Run MUnit tests across multiple Mule projects or consolidate coverage reports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--mode",
        choices=["munit", "report"],
        default="munit",
        help="Execution mode: 'munit' runs tests (default), 'report' collects test coverage details.",
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
        metavar="FILE",
        help="Full path to mvn-munit.sh to execute for each project (Required for mode: munit).",
    )
    parser.add_argument(
        "--logs",
        metavar="DIR",
        help="Directory where Maven output logs will be written (Required for mode: munit).",
    )
    parser.add_argument(
        "--reports",
        metavar="DIR",
        help="Directory where consolidated coverage reports will be aggregated (Required for mode: report).",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=4,
        metavar="N",
        help="Number of projects to run in parallel (default: 4, used in mode: munit).",
    )
    return parser.parse_args()


def load_projects(list_file: Path) -> list[str]:
    return [
        line.strip()
        for line in list_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def validate_inputs(args: argparse.Namespace) -> dict:
    root_dir = Path(args.root)
    list_file = Path(args.list)

    errors = []
    if not root_dir.exists():
        errors.append(f"Root directory not found: {root_dir}")
    if not list_file.exists():
        errors.append(f"Project list not found: {list_file}")

    validated = {"root": root_dir, "list": list_file}

    if args.mode == "munit":
        if not args.script:
            errors.append("--script is required when --mode is 'munit'")
        if not args.logs:
            errors.append("--logs is required when --mode is 'munit'")
        
        if not errors:
            script_file = Path(args.script)
            if not script_file.exists():
                errors.append(f"Maven script not found: {script_file}")
            validated["script"] = script_file
            validated["logs"] = Path(args.logs)
            validated["logs"].mkdir(parents=True, exist_ok=True)

    elif args.mode == "report":
        if not args.reports:
            errors.append("--reports directory path is required when --mode is 'report'")
        if not errors:
            validated["reports"] = Path(args.reports)
            validated["reports"].mkdir(parents=True, exist_ok=True)

    if errors:
        for e in errors:
            print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)

    return validated


def build_powershell_command(project: str, root_dir: Path, script_file: Path, logs_dir: Path) -> str:
    log_file = (logs_dir / f"{project}.log").as_posix()
    exitcode_file = (logs_dir / f"{project}.exitcode").as_posix()
    script_path = script_file.as_posix()
    root_path = root_dir.as_posix()

    return (
        f"$Host.UI.RawUI.WindowTitle = 'MUNIT: {project}'; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"Write-Host '  PROJECT: {project}' -ForegroundColor Cyan; "
        f"Write-Host '  ROOT   : {root_path}' -ForegroundColor Cyan; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"cmd /c \"bash '{script_path}' '{project}' 2>&1\" | Tee-Object -FilePath '{log_file}'; "
        f"$code = $LASTEXITCODE; "
        f"Set-Content -Path '{exitcode_file}' -Value $code; "
        f"Write-Host ''; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"if ($code -eq 0) {{ Write-Host '  PASSED: {project}' -ForegroundColor Green }} "
        f"else {{ Write-Host '  FAILED: {project} (exit $code)' -ForegroundColor Red }}; "
        f"Write-Host '==============================' -ForegroundColor Cyan; "
        f"Read-Host 'Press ENTER to close this window'"
    )


def launch_project(project: str, root_dir: Path, script_file: Path, logs_dir: Path) -> dict:
    project_path = root_dir / project
    if not project_path.exists():
        print(f"[!] SKIP: {project} not found at {project_path}")
        return {"project": project, "exit_code": -1, "skipped": True}

    cmd = build_powershell_command(project, root_dir, script_file, logs_dir)
    proc = subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    print(f"[>] Launched: {project} (PID {proc.pid})")
    proc.wait()

    exitcode_file = logs_dir / f"{project}.exitcode"
    exit_code = int(exitcode_file.read_text().strip()) if exitcode_file.exists() else proc.returncode

    return {"project": project, "exit_code": exit_code, "skipped": False}


def run_all_munit(projects: list[str], root_dir: Path, script_file: Path, logs_dir: Path, threads: int) -> list[dict]:
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


def consolidate_reports(projects: list[str], root_dir: Path, reports_dir: Path) -> None:
    print(f"[*] Extracting full coverage assets into: {reports_dir}\n")
    success_count = 0
    missing_count = 0

    for project in projects:
        project_path = root_dir / project
        
        # MUnit coverage directory contains summary.html, folders for CSS, JS, and nested package HTML modules
        target_coverage_path = project_path / "target" / "site" / "munit" / "coverage"
        destination_path = reports_dir / project

        if not project_path.exists():
            print(f"  [\033[91mSKIPPED\033[0m] Repo folder missing: {project}")
            missing_count += 1
            continue

        if target_coverage_path.exists():
            # Drop old structural copies for this specific project if they exist
            if destination_path.exists():
                shutil.rmtree(destination_path)
            
            # CRITICAL: shutil.copytree clones the directory tree recursively. 
            # This completely copies summary.html along with css/, js/, and all sub-packages, preserving relative links.
            shutil.copytree(target_coverage_path, destination_path)
            print(f"  [\033[92mEXTRACTED\033[0m] Full coverage report package for: {project}")
            success_count += 1
        else:
            print(f"  [\033[93mWARNING\033[0m] No coverage data located at: {project}/target/site/munit/coverage")
            missing_count += 1

    print("\n" + "=" * 50)
    print("  REPORT GENERATION SUMMARY")
    print("=" * 50)
    print(f"  Successfully Aggregated : {success_count}")
    print(f"  Missing or Unbuilt     : {missing_count}")
    print(f"  Total Checked          : {len(projects)}")
    print("=" * 50 + "\n")


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
    print()


def main() -> None:
    args = parse_args()
    paths = validate_inputs(args)
    projects = load_projects(paths["list"])

    if not projects:
        print("[ERROR] No targets populated inside your reference list.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Mode       : {args.mode}")
    print(f"[*] Root       : {paths['root']}")
    print(f"[*] Total Apps : {len(projects)}")

    if args.mode == "munit":
        print(f"[*] Script     : {paths['script']}")
        print(f"[*] Logs       : {paths['logs']}")
        print(f"[*] Threads    : {args.threads}")
        print()
        results = run_all_munit(projects, paths["root"], paths["script"], paths["logs"], args.threads)
        print_summary(results)
    
    elif args.mode == "report":
        consolidate_reports(projects, paths["root"], paths["reports"])


if __name__ == "__main__":
    main()
