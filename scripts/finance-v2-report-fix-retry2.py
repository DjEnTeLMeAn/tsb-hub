from pathlib import Path
import subprocess

script=Path('scripts/finance-v2-report-fix.py')
text=script.read_text()
needle="app=APP.read_text(); index=INDEX.read_text(); sw=SW.read_text(); update=UPDATE.read_text(); tests=TEST.read_text()"
replacement=needle+"\ntests=tests.replace(\"0.11.0-finance-v2-part1-20260807\",RELEASE).replace(\"0.11.0-finance-v2-part1\",APP_VERSION)"
if needle not in text:
    raise RuntimeError('report fix bootstrap line not found')
script.write_text(text.replace(needle,replacement,1))
subprocess.run(['python3',str(script)],check=True)
for path in [
  'scripts/finance-v2-report-fix-retry.py','scripts/finance-v2-report-fix-retry2.py',
  '.github/workflows/finance-v2-report-fix-retry.yml','.github/workflows/finance-v2-report-fix-retry2.yml'
]:
    p=Path(path)
    if p.exists(): p.unlink()
print('Report fix final retry applied')
