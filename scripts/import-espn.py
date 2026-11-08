"""Build the league archive from sanitized ESPN season responses. Fail before writing on mismatches."""
import json, datetime, collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
raws=[json.loads(p.read_text()) for p in sorted((ROOT/'imports').glob('*.json'))]
assert raws and all(r['id']==436050287 for r in raws)
EXCLUDED=set(json.loads((ROOT/'scripts/ownership-policy.json').read_text())['excludedOwnerIds'])
owners={}; archives=[]; seasons=[]; playoffs=[]; weekly=[]; matchups=[]
def cents(value):return round(value*100)
def team_name(t):return (t.get('name') or (t.get('location','')+' '+t.get('nickname',''))).strip()
# Resolve stable ESPN member IDs before interpreting past team labels.
for raw in raws:
 members={m['id']:m for m in raw['members']}
 for team in raw['teams']:
  assert len(team['owners'])==1, 'Co-owned team needs explicit attribution'
  id=team['owners'][0]
  if id in EXCLUDED: continue
  m=members[id]; name=(m['firstName']+' '+m['lastName']).strip()
  owners[id]={'ownerId':id,'name':name,'team':team_name(team),'role':'Owner' if raw['seasonId']==raws[-1]['seasonId'] else f"Former owner · {raw['seasonId']}",'bio':'','school':'','hobbies':[],'knownFor':'','active':raw['seasonId']==raws[-1]['seasonId']}
# All-time totals key on canonical owner labels; identical current team names must not merge owners.
counts=collections.Counter(o['team'] for o in owners.values())
for o in owners.values():
 if counts[o['team']]>1:o['team']+=' · '+o['name']
for raw in raws:
 year=raw['seasonId']; settings=raw['settings']['scheduleSettings']; reg=settings['matchupPeriodCount']; qualify=settings['playoffTeamCount']; periods=settings['matchupPeriods']
 final=raw['status']['finalScoringPeriod']; complete=raw['status']['latestScoringPeriod']>final
 teams=[]
 for t in raw['teams']:
  o=owners.get(t['owners'][0],{'ownerId':None,'name':'Former owner','team':None});r=t['record']['overall']
  teams.append(dict(teamId=t['id'],team=team_name(t),ownerId=o['ownerId'],ownerName=o['name'],canonicalTeam=o['team'],w=r['wins'],l=r['losses'],t=r['ties'],pf=round(r['pointsFor'],2),pa=round(r['pointsAgainst'],2),finalRank=t.get('rankCalculatedFinal'),playoffSeed=t.get('playoffSeed')))
 by_id={t['teamId']:t for t in teams}; games=[]
 for g in raw['schedule']:
  if not g.get('home') or not g.get('away') or g['winner'] not in ['HOME','AWAY','TIE']:continue
  a=by_id[g['home']['teamId']];b=by_id[g['away']['teamId']]
  win=a['ownerId'] if g['winner']=='HOME' else b['ownerId'] if g['winner']=='AWAY' else None
  weeks=sorted(periods[str(g['matchupPeriodId'])]);hp=cents(g['home']['totalPoints']);ap=cents(g['away']['totalPoints'])
  assert hp==ap or g['winner']==('HOME' if hp>ap else 'AWAY'), (year,g['id'],'score/winner mismatch')
  for side in ['home','away']:
   for w,points in g[side].get('pointsByScoringPeriod',{}).items():
    if by_id[g[side]['teamId']]['ownerId']:
     weekly.append(dict(year=year,week=int(w),ownerId=by_id[g[side]['teamId']]['ownerId'],points=cents(points)))
  if g['matchupPeriodId']<=reg:
   games.append(dict(id=g['id'],week=g['matchupPeriodId'],homeTeamId=a['teamId'],awayTeamId=b['teamId'],hp=hp,ap=ap,winner=win,winnerSide=g['winner']))
   matchups.append(dict(year=year,week=min(weeks),a=a['ownerId'],b=b['ownerId'],ap=hp,bp=ap,winner=win))
  elif a['playoffSeed']<=qualify and b['playoffSeed']<=qualify:
   # A championship-bracket pairing needs both qualified teams; consolation is excluded.
   last=g['matchupPeriodId']==max(map(int,periods))
   stage='Championship' if last and {a['finalRank'],b['finalRank']}=={1,2} else 'Third place' if last and {a['finalRank'],b['finalRank']}=={3,4} else 'Semifinal' if qualify==4 else 'Playoff'
   playoffs.append(dict(year=year,week=min(weeks),endWeek=max(weeks),a=a['ownerId'],b=b['ownerId'],ap=hp,bp=ap,winner=win,stage=stage,source='espn'))
 for t in teams:
  rows=[g for g in games if t['teamId'] in [g['homeTeamId'],g['awayTeamId']]]
  pf=sum(g['hp'] if g['homeTeamId']==t['teamId'] else g['ap'] for g in rows)
  pa=sum(g['ap'] if g['homeTeamId']==t['teamId'] else g['hp'] for g in rows)
  w=sum(g['winnerSide']==('HOME' if g['homeTeamId']==t['teamId'] else 'AWAY') for g in rows);ties=sum(g['winnerSide']=='TIE' for g in rows)
  assert (w,len(rows)-w-ties,ties)==(t['w'],t['l'],t['t']),(year,t['ownerName'],'WLT')
  assert pf==cents(t['pf']) and pa==cents(t['pa']),(year,t['ownerName'],'PFPA',pf,pa,t['pf'],t['pa'])
 completed=len(set(g['week'] for g in games))
 assert len(games)==completed*len(teams)//2,(year,'incomplete matchup period')
 assert not complete or completed==reg
 standing=sorted(teams,key=lambda t:(-t['w']-.5*t['t'],-t['pf']))
 s=dict(year=year,platform='ESPN',espnLeagueId='436050287',inProgress=not complete,verified=True,playoffTeams=qualify,standings=standing,awards=[],recap='')
 if complete:
  for rank,key in [(1,'champion'),(2,'runnerUp'),(3,'third'),(4,'fourth'),(len(teams),'dfl')]:s[key]=next(t['canonicalTeam'] for t in teams if t['finalRank']==rank)
  s['playoffOwners']=[t['ownerId'] for t in teams if t['playoffSeed']<=qualify]
  assert len([g for g in playoffs if g['year']==year])==4,(year,'bracket series count')
 seasons.append(s);archives.append(dict(year=year,regularWeeks=reg,completedPeriods=completed,teams=teams,games=games))
 print(f'{year}: {len(games)} regular games, {completed} completed periods, all {len(teams)} W/L/T and PF/PA reconciled')
