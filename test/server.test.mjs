import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createApp } from '../server.mjs';

let tmp, app, now;
const client = () => crypto.randomUUID();

function request(method,url,body,headers={}) {
  return new Promise((resolve,reject)=>{
    const stream=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    stream.method=method;stream.url=url;stream.headers=headers;stream.socket={remoteAddress:'127.0.0.1'};
    const response={
      status:0,headers:{},
      writeHead(status,responseHeaders){this.status=status;this.headers=responseHeaders;},
      end(chunk){
        try {const text=chunk==null?'':Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);let data={};try{data=text?JSON.parse(text):{};}catch{}resolve({status:this.status,headers:this.headers,text,data});}
        catch(error){reject(error);}
      }
    };
    app.server.emit('request',stream,response);
  });
}

before(()=>{
  tmp=fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'tmp-'));
  now=new Date('2026-10-27T23:59:59.000Z');
  app=createApp({dbPath:path.join(tmp,'test.sqlite'),adminToken:'test-admin-secret',nowProvider:()=>now});
});

after(()=>{
  app?.close();
  if(tmp)fs.rmSync(tmp,{recursive:true,force:true});
});

afterEach(()=>{ now=new Date('2026-10-27T23:59:59.000Z'); });

test('today is stable by UTC date and does not reveal the answer before play',async()=>{
  const first=await request('GET','/api/today');
  const second=await request('GET','/api/today');
  assert.equal(first.status,200);
  assert.equal(first.data.date,'2026-10-27');
  assert.equal(first.data.event.id,second.data.event.id);
  assert.equal('year' in first.data.event,false);
  assert.equal('yearDisplay' in first.data.event,false);
  assert.equal('explanation' in first.data.event,false);
  assert.equal('sources' in first.data.event,false);

  now=new Date('2026-10-28T00:00:01.000Z');
  const next=await request('GET','/api/today');
  assert.equal(next.data.date,'2026-10-28');
  assert.notEqual(next.data.event.id,first.data.event.id);
});

test('static shell ships SEO metadata and a sitemap without exposing scheduled answers',async()=>{
  const home=await request('GET','/');
  assert.equal(home.status,200);
  assert.match(home.text,/rel="canonical" href="http:\/\/localhost:4173\/"/);
  assert.match(home.text,/og:title/);
  assert.equal(home.text.includes('__BASE_URL__'),false);
  const sitemap=await request('GET','/sitemap.xml');
  assert.equal(sitemap.status,200);
  assert.match(sitemap.text,/sitemaps\.org/);
  assert.doesNotMatch(sitemap.text,/1991|1492|yearDisplay/);
});

test('UTC planner uses every published question once per full cycle',()=>{
  const rows=app.db.prepare(`SELECT event_id FROM daily_challenges WHERE challenge_date BETWEEN '2026-01-01' AND '2026-03-01' ORDER BY challenge_date`).all();
  const unique=new Set(rows.slice(0,60).map(row=>row.event_id));
  assert.equal(unique.size,60);
});

test('invalid inputs do not consume a turn; a win is stored once and answer reveals only at completion',async()=>{
  const clientKey=client();
  let today=await request('GET','/api/today');
  const start=await request('POST','/api/sessions',{clientKey,mode:'daily',date:today.data.date});
  assert.equal(start.status,200);
  assert.equal(start.data.status,'playing');
  assert.equal(start.data.attemptsUsed,0);
  assert.equal('year' in start.data.event,false);
  const ownerless=await request('GET',`/api/sessions/${start.data.id}?clientKey=${client()}`);
  assert.equal(ownerless.status,404);
  const malformed=await request('POST',`/api/sessions/${start.data.id}/guess`,{clientKey,guess:'12a4'});
  assert.equal(malformed.status,400);
  const short=await request('POST',`/api/sessions/${start.data.id}/guess`,{clientKey,guess:'123'});
  assert.equal(short.status,400);
  const zero=await request('POST',`/api/sessions/${start.data.id}/guess`,{clientKey,guess:'0000'});
  assert.equal(zero.status,400);
  const afterInvalid=await request('GET',`/api/sessions/${start.data.id}?clientKey=${clientKey}`);
  assert.equal(afterInvalid.data.attemptsUsed,0);

  const answer=app.db.prepare('SELECT year_display FROM historical_events WHERE id=?').get(start.data.event.id).year_display;
  const won=await request('POST',`/api/sessions/${start.data.id}/guess`,{clientKey,guess:answer});
  assert.equal(won.status,200);
  assert.equal(won.data.status,'won');
  assert.deepEqual(won.data.feedback,['correct','correct','correct','correct']);
  assert.equal(won.data.event.yearDisplay,answer);
  assert.ok(won.data.event.explanation);
  assert.ok(won.data.event.sources.length>0);
  const duplicateStart=await request('POST','/api/sessions',{clientKey,mode:'daily',date:today.data.date});
  assert.equal(duplicateStart.data.id,start.data.id);
  assert.equal(duplicateStart.data.status,'won');
  const duplicateGuess=await request('POST',`/api/sessions/${start.data.id}/guess`,{clientKey,guess:answer});
  assert.equal(duplicateGuess.status,409);
  const stats=await request('GET',`/api/stats?clientKey=${clientKey}`);
  assert.equal(stats.data.gamesPlayed,1);
  assert.equal(stats.data.wins,1);
  assert.equal(stats.data.distribution[0],1);
  assert.equal(stats.data.achievements.find(item=>item.id==='first-win').unlocked,true);
});

