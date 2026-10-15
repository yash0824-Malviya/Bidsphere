import json
from pathlib import Path

root = Path('/home/victus/frappe-bench')
def safe_config(path):
    if not path.exists():
        return None
    obj = json.loads(path.read_text())
    return {key: obj[key] for key in ('host_name', 'webserver_port', 'socketio_port', 'db_host', 'db_port', 'default_site', 'serve_default_site') if key in obj}
print(json.dumps({
    'bench': str(root),
    'apps': (root/'sites/apps.txt').read_text().splitlines(),
    'app_directories': [p.name for p in (root/'apps').iterdir() if p.is_dir()],
    'common_config': safe_config(root/'sites/common_site_config.json'),
    'sites': [{'name': p.parent.name, 'config': safe_config(p)} for p in (root/'sites').glob('*/site_config.json')],
    'python_exists': (root/'env/bin/python').exists(),
}, indent=2))
