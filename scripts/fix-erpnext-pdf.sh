#!/usr/bin/env bash
# Remediate ERPNext/Frappe server-side PDF generation (wkhtmltopdf).
#
# Root cause observed on this deployment:
#   OSError: wkhtmltopdf ... ContentNotFoundError
#   → frappe.exceptions.ValidationError: PDF generation failed because of broken image links
#
# wkhtmltopdf runs inside the ERPNext container/host and must be able to HTTP-fetch
# every CSS/image URL embedded in the print HTML. Failures are typically:
#   1) host_name in site_config / System Settings points to a URL the container
#      cannot reach (wrong host/port, Docker service name, HTTPS vs HTTP).
#   2) Private company logos (/private/files/...) that wkhtmltopdf cannot auth.
#   3) Missing/unbuilt assets (run bench build).
#   4) Broken wkhtmltopdf install (need 0.12.6 with patched Qt).
#
# Run ON THE ERPNext server (bench site), not from the BidSphere SPA host.
#
# Usage:
#   SITE=your.site.name bash scripts/fix-erpnext-pdf.sh
#   # or inside the backend container:
#   docker exec -it <backend> bash /path/to/fix-erpnext-pdf.sh

set -euo pipefail

SITE="${SITE:-frontend}"
PUBLIC_HOST="${PUBLIC_HOST:-http://80.225.204.210:8090}"
# Prefer an address reachable FROM the process that runs wkhtmltopdf.
# For many Docker installs that is the frontend service, e.g. http://frontend:8080
INTERNAL_HOST="${INTERNAL_HOST:-}"

echo "==> Site: $SITE"
echo "==> Public host_name candidate: $PUBLIC_HOST"
echo "==> Internal host_name candidate: ${INTERNAL_HOST:-"(unset)"}"

if ! command -v bench >/dev/null 2>&1; then
  echo "ERROR: bench not found. Run this inside the Frappe bench environment." >&2
  exit 1
fi

echo "==> Checking wkhtmltopdf"
if command -v wkhtmltopdf >/dev/null 2>&1; then
  wkhtmltopdf --version || true
else
  echo "WARNING: wkhtmltopdf not on PATH. Install 0.12.6 (patched Qt)." >&2
fi

if [[ -n "$INTERNAL_HOST" ]]; then
  echo "==> Setting host_name to INTERNAL_HOST ($INTERNAL_HOST)"
  bench --site "$SITE" set-config host_name "$INTERNAL_HOST"
else
  echo "==> Setting host_name to PUBLIC_HOST ($PUBLIC_HOST)"
  bench --site "$SITE" set-config host_name "$PUBLIC_HOST"
fi

echo "==> Syncing System Settings.host_name via console"
bench --site "$SITE" console <<'PY'
import frappe
frappe.connect()
ss = frappe.get_single("System Settings")
host = frappe.conf.get("host_name") or ""
if host:
    ss.host_name = host
    ss.save(ignore_permissions=True)
    frappe.db.commit()
    print("System Settings.host_name =", ss.host_name)
else:
    print("No host_name in conf")
PY

echo "==> Making company logos public (wkhtmltopdf cannot auth /private/files)"
bench --site "$SITE" console <<'PY'
import frappe
frappe.connect()
for company in frappe.get_all("Company", pluck="name"):
    logo = frappe.db.get_value("Company", company, "company_logo")
    if not logo:
        continue
    if logo.startswith("/private/files/"):
        public = logo.replace("/private/files/", "/files/", 1)
        # Flip File.is_private when a File row exists
        files = frappe.get_all(
            "File",
            filters={"file_url": logo},
            pluck="name",
        )
        for name in files:
            doc = frappe.get_doc("File", name)
            doc.is_private = 0
            doc.save(ignore_permissions=True)
        frappe.db.set_value("Company", company, "company_logo", public)
        print(company, logo, "->", public)
    else:
        print(company, "logo ok", logo)
frappe.db.commit()
PY

echo "==> Clearing cache + rebuilding assets"
bench --site "$SITE" clear-cache
bench build --app frappe --app erpnext || bench build

echo "==> Smoke-test: curl print CSS from localhost"
# Adjust if nginx listens elsewhere inside the container.
for url in \
  "${INTERNAL_HOST:-http://127.0.0.1:8000}/assets/frappe/dist/css/print.bundle.css" \
  "${PUBLIC_HOST}/assets/frappe/dist/css/print.bundle.M3XR27HD.css"
do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$url" || echo "ERR")
  echo "  $code  $url"
done

echo "==> Done. Re-test Print / Download PDF in Desk."
echo "    If still failing, set INTERNAL_HOST to a URL that resolves INSIDE the"
echo "    wkhtmltopdf process (docker: often http://frontend:8080) and re-run."
