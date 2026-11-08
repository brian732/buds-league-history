const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../',data=JSON.parse(fs.readFileSync(root+'data/league.json')),archive=JSON.parse(fs.readFileSync(root+'data/espn-history.json')),post=JSON.parse(fs.readFileSync(root+'data/playoffs.json'));
const nodes={};const context=vm.createContext({console,DATA:null,document:{querySelector:s=>nodes[s]??=( {innerHTML:'',textContent:'',value:''})},fetch:async()=>({ok:true,json:async()=>post}),sessionStorage:{getItem:()=>null,setItem:()=>{}},AbortSignal});
let app=fs.readFileSync(root+'app.js','utf8').replace(/\(async function init\(\) \{[\s\S]*?\}\)\(\);/,'');
vm.runInContext(app+'\n'+fs.readFileSync(root+'explorer.js','utf8'),context);
context.config=data;context.archive=archive;context.post=post;
(async()=>{
 await vm.runInContext('DATA=config;ESPN_HISTORY=archive;OWNER_BY_ID=Object.fromEntries(DATA.owners.map(o=>[o.ownerId,o]));buildEspnSeasons();loadHeadToHead()',context);
 vm.runInContext('PLAYOFF_GAMES=post.games',context);
 assert.equal(vm.runInContext('HEAD_TO_HEAD.length',context),352);assert.equal(post.games.length,20);
 for(const competition of ['regular','playoffs','combined'])for(const from of [2021,2022,2026]){
  context.from=from;context.competition=competition;
  vm.runInContext("EXPLORER={mode:'range',from,to:2026,competition,sort:'w',direction:-1}",context);
  const totals=JSON.parse(vm.runInContext('JSON.stringify(explorerTotals())',context));
  for(const row of totals){
   context.owner=row.id;
   const h2h=JSON.parse(vm.runInContext('JSON.stringify(headToHeadTotal(owner))',context));
   const omitted={w:0,l:0,t:0,pf:0,pa:0};
   if(competition!=='playoffs')for(const season of archive.seasons.filter(s=>s.year>=from)){
    const own=season.teams.find(t=>t.ownerId===row.id);if(!own)continue;
    const excludedIds=new Set(season.teams.filter(t=>!t.ownerId).map(t=>t.teamId));
    for(const game of season.games){
     if(!([game.homeTeamId,game.awayTeamId].includes(own.teamId))||!([game.homeTeamId,game.awayTeamId].some(id=>excludedIds.has(id))))continue;
     const home=game.homeTeamId===own.teamId,pf=home?game.hp:game.ap,pa=home?game.ap:game.hp;
     omitted.pf+=pf/100;omitted.pa+=pa/100;if(pf>pa)omitted.w++;else if(pf<pa)omitted.l++;else omitted.t++;
    }
   }
   for(const key of ['w','l','t'])assert.equal(row[key],h2h[key]+omitted[key],`${competition} ${from} ${row.id} ${key}`);
   for(const key of ['pf','pa'])assert.equal(Math.round(row[key]*100),Math.round((h2h[key]+omitted[key])*100));
   assert.equal(row.gp,row.w+row.l+row.t);
  }
 }
 vm.runInContext("EXPLORER={mode:'all',competition:'regular',sort:'w',direction:-1};renderTrophies()",context);
 assert.equal((nodes['#champTable'].innerHTML.match(/<tr>/g)||[]).length,11,'all ten listed owners appear including zero titles');
 const jacob=data.owners.find(o=>o.name.startsWith('Jacob'));assert(!data.owners.some(o=>o.name==='Tom Ribaudo'));assert.equal(data.owners.length,10);
 assert(!archive.seasons.find(s=>s.year===2021).teams.some(t=>t.ownerId===jacob.ownerId));
 assert.equal(archive.seasons.find(s=>s.year===2021).teams.filter(t=>!t.ownerId).length,1);
 const totals=JSON.parse(vm.runInContext('JSON.stringify(explorerTotals())',context));
 assert.equal(totals.find(r=>r.id===jacob.ownerId).gp,60);
 assert(totals.filter(r=>r.id!==jacob.ownerId).every(r=>r.gp===73));
 assert.equal(totals.reduce((n,r)=>n+r.w,0),360);assert.equal(totals.reduce((n,r)=>n+r.l,0),357);
 assert.equal(vm.runInContext('H2H_COVERAGE.reduce((n,r)=>n+r.excluded,0)',context),13);
 for(const g of post.games){assert(g.endWeek>g.week);const s=archive.seasons.find(s=>s.year===g.year);assert([g.a,g.b].every(id=>s.teams.find(t=>t.ownerId===id).playoffSeed<=4));}
 // A tab that previously visited the original league must not reuse its cached fixtures.
 const oldLeagueCache=new Map([['v2:data/playoffs.json',JSON.stringify({at:Date.now(),data:{games:[{source:'other league'}]}})]]);
 context.sessionStorage={getItem:key=>oldLeagueCache.get(key)||null,setItem:(key,value)=>oldLeagueCache.set(key,value)};
 const fetched=await vm.runInContext('getJSON("data/playoffs.json")',context);assert.equal(fetched.games.length,20);
 assert([...oldLeagueCache.keys()].some(key=>key.startsWith('espn-436050287:')));
 console.log('History passed: 365 overall games, 352 listed-owner H2H games, 20 playoff series; excluded 2021 owner reconciled; Jacob GP=60, nine others GP=73; all filters and zero-title rows');
})().catch(e=>{console.error(e);process.exitCode=1});