latest=raws[-1];sett=latest['settings'];now=datetime.datetime.now(datetime.timezone.utc).isoformat()
old=json.loads((ROOT/'data/league.json').read_text()); oldowners={o['ownerId']:o for o in old.get('owners',[])};oldseasons={s['year']:s for s in old.get('seasons',[])}
for id,o in owners.items():
 for k in ['bio','displayTeam','photo','color','school','hobbies','knownFor']:
  if k in oldowners.get(id,{}):o[k]=oldowners[id][k]
for s in seasons:
 for k in ['recap','awards','meeting','ruleChanges','notableEvents']:
  if k in oldseasons.get(s['year'],{}):s[k]=oldseasons[s['year']][k]
league=old['league'];league.update(name=sett['name'],established=min(s['year']for s in seasons),tagline='Every season. Every rivalry.',introduction=f"The complete record of {sett['name']}: six seasons of fantasy football, championship runs, and head-to-head rivalries.",structure=f"{len(latest['teams'])}-team redraft · Full PPR · 4 playoff teams",platform='ESPN Fantasy Football')
# Written commissioner terms, fees, payouts and punishments are not inferred from team ownership.
by_owner={id:o['name'] for id,o in owners.items()}
records=[]
def record(label,value,holder,when):records.append(dict(record=label,value=value,holder=holder,when=when,verified=True))
hi=max(weekly,key=lambda r:r['points']);lo=min(weekly,key=lambda r:r['points'])
for label,r in [('Highest weekly score',hi),('Lowest weekly score',lo)]:record(label,f"{r['points']/100:.2f}",by_owner[r['ownerId']],f"{r['year']} · Week {r['week']}")
margin=max((g for g in matchups if g['winner'] in by_owner),key=lambda r:abs(r['ap']-r['bp']));record('Largest regular-season win',f"{abs(margin['ap']-margin['bp'])/100:.2f}",by_owner[margin['winner']],f"{margin['year']} · Week {margin['week']}")
non_ties=[g for g in matchups if g['ap']!=g['bp'] and g['winner'] in by_owner];close=min(non_ties,key=lambda g:abs(g['ap']-g['bp']));record('Closest regular-season win',f"{abs(close['ap']-close['bp'])/100:.2f}",by_owner[close['winner']],f"{close['year']} · Week {close['week']}")
finished=[(s,t) for s in seasons if not s['inProgress'] for t in s['standings'] if t['ownerId']];s,t=max(finished,key=lambda st:st[1]['pf']);record('Most regular-season points',f"{t['pf']:.2f}",t['ownerName'],str(s['year']))
s,t=max(finished,key=lambda st:(st[1]['w'],st[1]['pf']));record('Most regular-season wins',str(t['w']),t['ownerName'],str(s['year']))
scoring={'summary':'Full PPR · 4-point passing touchdowns. Settings imported from ESPN for 2026.','groups':[{'name':'Passing','lines':['0.04 points per passing yard','4 points per passing touchdown','−2 points per interception','2 points per two-point conversion']},{'name':'Rushing & receiving','lines':['1 point per reception','0.1 points per rushing or receiving yard','6 points per rushing or receiving touchdown','2 points per two-point conversion','−2 points per lost fumble']},{'name':'Lineup','lines':['1 QB · 2 RB · 2 WR · 1 TE','1 RB/WR/TE flex · 1 D/ST · 1 K','7 bench spots · 1 injured reserve spot']}]}
rules={'scoring':scoring,'draft':['Snake draft; 90 seconds per pick.','No keepers configured in ESPN.'],'trades':['No season trade limit.','48-hour trade review; 4 veto votes required.'],'waivers':['Traditional waivers with a 24-hour waiver period.','No season acquisition limit.'],'playoffs':['Top 4 teams qualify after 13 regular-season matchups.','Two-week semifinals (Weeks 14–15) and finals (Weeks 16–17).','Head-to-head playoff records include the championship bracket and third-place series; consolation games are excluded.'],'misc':['Entry fees, payouts, punishments and commissioner history have not yet been supplied.']}
config=dict(old,league=league,owners=sorted(owners.values(),key=lambda o:(not o['active'],o['name'])),seasons=seasons,recordBook=records,rules=rules)
config['_README']='League-specific ESPN archive. Written profiles and stories are editable at the Commissioner’s desk. No ESPN credentials are stored.'
for filename,value in [('league.json',config),('espn-history.json',dict(leagueId='436050287',updatedAt=now,seasons=archives)),('playoffs.json',dict(updatedAt=now,games=playoffs))]:(ROOT/'data'/filename).write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
print(f"Imported {len(owners)} listed owners, {sum(len(s['games'])for s in archives)} regular games and {len(playoffs)} playoff series")
