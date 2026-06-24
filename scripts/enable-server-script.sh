#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Run on the ERPNext server to enable Server Scripts and create the
# GRN future-date bypass.
#
# Usage:
#   ssh user@80.225.204.210
#   cd /path/to/frappe-bench
#   bash enable-server-script.sh <sitename>
# ──────────────────────────────────────────────────────────────────────

SITE="${1:-$(ls sites/*/site_config.json 2>/dev/null | head -1 | cut -d/ -f2)}"

if [ -z "$SITE" ]; then
  echo "Usage: $0 <sitename>"
  exit 1
fi

echo "Site: $SITE"
echo ""

# 1. Enable Server Scripts in site config
echo "[1/3] Enabling server_script_enabled …"
bench --site "$SITE" set-config server_script_enabled 1

# 2. Copy the Python setup script and run it
echo "[2/3] Creating Server Script …"
bench --site "$SITE" execute enable_future_grn.setup

# 3. Restart so config takes effect
echo "[3/3] Restarting …"
bench restart

echo ""
echo "✓ Done. Future-dated GRNs are now enabled."
echo "  Disable: uncheck Stock Settings > Allow Future GRN Dates"
