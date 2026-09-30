const fs=require('fs'),path=require('path'),cp=require('child_process');
const project=path.join(__dirname,'..'),root=path.join(project,'src');
const files=[];(function walk(d){for(const x of fs.readdirSync(d)){const p=path.join(d,x);if(fs.statSync(p).isDirectory())walk(p);else if(x.endsWith('.js'))files.push(p)}})(root);
let bad=0;
for(const f of files){const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0){bad++;console.error(`[SYNTAX] ${path.relative(project,f)}\n${r.stderr||r.stdout}`);}}
for(const f of files){const s=fs.readFileSync(f,'utf8');const re=/require\([\"'](\.\.?\/[^\"']+)[\"']\)/g;let m;while((m=re.exec(s))){const rel=m[1],base=path.resolve(path.dirname(f),rel);const candidates=[base,`${base}.js`,path.join(base,'index.js')];if(!candidates.some(fs.existsSync)){bad++;console.error(`[LOCAL REQUIRE] ${path.relative(project,f)} -> ${rel}`);}}}
const utilsDir=path.join(root,'utils');if(fs.existsSync(utilsDir)){bad++;console.error('[DUPLICATE UTILS] src/utils directory should not exist; use src/utils.js');}
const env=fs.readFileSync(path.join(project,'.env.example'),'utf8');if(/DISCORD_TOKEN=.{10,}|OPENAI_API_KEY=sk-/.test(env)){bad++;console.error('[SECRET] .env.example appears to contain a real secret');}
if(bad)process.exit(1);console.log(`Static checks OK: ${files.length} JavaScript files.`);
