const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/qwen-food-ai-client.js'),'utf8');
test('Qwen adapter security invariants',()=>{assert.doesNotMatch(src,/baseURL|workspace|console\.(log|error)/);assert.match(src,/Authorization:'Bearer '\+k/);assert.match(src,/response_format:\{type:'json_object'\}/);assert.match(src,/finish_reason!=='stop'/);assert.match(src,/MAX_RESPONSE = 512 \* 1024/);assert.match(src,/MAX_DIMENSION = 1280/);assert.match(src,/20_?000|20000/)});
