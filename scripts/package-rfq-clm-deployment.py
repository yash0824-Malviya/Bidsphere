"""Package the existing RFQ CLM app and reviewed schema scripts without secrets.

Run with Python 3.11+: python scripts/package-rfq-clm-deployment.py --release TAG
This builds source ZIPs only. It does not install dependencies or contact ERPNext.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import tomllib
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "erpnext_apps" / "bidsphere_workflows"
SCHEMA_SCRIPTS = (
    "ecr-schema-erp-client.mjs", "clm-schema.mjs", "rfq-contract-schema.mjs",
    "rfq-award-contract-schema.mjs", "rfq-clm-lifecycle-schema.mjs",
    "rfq-clm-sequential-schema.mjs", "rfq-clm-workflow-schema.mjs",
    "setup-rfq-clm-branch.mjs", "setup-rfq-award-contract.mjs",
    "setup-rfq-clm-lifecycle.mjs", "setup-rfq-clm-sequential.mjs",
    "setup-rfq-clm-workflow.mjs",
)


def write_package(destination, entries, metadata):
    if destination.exists() or destination.with_suffix(".manifest.json").exists():
        raise RuntimeError(f"Release already exists: {destination.name}. Use a new release tag.")
    files = [{"path": name, "sha256": sha256(path.read_bytes()).hexdigest()} for name, path in entries]
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "app": metadata["project"]["name"], "version": metadata["project"]["version"],
        "release_kind": "source", "live_deployment_performed": False,
        "file_count": len(files), "files": files,
    }
    with ZipFile(destination, "x", ZIP_DEFLATED) as archive:
        for name, path in entries:
            archive.write(path, name)
        archive.writestr("DEPLOYMENT_MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
    with ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(files) + 1
        for item in files:
            assert sha256(archive.read(item["path"])).hexdigest() == item["sha256"]
        assert not any(part.startswith(".env") or part in ("__pycache__", ".git", "audit")
                       for name in archive.namelist() for part in Path(name).parts)
    result = {"package": str(destination), "sha256": sha256(destination.read_bytes()).hexdigest(),
              "file_count": len(files), "verified": True, "live_deployment_performed": False}
    destination.with_suffix(".manifest.json").write_text(
        json.dumps({**manifest, **result}, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, help="New lowercase release tag, for example rfq95-2026-09-23")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", args.release):
        parser.error("Use a lowercase alphanumeric/hyphen release tag (maximum 80 characters).")
    metadata = tomllib.loads((APP / "pyproject.toml").read_text())
    assert metadata["project"]["name"] == "bidsphere_workflows"
    assert metadata["build-system"]["build-backend"] == "flit_core.buildapi"
    app_files = sorted(path for path in APP.rglob("*") if path.is_file()
                       and path.suffix in (".py", ".toml", ".md", ".txt", ".ts", ".mjs", ".json")
                       and not any(part.startswith(".env") or part in ("__pycache__", "audit", ".git", ".pytest_cache")
                                   for part in path.relative_to(APP).parts))
    output = ROOT / "scratch"
    output.mkdir(exist_ok=True)
    app = write_package(output / f"bidsphere_workflows-{args.release}.zip",
                        [("bidsphere_workflows/" + path.relative_to(APP).as_posix(), path) for path in app_files], metadata)
    schema = write_package(output / f"bidsphere-rfq-clm-schema-{args.release}.zip",
                           [("scripts/" + name, ROOT / "scripts" / name) for name in SCHEMA_SCRIPTS]
                           + [("DEPLOYMENT_README.md", APP / "README.md")], metadata)
    print(json.dumps({"app": app, "schema": schema}, indent=2))


if __name__ == "__main__":
    main()