test('a loss is revealed after six valid guesses and cannot continue',async()=>{
  const clientKey=client();
  const today=await request('GET','/api/today');
  const session=await request('POST','/api/sessions',{clientKey,mode:'daily',date:today.data.date});
  const answer=app.db.prepare('SELECT year_display FROM historical_events WHERE id=?').get(session.data.event.id).year_display;
  const wrong=answer==='9999'?'8888':'9999';
  let last;
  for(let attempt=1;attempt<=6;attempt++) {
    last=await request('POST',`/api/sessions/${session.data.id}/guess`,{clientKey,guess:wrong});
    assert.equal(last.status,200);
    assert.equal(last.data.position,attempt);
    assert.equal(last.data.status,attempt===6?'lost':'playing');
  }
  assert.equal(last.data.event.yearDisplay,answer);
  assert.ok(last.data.event.sources.length>0);
  const seventh=await request('POST',`/api/sessions/${session.data.id}/guess`,{clientKey,guess:wrong});
  assert.equal(seventh.status,409);
});

test('archive lists real dates, keeps future days hidden, and filters to this client progress',async()=>{
  const clientKey=client();
  const archive=await request('GET',`/api/archive?year=2026&month=10&clientKey=${clientKey}`);
  assert.equal(archive.status,200);
  assert.equal(archive.data.entries.length,31);
  assert.equal(archive.data.entries.find(entry=>entry.date==='2026-10-28').available,false);
  assert.equal(archive.data.entries.find(entry=>entry.date==='2026-10-27').available,true);
  assert.ok(archive.data.entries.find(entry=>entry.date==='2026-10-27').title);
  const upcoming=await request('GET','/api/challenge?date=2026-10-28');
  assert.equal(upcoming.status,404);
  const badMonth=await request('GET','/api/archive?year=2026&month=13');
  assert.equal(badMonth.status,400);
});

test('training draws from a selected category and difficulty without revealing the answer',async()=>{
  const clientKey=client();
  const session=await request('POST','/api/sessions',{clientKey,mode:'practice',category:'science-inventions',difficulty:'hard'});
  assert.equal(session.status,200);
  assert.equal(session.data.event.category,'science-inventions');
  assert.equal(session.data.event.difficulty,'hard');
  assert.equal('yearDisplay' in session.data.event,false);
});

test('admin routes require a token, validate imports, support categories and fixed scheduling',async()=>{
  const unauthorized=await request('GET','/api/admin/overview');
  assert.equal(unauthorized.status,403);
  const auth={authorization:'Bearer test-admin-secret'};
  const overview=await request('GET','/api/admin/overview',undefined,auth);
  assert.equal(overview.status,200);
  assert.equal(overview.data.published,60);
  const category=await request('POST','/api/admin/categories',{id:'history-of-maps',name:'История картографии',description:'Карты и способы измерять мир.',icon:'⌖',sortOrder:30},auth);
  assert.equal(category.status,200);
  const record={id:'test-archive-event-2001',year:2001,era:'CE',exactDate:'2001-09-11',title:'Тестовое историческое событие',question:'В каком году произошло событие?',explanation:'Проверенное описание события.',period:'Новейшая история',category:'history-of-maps',difficulty:'medium',region:'Мир',keywords:['тест'],factCheckStatus:'reviewed',published:true,translations:[{locale:'ru',question:'В каком году произошло событие?'}],sources:[{title:'Официальный архив',url:'https://example.org/archive'}]};
  const invalid=await request('POST','/api/admin/import',{events:[{...record,id:'bad-event',sources:[{title:'Bad',url:'javascript:alert(1)'}]}]},auth);
  assert.equal(invalid.status,400);
  const imported=await request('POST','/api/admin/import',{events:[record]},auth);
  assert.equal(imported.status,200);
  assert.equal(imported.data.imported,1);
  const exported=await request('GET','/api/admin/export',undefined,auth);
  assert.equal(exported.status,200);
  assert.equal(exported.data.events.find(item=>item.id===record.id).sources[0].url,record.sources[0].url);
  const duplicate=await request('POST','/api/admin/import',{events:[{...record,id:'same-fact-different-id'}]},auth);
  assert.equal(duplicate.status,409);
  const adminEvents=await request('GET','/api/admin/events',undefined,auth);
  assert.ok(adminEvents.data.events.find(item=>item.id===record.id));
  const scheduled=await request('POST','/api/admin/schedule',{date:'2026-10-29',eventId:record.id},auth);
  assert.equal(scheduled.status,200);
  now=new Date('2026-10-29T00:00:01.000Z');
  const assigned=await request('GET','/api/challenge?date=2026-10-29');
  assert.equal(assigned.status,200);
  assert.equal(assigned.data.event.id,record.id);
  assert.equal('year' in assigned.data.event,false);
});

test('guest can delete its own persisted profile history',async()=>{
  const clientKey=client();
  const start=await request('POST','/api/sessions',{clientKey,mode:'practice',category:'sport',difficulty:'easy'});
  assert.equal(start.status,200);
  const before=await request('GET',`/api/stats?clientKey=${clientKey}`);
  assert.equal(before.data.gamesPlayed,1);
  const deleted=await request('DELETE','/api/profile',{clientKey});
  assert.equal(deleted.status,200);
  const after=await request('GET',`/api/stats?clientKey=${clientKey}`);
  assert.equal(after.data.gamesPlayed,0);
});
