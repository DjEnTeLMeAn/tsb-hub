from pathlib import Path
import re,json

RELEASE='0.11.1-finance-v2-part1-report-20260807'
APP_VERSION='0.11.1-finance-v2-part1'
APP=Path('js/app.js'); INDEX=Path('index.html'); SW=Path('service-worker.js'); UPDATE=Path('js/update-manager.js'); MANIFEST=Path('manifest.json'); VERSION=Path('version.json'); TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); index=INDEX.read_text(); sw=SW.read_text(); update=UPDATE.read_text(); tests=TEST.read_text()

def function_range(source,name):
    token=f'function {name}('; start=source.find(token)
    if start<0: raise RuntimeError(f'Function not found: {name}')
    paren=source.find('(',start); depth=0; quote=None; esc=False; line=False; block=False; i=paren
    while i<len(source):
        c=source[i]; n=source[i+1] if i+1<len(source) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False; i+=1; continue
            if c=='\\': esc=True; i+=1; continue
            if c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='(': depth+=1
        elif c==')':
            depth-=1
            if depth==0: i+=1; break
        i+=1
    while i<len(source) and source[i].isspace(): i+=1
    if i>=len(source) or source[i]!='{': raise RuntimeError(f'Body not found: {name}')
    bdepth=0; quote=None; esc=False; line=False; block=False
    while i<len(source):
        c=source[i]; n=source[i+1] if i+1<len(source) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False; i+=1; continue
            if c=='\\': esc=True; i+=1; continue
            if c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='{': bdepth+=1
        elif c=='}':
            bdepth-=1
            if bdepth==0:return start,i+1
        i+=1
    raise RuntimeError(f'End not found: {name}')

# Finance-aware local insights must use the same derived v2 total.
legacy_balance="  const balance = Number(context.availableBalance || 0);"
if legacy_balance in app:
    app=app.replace(legacy_balance,"  const balance = getFinanceTotalBalance();",1)

# Patch only buildGptReport, leaving legacy storage compatibility helpers untouched.
a,b=function_range(app,'buildGptReport'); report=app[a:b]
if 'getFinanceTotalBalance()' not in report:
    goal_marker="  const goalLines = context.savingGoal ? context.savingGoal.split('\\n').map(line => `  - ${line}`).join('\\n') : '  - не указано';"
    if goal_marker not in report:
        # Source uses literal escaped line breaks in a template-heavy function; anchor on the variable declaration instead.
        idx=report.find('  const goalLines = context.savingGoal ?')
        if idx<0: raise RuntimeError('goalLines anchor missing')
        end=report.find('\n',idx)
        account_line="\n  const accountLines = getFinanceAccounts().length ? getFinanceAccounts().map(account => `  - ${account.name}: ${formatRub(getFinanceAccountBalance(account.id))}`).join('\\n') : '  - нет активных счетов';"
        report=report[:end]+account_line+report[end:]
    else:
        report=report.replace(goal_marker,goal_marker+"\n  const accountLines = getFinanceAccounts().length ? getFinanceAccounts().map(account => `  - ${account.name}: ${formatRub(getFinanceAccountBalance(account.id))}`).join('\\n') : '  - нет активных счетов';",1)

    report=report.replace("  Доступно сейчас: ${context.availableBalance ? formatRub(context.availableBalance) : 'не указано'}", "  Всего на счетах: ${formatRub(getFinanceTotalBalance())}\\\n  Счета:\\\n${accountLines}")
    report=report.replace("  Активы / резерв: ${context.reserveBalance ? formatRub(context.reserveBalance) : 'не указано'}", "  Legacy-резерв (не включён в счета): ${context.reserveBalance ? formatRub(context.reserveBalance) : 'не указано'}")
    if 'Всего на счетах:' not in report or 'accountLines' not in report: raise RuntimeError('GPT finance report replacement failed')
    app=app[:a]+report+app[b:]

app=re.sub(r"const APP_VERSION = '[^']+';",f"const APP_VERSION = '{APP_VERSION}';",app,count=1)

old=re.search(r'data-release="([^"]+)"',index)
if not old: raise RuntimeError('release marker missing')
old_release=old.group(1); index=index.replace(old_release,RELEASE); index=re.sub(r'<title>TSB Hub v[^<]+</title>','<title>TSB Hub v0.11.1</title>',index)
sw=re.sub(r"const RELEASE='[^']+';",f"const RELEASE='{RELEASE}';",sw,count=1)
update=re.sub(r'// TSB Hub v[^\n]+','// TSB Hub v0.11.1-finance-v2-part1-report — single PWA update authority.',update,count=1); update=re.sub(r"const RELEASE='[^']+';",f"const RELEASE='{RELEASE}';",update,count=1)
manifest=json.loads(MANIFEST.read_text()); manifest['start_url']=f'./index.html?v={RELEASE}'; manifest['version']=RELEASE
for icon in manifest.get('icons',[]): icon['src']=re.sub(r'\?v=.*$',f'?v={RELEASE}',icon['src'])
VERSION.write_text(json.dumps({'release':RELEASE,'publishedAt':'2026-08-07T18:36:00+05:00','cache':f'tsb-hub-{RELEASE}'},ensure_ascii=False,indent=2)+'\n')

if 'GPT report must use Finance v2 derived balance' not in tests:
    tests += "\n// GPT report must use Finance v2 derived balance, not cleared legacy availableBalance.\nconst reportStart=app.indexOf('function buildGptReport()');\nconst reportEnd=app.indexOf('function ',reportStart+20);\nconst reportFn=app.slice(reportStart,reportEnd>reportStart?reportEnd:app.length);\nassert.ok(reportFn.includes('getFinanceTotalBalance()'),'GPT report must use Finance v2 total balance');\nassert.ok(reportFn.includes('accountLines'),'GPT report must include account breakdown');\nassert.equal(reportFn.includes('context.availableBalance'),false,'GPT report must not use legacy availableBalance');\nassert.ok(reportFn.includes('Legacy-резерв'),'legacy reserve must be explicitly labeled');\n"

APP.write_text(app); INDEX.write_text(index); SW.write_text(sw); UPDATE.write_text(update); MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'); TEST.write_text(tests)
for path in ['scripts/finance-v2-report-fix.py','.github/workflows/finance-v2-report-fix.yml']:
    p=Path(path)
    if p.exists(): p.unlink()
print('Finance v2 report integrity fix applied')
