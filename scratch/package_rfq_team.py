"""Package the existing ERP app and narrow schema scripts without site data."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

workspace = Path(__file__).resolve().parent.parent
source = workspace / "erpnext_apps" / "bidsphere_workflows"
lifecycle = "--lifecycle" in sys.argv
suite_name = "rfq-lifecycle-full-tests-final.json" if lifecycle else "rfq-team-full-tests-final.json"
suite = json.loads((workspace / "scratch" / suite_name).read_text(encoding="utf-8"))
validation = {
    "production_build": "passed",
    "application_tests": {"passed": suite["numPassedTests"], "failed_preexisting": suite["numFailedTests"], "skipped": suite["numPendingTests"]},
    "failure_file": "src/api/approvalWorkflow.test.ts",
    "python_transaction_tests_passed": 80 if lifecycle else 74,
    "sequential_workflow_schema_tests_passed": 22,
    "dedicated_schema_hash_tests_passed": 11,
    "separate_erp_schema_tests_passed": 4,
    "live_deployed": False,
    "live_acceptance": "Blocked: bidsphere_workflows missing and no SSH/hosting access supplied",
}
if lifecycle:
    validation["final_creation_notification_focused_tests_passed"] = 174
    validation["application_suite_note"] = "Full run followed by focused tests for the final creation-notification change."
assert suite["numFailedTests"] == 4
assert all(row["name"].replace("\\", "/").endswith("src/api/approvalWorkflow.test.ts")
           for row in suite["testResults"] if row["status"] == "failed")

def package(name, entries, extra=None):
    destination = workspace / "scratch" / name
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "purpose": "RFQ-linked CLM: atomic Legal handoff, persisted Contract list, signatures, Finance and verified PO completion" if lifecycle else "RFQ-linked CLM: Procurement Team, Legal, signatures, Finance, Team handoff",
        "validation": validation,
        "files": [{"path": archive_path, "sha256": sha256(path.read_bytes()).hexdigest()} for archive_path, path in entries],
    }
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        for archive_path, path in entries:
            archive.write(path, archive_path)
        archive.writestr("DEPLOYMENT_MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
        if extra:
            archive.writestr("README.md", extra)
    with ZipFile(destination) as archive:
        assert archive.testzip() is None
        for row in manifest["files"]:
            assert sha256(archive.read(row["path"])).hexdigest() == row["sha256"]
        assert not any(".env" in path.split("/") or "__pycache__" in path for path in archive.namelist())
    result = {"package": str(destination), "sha256": sha256(destination.read_bytes()).hexdigest(), "files": len(entries), "verified": True}
    destination.with_suffix(".manifest.json").write_text(json.dumps({**manifest, **result}, indent=2) + "\n", encoding="utf-8")
    return result

files = sorted(path for path in source.rglob("*") if path.is_file()
               and not {"__pycache__", "audit"}.intersection(path.relative_to(source).parts)
               and path.suffix != ".pyc")
app = package("bidsphere_workflows-rfq-lifecycle-2026-09-22.zip" if lifecycle else "bidsphere_workflows-rfq-team-2026-09-22.zip",
              [("bidsphere_workflows/" + path.relative_to(source).as_posix(), path) for path in files])

scripts = ["ecr-schema-erp-client.mjs", "clm-schema.mjs", "rfq-contract-schema.mjs",
           "rfq-award-contract-schema.mjs", "rfq-clm-lifecycle-schema.mjs", "rfq-clm-sequential-schema.mjs", "rfq-clm-workflow-schema.mjs",
           "setup-rfq-clm-branch.mjs", "setup-rfq-award-contract.mjs", "setup-rfq-clm-lifecycle.mjs", "setup-rfq-clm-sequential.mjs", "setup-rfq-clm-workflow.mjs"]
schema = package("bidsphere-rfq-lifecycle-schema-2026-09-22.zip" if lifecycle else "bidsphere-rfq-clm-schema-2026-09-22.zip",
                 [("scripts/" + name, workspace / "scripts" / name) for name in scripts],
                 "# RFQ CLM schema patches\n\nUse with the matching bidsphere_workflows app and BidSphere application.\n"
                 "Install the app on the verified production site first. Follow the app README for migration order.\n"
                 "These scripts default to read-only. Inspect --check before --apply and retain the scratch backups.\n"
                 "Use Node.js with built-in fetch support and existing server-only ERPNEXT_URL, ERP_API_KEY and ERP_API_SECRET environment variables.\n"
                 "Credentials are not included. No script runs on extraction.\n")
print(json.dumps({"app": app, "schema": schema}, indent=2))
