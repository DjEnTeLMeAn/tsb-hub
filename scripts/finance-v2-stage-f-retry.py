from pathlib import Path
import subprocess

stage=Path('scripts/finance-v2-stage-f.py')
text=stage.read_text()
start=text.index('def function_range(source,name):')
end=text.index('def replace_function(source,name,code):',start)
fixed=r'''def function_range(source,name):
    token=f'function {name}('; start=source.find(token)
    if start<0: raise RuntimeError(f'Function not found: {name}')
    paren=source.find('(',start); pdepth=0; quote=None; esc=False; line=False; block=False; i=paren
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
        if c=='(': pdepth+=1
        elif c==')':
            pdepth-=1
            if pdepth==0:
                i+=1; break
        i+=1
    while i<len(source) and source[i].isspace(): i+=1
    if i>=len(source) or source[i]!='{': raise RuntimeError(f'Body not found: {name}')
    brace=i; depth=0; quote=None; esc=False; line=False; block=False
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
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0:return start,i+1
        i+=1
    raise RuntimeError(f'End not found: {name}')
'''
text=text[:start]+fixed+text[end:]
stage.write_text(text)
subprocess.run(['python3',str(stage)],check=True)
# The finalizer removes its own old machinery; remove this retry machinery too.
for path in ['scripts/finance-v2-stage-f-retry.py','.github/workflows/finance-v2-stage-f-retry.yml']:
    p=Path(path)
    if p.exists(): p.unlink()
print('Stage F retry applied')
