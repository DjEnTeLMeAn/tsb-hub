from pathlib import Path
import subprocess

RELEASE='0.12.0-finance-v2-part2-20260807'
subprocess.run(['python3','scripts/finance-v2-part2-stage-g.py'],check=True)
p=Path('tests/app-static.test.cjs')
s=p.read_text()
old="assert.ok(reportFn.includes('getFinanceTotalBalance()'),'GPT report must use Finance v2 total balance');"
new="assert.ok(reportFn.includes('getFinanceCoverage()'),'GPT report must use Finance v2 Part2 coverage including total balance');"
if old not in s:
    raise RuntimeError('stale Part1 GPT total-balance assertion not found')
s=s.replace(old,new,1)
anchor="const fs=require('node:fs');\n"
if "const RELEASE='0.12.0-finance-v2-part2-20260807';" not in s:
    if anchor not in s: raise RuntimeError('static test fs anchor missing')
    s=s.replace(anchor,anchor+f"const RELEASE='{RELEASE}';\n",1)
p.write_text(s)
print('Finance v2 Part2 stage G retry patch applied')