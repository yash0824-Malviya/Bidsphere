"""Register an already copied/installed local package in sites/apps.txt.

Run from the Bench root after `bench pip install -e apps/bidsphere_workflows`.
Read only unless --apply. This does not install the app on any ERP site.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil


def register(bench_root, apply=False):
    root = Path(bench_root).resolve(strict=True)
    app = Path(__file__).resolve().parent
    expected = root / "apps" / "bidsphere_workflows"
    registry = root / "sites" / "apps.txt"
    if expected.resolve() != app or not registry.is_file() or not (root / "apps" / "frappe").is_dir():
        raise RuntimeError("Run from the Bench root after copying this package to apps/bidsphere_workflows.")
    before = registry.read_bytes()
    if "bidsphere_workflows" in before.decode("utf-8").splitlines():
        return "Already registered; no change."
    if not apply:
        return "Would append bidsphere_workflows to sites/apps.txt. Re-run with --apply after installing the package."
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = registry.with_name(f"apps.txt.before-bidsphere-{timestamp}")
    shutil.copy2(registry, backup)
    if registry.read_bytes() != before:
        raise RuntimeError("sites/apps.txt changed during the check; no update was made. Retry after reviewing it.")
    with registry.open("ab") as target:
        target.write((b"" if not before or before.endswith(b"\n") else b"\n") + b"bidsphere_workflows\n")
    return f"Registered bidsphere_workflows; prior registry backed up to {backup}. No site installation performed."


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(register(Path.cwd(), apply=args.apply))
