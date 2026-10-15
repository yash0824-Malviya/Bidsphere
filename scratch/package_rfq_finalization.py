"""Package the reviewed ERP extension only; no credentials, data or caches."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

workspace = Path(__file__).resolve().parent.parent
source = workspace / "erpnext_apps" / "bidsphere_workflows"
destination = workspace / "scratch" / "bidsphere_workflows-rfq-finalization-2026-09-21.zip"
files = sorted(path for path in source.rglob("*") if path.is_file()
               and not {"__pycache__", "audit"}.intersection(path.relative_to(source).parts)
               and path.suffix != ".pyc")
manifest = {
    "created_at": datetime.now(timezone.utc).isoformat(),
    "purpose": "Atomic RFQ award to real CLM Contract Draft and conditional procurement gate",
    "live_erp_installed": False,
    "deployment_instructions": "bidsphere_workflows/README.md",
    "validation": {
        "production_build": "passed",
        "full_application_vitest": {"passed": 2312, "failed_preexisting": 4, "skipped": 3},
        "preexisting_failure_file": "src/api/approvalWorkflow.test.ts",
        "python_transaction_lifecycle_tests": {"passed": 60, "failed": 0},
        "dedicated_schema_and_cross_runtime_hash_tests": {"passed": 11, "failed": 0},
        "additive_award_lifecycle_schema_tests": {"passed": 13, "failed": 0},
        "limitation": "Portable transaction fixtures; live Bench/MariaDB and authenticated signing acceptance remains required."
    },
    "files": [{"path": str(path.relative_to(source)).replace("\\", "/"),
               "sha256": sha256(path.read_bytes()).hexdigest()} for path in files],
}
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, "bidsphere_workflows/" + path.relative_to(source).as_posix())
    archive.writestr("bidsphere_workflows/DEPLOYMENT_MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
with ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(files) + 1
    for row in manifest["files"]:
        assert sha256(archive.read("bidsphere_workflows/" + row["path"])).hexdigest() == row["sha256"]
manifest["package"] = destination.name
manifest["package_sha256"] = sha256(destination.read_bytes()).hexdigest()
(destination.parent / "rfq-finalization-package-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"package": str(destination), "files": len(files), "sha256": manifest["package_sha256"], "archive_verified": True}))
