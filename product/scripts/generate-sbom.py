"""Generate an inventory from actual resolved Cargo/npm metadata, without guessing licenses."""
import json
import subprocess
import shutil
from pathlib import Path
from datetime import datetime, timezone

PRODUCT = Path(__file__).resolve().parents[1]
application = json.loads((PRODUCT / 'apps/client/package.json').read_text(encoding='utf-8'))
application_version = application['version']
metadata = json.loads(subprocess.check_output(['cargo', '+stable', 'metadata', '--locked', '--format-version', '1'], cwd=PRODUCT, text=True, encoding='utf-8'))
components = []
license_root = PRODUCT / 'third_party_licenses'
license_root.mkdir(exist_ok=True)
def retain_notices(folder, name, version):
    destination = license_root / (name.replace('@','').replace('/','__')+'-'+version)
    count = 0
    for source in folder.iterdir():
        if source.is_file() and source.name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE','UNLICENSE')):
            destination.mkdir(exist_ok=True)
            shutil.copy2(source, destination/source.name)
            count += 1
    return count
for p in metadata['packages']:
    if p.get('source'):
        retain_notices(Path(p['manifest_path']).parent,p['name'],p['version'])
    components.append({'type':'library','name':p['name'],'version':p['version'],'purl':f"pkg:cargo/{p['name']}@{p['version']}",
                       'licenses':[{'expression':p['license']}] if p['license'] else [],
                       'properties':[{'name':'license_review','value':'metadata only; verify license text before public release'}]})
modules = PRODUCT / 'apps/client/node_modules/.pnpm'
for manifest in sorted(modules.glob('*/node_modules/*/package.json')) + sorted(modules.glob('*/node_modules/@*/*/package.json')):
    try:
        p = json.loads(manifest.read_text(encoding='utf-8'))
        if p.get('name') and p.get('version'):
            retain_notices(manifest.parent,p['name'],p['version'])
            component = {'type':'library','name':p['name'],'version':p['version'],'purl':f"pkg:npm/{p['name']}@{p['version']}"}
            license_value = p.get('license')
            component['licenses'] = [{'expression':license_value}] if isinstance(license_value,str) else []
            components.append(component)
    except (ValueError, OSError):
        pass
components = list({c['purl']:c for c in components}.values())
sbom = {'bomFormat':'CycloneDX','specVersion':'1.5','version':1,'metadata':{'timestamp':datetime.now(timezone.utc).isoformat(),'component':{'type':'application','name':'Programmer Mixology','version':application_version},'properties':[{'name':'scope','value':'Resolved dependencies including development and platform-specific dependencies, not an exact binary composition claim'}]},'components':components}
(PRODUCT/'SBOM.cdx.json').write_text(json.dumps(sbom, ensure_ascii=False, indent=2), encoding='utf-8')
rows = ['# Dependency license inventory', '', 'Generated from resolved package metadata. This is an inventory, not a completed redistribution-rights audit.', '', '| Package | Version | Declared license |', '|---|---|---|']
for c in sorted(components,key=lambda c:(c['name'],c['version'])):
    rows.append(f"| {c['name']} | {c['version']} | {c['licenses'][0]['expression'] if c['licenses'] else 'UNKNOWN - review required'} |")
(PRODUCT/'DEPENDENCY_LICENSES.md').write_text('\n'.join(rows)+'\n', encoding='utf-8')
print(f'Generated CycloneDX inventory for {len(components)} resolved components')
