"""Package only reviewed app/schema source and the manual deployment guide."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

workspace = Path(__file__).resolve().parent.parent
app_root = workspace / "erpnext_apps" / "bidsphere_workflows"
report = workspace / "docs" / "rfq-clm-procurement-team-routing-2026-09-23.md"

def package(name, entries):
    destination = workspace / "scratch" / name
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "purpose": "Existing RFQ CLM app: persisted Procurement Team routing, separate Contract creation, idempotency, sequential review",
        "live_deployment_performed": False,
        "files": [{"path": archive_path, "sha256": sha256(path.read_bytes()).hexdigest()} for archive_path, path in entries],
    }
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        for archive_path, path in entries:
            archive.write(path, archive_path)
        archive.writestr("DEPLOYMENT_MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
    with ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert not any(".env" in Path(name).parts or "__pycache__" in name for name in archive.namelist())
        for item in manifest["files"]:
            assert sha256(archive.read(item["path"])).hexdigest() == item["sha256"]
    result = {"package": str(destination), "sha256": sha256(destination.read_bytes()).hexdigest(), "files": len(entries), "verified": True}
    destination.with_suffix(".manifest.json").write_text(json.dumps({**manifest, **result}, indent=2) + "\n", encoding="utf-8")
    return result

app_files = sorted(path for path in app_root.rglob("*") if path.is_file()
                   and not {"__pycache__", "audit", ".git", ".pytest_cache"}.intersection(path.relative_to(app_root).parts)
                   and path.suffix != ".pyc" and path.name != ".env")
app = package("bidsphere_workflows-rfq-team-routing-2026-09-23.zip",
              [("bidsphere_workflows/" + path.relative_to(app_root).as_posix(), path) for path in app_files]
              + [("RFQ_TEAM_ROUTING_DEPLOYMENT.md", report)])

scripts = ["ecr-schema-erp-client.mjs", "clm-schema.mjs", "rfq-contract-schema.mjs",
           "rfq-award-contract-schema.mjs", "rfq-clm-lifecycle-schema.mjs", "rfq-clm-sequential-schema.mjs", "rfq-clm-workflow-schema.mjs",
           "setup-rfq-clm-branch.mjs", "setup-rfq-award-contract.mjs", "setup-rfq-clm-lifecycle.mjs", "setup-rfq-clm-sequential.mjs", "setup-rfq-clm-workflow.mjs"]
schema = package("bidsphere-rfq-team-routing-schema-2026-09-23.zip",
                 [("scripts/" + name, workspace / "scripts" / name) for name in scripts]
                 + [("RFQ_TEAM_ROUTING_DEPLOYMENT.md", report)])
print(json.dumps({"app": app, "schema": schema}, indent=2))

