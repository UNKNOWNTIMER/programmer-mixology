"""Read-only verification of the isolated install preference marker while app is stopped."""
import json, os, sqlite3, sys
from pathlib import Path

phase = sys.argv[1]
assert phase in {'upgrade', 'uninstall'}
root = Path(__file__).resolve().parents[1]
path = Path(os.environ['LOCALAPPDATA']) / 'local.pixelmix.workbench/pixelmix.sqlite'
assert path.is_file(), 'Installed user catalog must remain present'
con = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
state = json.loads(con.execute('SELECT json FROM settings WHERE key=?', ('ui_state',)).fetchone()[0])
assert state['installation_verification_marker'] == 'TEST_ONLY_REMOVE_AFTER_INSTALL_VERIFICATION'
assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
con.close()
result = {'phase': phase, 'passed': True, 'data_retained': True, 'preference_marker_retained': True, 'integrity_check': 'ok'}
(root / f'evidence/installer-{phase}-state-verified.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
