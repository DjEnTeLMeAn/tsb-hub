from pathlib import Path
import subprocess

subprocess.run(['python3','scripts/finance-v2-part2-stage-g.py'],check=True)
p=Path('tests/app-static.test.cjs')
s=p.read_text()
old="assert.ok(reportFn.includes('getFinanceTotalBalance()'),'GPT report must use Finance v2 total balance');"
new="assert.ok(reportFn.includes('getFinanceCoverage()'),'GPT report must use Finance v2 Part2 coverage including total balance');"
if old not in s:
    raise RuntimeError('stale Part1 GPT total-balance assertion not found')
s=s.replace(old,new,1)
p.write_text(s)
print('Finance v2 Part2 stage G retry patch applied')