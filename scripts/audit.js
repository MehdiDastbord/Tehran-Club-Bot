const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.join(__dirname,'..'),src=path.join(root,'src');
const files=[];(function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n);const st=fs.statSync(p);if(st.isDirectory())walk(p);else if(n.endsWith('.js'))files.push(p)}})(src);
let failures=0;
for(const f of files){const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0){failures++;console.error('[FAIL SYNTAX]',path.relative(root,f),r.stderr||r.stdout)}}
for(const f of files){const text=fs.readFileSync(f,'utf8');const re=/require\(["'](\.\.?\/[^"']+)["']\)/g;let m;while((m=re.exec(text))){const base=path.resolve(path.dirname(f),m[1]);if(![base,base+'.js',path.join(base,'index.js')].some(fs.existsSync)){failures++;console.error('[FAIL LOCAL REQUIRE]',path.relative(root,f),m[1])}}}
for(const f of files){const text=fs.readFileSync(f,'utf8');if(/TODO|FIXME|XXX/i.test(text)){failures++;console.error('[FAIL PLACEHOLDER]',path.relative(root,f))}}
const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');if(/DISCORD_TOKEN=.{10,}|OPENAI_API_KEY=sk-/.test(env)){failures++;console.error('[FAIL SECRET] .env.example contains a likely secret')}
const dbText=fs.readFileSync(path.join(src,'db.js'),'utf8');
const xpText=fs.readFileSync(path.join(src,'services/xpService.js'),'utf8');
const staffText=fs.readFileSync(path.join(src,'services/staffService.js'),'utf8');
const outboxText=fs.readFileSync(path.join(src,'services/discordOutboxService.js'),'utf8');
if(!/version: 9/.test(dbText)){failures++;console.error('[FAIL MIGRATION] V19 migration missing')}
if(!/version: 12/.test(dbText)){failures++;console.error('[FAIL MIGRATION] cumulative ticket claim migration missing')}
if(!/function claimLeaderboard\(guildId\)/.test(fs.readFileSync(path.join(src,'services/ticketService.js'),'utf8'))){failures++;console.error('[FAIL TICKET LEADERBOARD] cumulative leaderboard function missing')}
if(!/outbox\.enqueueRoleTx\([^;]+,db\)/s.test(xpText)){failures++;console.error('[FAIL XP OUTBOX] XP update is not transactionally coupled to outbox')}
if(!/outbox\.enqueueRoleTx\([^;]+,db\)/s.test(staffText)){failures++;console.error('[FAIL STAFF OUTBOX] Staff update is not transactionally coupled to outbox')}
if(!/function enqueueRoleTx/.test(outboxText)){failures++;console.error('[FAIL OUTBOX] transactional enqueue missing')}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));if(pkg.version!=='23.0.0'){failures++;console.error('[FAIL VERSION]',pkg.version)}
const lockSvc=fs.readFileSync(path.join(src,'services/discordOutboxService.js'),'utf8');
if(!/lease_until/.test(lockSvc)||!/claim_token/.test(lockSvc)){failures++;console.error('[FAIL OUTBOX LEASE] lease/claim missing')}
if(/ON CONFLICT\(entity_type,entity_id\).*WHERE/.test(lockSvc)){failures++;console.error('[FAIL OUTBOX CONFLICT] partial conflict target still used')}
const delivery=fs.readFileSync(path.join(src,'services/discordDeliveryService.js'),'utf8');
if(!/dedupe_key/.test(delivery)||!/lease_until/.test(delivery)){failures++;console.error('[FAIL DELIVERY OUTBOX] durable delivery queue incomplete')}
const inv=fs.readFileSync(path.join(src,'services/inviteService.js'),'utf8');
if(!/attribution_status/.test(inv)){failures++;console.error('[FAIL INVITE ATTRIBUTION] status missing')}
if(!/next_attempt_at/.test(dbText)){failures++;console.error('[FAIL RETRY] next_attempt_at missing in DB schema')}
if(!/db\.transaction\(\(\)\s*=>/.test(outboxText)||!/UPDATE discord_sync_outbox/.test(outboxText)){failures++;console.error('[FAIL OUTBOX CLAIM] transactional claim missing')}
if(!/enqueueEditTx/.test(delivery)){failures++;console.error('[FAIL DELIVERY EDIT] edit queue missing')}
if(!/drop:message/.test(fs.readFileSync(path.join(src,'services/dropService.js'),'utf8'))){failures++;console.error('[FAIL DROP EDIT QUEUE] drop message edit not queued')}
if(!/giveaway:message/.test(fs.readFileSync(path.join(src,'services/giveawayService.js'),'utf8'))){failures++;console.error('[FAIL GIVEAWAY EDIT QUEUE] giveaway message edit not queued')}
if(!/attribution_status/.test(inv)){failures++;console.error('[FAIL INVITE ATTRIBUTION] status missing')}
if(failures){process.exitCode=1;console.error(`Audit failed: ${failures} issue(s)`)}else console.log(`Production static audit OK: ${files.length} JS files; dependency installation/live Discord checks must be run in an environment with npm/Discord access.`);

const indexText=fs.readFileSync(path.join(src,'index.js'),'utf8'); if(/handleMusic|musicService|music\.queue|music\.control/.test(indexText)){failures++;console.error('[FAIL MUSIC REMNANTS] Music code remains in index')} const commandsText=fs.readFileSync(path.join(src,'deploy-commands.js'),'utf8'); if(!/setName\('afk'\)/.test(commandsText)){failures++;console.error('[FAIL AFK] /afk missing')}
