(function(){
"use strict";
// ---- state ----
// Races live in this browser (localStorage). A shared link carries the whole
// race in its hash (#r=...), so anyone can open it with no server and no login.
var LS_KEY = "raceday.state.v1";
var state = readState();
var linkRace = null;   // race decoded from a #r= permalink (not yet in local list)
var editing = null;    // race id being edited, or "new"
var app = document.getElementById("app");

function readState(){
  var base = null;
  try { base = JSON.parse(document.getElementById("state").textContent); } catch(e){ base = {races:[],template:{milestones:[],bring:[]}}; }
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw){ var o = JSON.parse(raw); if (o && o.races){ o.template = o.template || base.template; return o; } }
  } catch(e){}
  return base;
}
function saveLocal(){ try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e){} }

// ---- permalink encoding (base64url of JSON) ----
function b64e(str){ var bytes=new TextEncoder().encode(str), s=""; for (var i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64d(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; var bin=atob(s), bytes=new Uint8Array(bin.length); for (var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function encodeRace(r){
  var c = { i:r.id, n:r.name, e:r.event, v:r.venue, t:r.raceAt, l:r.link, p:r.preceding, f:r.focus, m:r.milestones.map(function(x){return [x.label, x.mins];}), b:r.bring };
  return b64e(JSON.stringify(c));
}
function decodeRace(s){
  try {
    var c = JSON.parse(b64d(s));
    if (!c || !c.n || !Array.isArray(c.m)) return null;
    return { id:c.i||slug(c.n), name:c.n, event:c.e||"", venue:c.v||"", raceAt:c.t||"", link:c.l||"", preceding:c.p||"", focus:c.f||"", milestones:c.m.map(function(x){return {label:String(x[0]||""), mins:Number(x[1])||0};}), bring:Array.isArray(c.b)?c.b:[] };
  } catch(e){ return null; }
}
function permalink(r){ return location.origin + location.pathname + "#r=" + encodeRace(r); }

// ---- helpers ----
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function pad(n){ return (n<10?"0":"")+n; }
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || "race"; }
function parseLocal(iso){ // "YYYY-MM-DDTHH:MM" as local time
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso||"");
  if(!m) return null;
  return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], 0, 0);
}
function fmtClock(d){ var h=d.getHours(), m=d.getMinutes(); var ap=h>=12?"pm":"am"; var hh=h%12; if(hh===0) hh=12; return hh+":"+pad(m)+" "+ap; }
function fmtDate(d){ return d.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }
function fmtOffset(mins){ // minutes before race, positive
  if (mins===0) return "start";
  var h=Math.floor(mins/60), m=mins%60;
  return "−"+(h?h+"h ":"")+(m||!h?m+"m":"");
}
function fmtDur(mins){ var h=Math.floor(mins/60), m=mins%60; return (h?h+" hr ":"")+(m?m+" min":"")||"0 min"; }
function fmtCountdown(ms){ // returns {main, unit}
  var s=Math.max(0,Math.floor(ms/1000));
  var d=Math.floor(s/86400); s-=d*86400;
  var h=Math.floor(s/3600); s-=h*3600;
  var m=Math.floor(s/60); s-=m*60;
  if (d>0) return {main:d+"d "+pad(h)+"h", unit:""};
  if (h>0) return {main:h+":"+pad(m)+":"+pad(s), unit:""};
  return {main:m+":"+pad(s), unit:""};
}
function fmtAgo(ms){ var s=Math.floor(ms/1000); var m=Math.floor(s/60), h=Math.floor(m/60); if(h>=24) return Math.floor(h/24)+" days ago"; if(h) return h+"h "+pad(m%60)+"m ago"; return m+" min ago"; }

// schedule: each step starts at race − (its duration + all following durations)
function schedule(race){
  var t0 = parseLocal(race.raceAt); if(!t0) return [];
  var rows=[], acc=0;
  for (var i=race.milestones.length-1;i>=0;i--){ acc += Number(race.milestones[i].mins)||0; rows.unshift({label:race.milestones[i].label, mins:Number(race.milestones[i].mins)||0, before:acc}); }
  rows.push({label:"Race start", mins:0, before:0, race:true});
  rows.forEach(function(r){ r.at = new Date(t0.getTime() - r.before*60000); });
  return rows;
}
function currentRace(){
  var h = decodeURIComponent(location.hash.replace(/^#/,""));
  var r = null;
  if (h.indexOf("r=")===0){
    var lr = decodeRace(h.slice(2));
    if (lr){
      // if this browser already holds the same race with the same content, use the local copy
      var local = state.races.filter(function(x){ return x.id===lr.id; })[0];
      if (local && encodeRace(local)===h.slice(2)) { linkRace=null; return local; }
      linkRace = lr; return lr;
    }
  }
  linkRace = null;
  for (var i=0;i<state.races.length;i++) if (state.races[i].id===h) r=state.races[i];
  if (!r && state.races.length){
    // default: next upcoming race, else last
    var now=Date.now(), best=null;
    state.races.forEach(function(x){ var t=parseLocal(x.raceAt); if(t && t.getTime()+3600000>now && (!best || t<parseLocal(best.raceAt))) best=x; });
    r = best || state.races[state.races.length-1];
  }
  return r;
}

// ---- render ----
function render(){
  var race = currentRace();
  var html = '<div class="top"><div class="brand disp">Race Day<small>Countdown</small></div><nav class="races">';
  state.races.slice().sort(function(a,b){ return (a.raceAt||"").localeCompare(b.raceAt||""); }).forEach(function(r){
    html += '<a class="tab" href="#'+esc(r.id)+'"'+(race&&r.id===race.id?' aria-current="page"':'')+'>'+esc(r.name)+'</a>';
  });
  html += '<button class="tab add" data-act="new" type="button">+ New race</button>';
  html += '</nav></div>';

  if (linkRace) html += '<div class="notice">Shared race plan, opened from a link. <button class="btn small" data-act="keep" type="button">Save to my races</button></div>';

  if (editing) html += renderEditor(editing==="new" ? null : state.races.filter(function(r){return r.id===editing;})[0]);

  if (!race){ html += '<div class="empty">No races yet. Add one to start the countdown.</div>'; app.innerHTML=html; return; }

  var rows = schedule(race), t0 = parseLocal(race.raceAt);
  html += '<header class="head"><div><div class="eyebrow">'+esc(race.event||"")+'</div><h1 class="disp">'+esc(race.name)+'</h1><div class="meta">'
    + (race.venue?'<span>'+esc(race.venue)+'</span>':'')
    + (race.preceding?'<span>Preceding race: '+esc(race.preceding)+'</span>':'')
    + (race.link?'<a href="'+esc(race.link)+'" target="_blank" rel="noopener">Regatta Central ↗</a>':'')
    + '</div></div>'
    + '<div class="racetime"><div class="t disp">'+(t0?fmtClock(t0):"—")+'</div><div class="d">'+(t0?fmtDate(t0):"No race time set")+'</div></div></header>';
  html += '<div class="actions">'
    + (linkRace?'':'<button class="btn" data-act="edit" data-id="'+esc(race.id)+'" type="button">Edit race</button>')
    + '<button class="btn" data-act="copy" type="button">Copy share link</button>'
    + '<button class="btn" data-act="ics" type="button">Add to calendar</button></div>';

  html += '<div id="hero"></div>';
  html += '<ol class="tl" id="tl">';
  rows.forEach(function(r,i){
    html += '<li data-i="'+i+'" class="'+(r.race?'race':'')+'"><span class="clock mono">'+fmtClock(r.at)+'</span><span class="tm mono">'+fmtOffset(r.before)+'</span><span class="lab">'+esc(r.label)+'</span><span class="dur">'+(r.race?'':fmtDur(r.mins))+'</span></li>';
  });
  html += '</ol>';

  if (race.focus) html += '<section class="sec"><h2 class="disp">Race plan</h2><div class="focus">'+esc(race.focus)+'</div></section>';

  if (race.bring && race.bring.length){
    var checked = getChecks(race.id);
    html += '<section class="sec"><div class="bring-head"><h2 class="disp">What to bring</h2><span class="cnt" id="bringcnt"></span></div><ul class="bring">';
    race.bring.forEach(function(item,i){
      var on = checked.indexOf(i)>=0;
      html += '<li><label><input type="checkbox" id="bring-'+i+'" data-bring="'+i+'"'+(on?' checked':'')+'><span class="'+(on?'ck':'')+'">'+esc(item)+'</span></label></li>';
    });
    html += '</ul><div class="hint">Ticks are saved on this device only.</div></section>';
  }
  app.innerHTML = html;
  tick();
}

var lastHeroKey = "";
function tick(){
  var race = currentRace(); if(!race) return;
  var rows = schedule(race); var t0 = parseLocal(race.raceAt); if(!t0) return;
  var now = Date.now(), hero = document.getElementById("hero"), tl = document.getElementById("tl");
  if (!hero || !tl) return;
  // find current index: last row whose time <= now
  var cur=-1; for (var i=0;i<rows.length;i++) if (rows[i].at.getTime()<=now) cur=i;
  var lis = tl.children;
  for (var j=0;j<lis.length;j++){ lis[j].classList.toggle("done", j<cur || (cur===rows.length-1 && j===cur)); lis[j].classList.toggle("now", j===cur && cur<rows.length-1); }

  var h;
  if (cur === rows.length-1){
    h = '<div class="hero after"><div><div class="lbl">Race started</div><div class="what">'+esc(race.name)+'</div><div class="sub">Started '+fmtClock(t0)+'</div></div><div class="big mono">'+fmtAgo(now-t0.getTime())+'</div></div>';
  } else {
    var next = rows[cur+1];
    var c = fmtCountdown(next.at.getTime()-now);
    var lbl = cur<0 ? "Next" : "Now: "+rows[cur].label;
    var sub = cur<0 ? "Race start in "+fmtCountdown(t0.getTime()-now).main : (next.race ? "" : "Race start in "+fmtCountdown(t0.getTime()-now).main);
    h = '<div class="hero"><div><div class="lbl">'+esc(cur<0?"Up next":"Now — "+rows[cur].label)+'</div><div class="what">'+esc(cur<0?next.label:"Next: "+next.label)+' at '+fmtClock(next.at)+'</div>'+(sub?'<div class="sub">'+esc(sub)+'</div>':'')+'</div><div class="big mono">'+c.main+'</div></div>';
  }
  if (h!==lastHeroKey){ hero.innerHTML=h; lastHeroKey=h; }
  var cnt = document.getElementById("bringcnt");
  if (cnt){ var n=getChecks(race.id).length; cnt.textContent = n+" / "+race.bring.length+" packed"; }
}
setInterval(tick, 1000);

// ---- packing checks (per device) ----
function getChecks(id){ try{ return JSON.parse(localStorage.getItem("raceday.checks."+id)||"[]"); }catch(e){ return []; } }
function setChecks(id, arr){ try{ localStorage.setItem("raceday.checks."+id, JSON.stringify(arr)); }catch(e){} }

// ---- editor ----
function renderEditor(race){
  var isNew = !race;
  var r = race || { id:"", name:"", event:"", venue:"", raceAt:"", link:"", preceding:"", focus:"", milestones: JSON.parse(JSON.stringify(state.template.milestones)), bring: state.template.bring.slice() };
  var date = (r.raceAt||"").slice(0,10), time=(r.raceAt||"").slice(11,16);
  var h = '<form class="editor" id="edform" data-id="'+esc(r.id)+'"><h2 class="disp">'+(isNew?'New race':'Edit race')+'</h2><div class="grid">'
   + f("Regatta / race name","name",r.name,"Muskoka Fall Classic")
   + f("Event","event",r.event,"Mens Masters 4+ — Event #24")
   + f("Date","date",date,"", "date")
   + f("Race time","time",time,"", "time")
   + f("Venue","venue",r.venue,"")
   + f("Preceding race","preceding",r.preceding,"Event #23 — Womens Masters 2x")
   + f("Regatta Central link","link",r.link,"https://www.regattacentral.com/…","url","full")
   + '<div class="field full"><label for="ed-focus">Race plan / focus</label><textarea id="ed-focus" name="focus">'+esc(r.focus)+'</textarea></div>'
   + '</div>';
  h += '<div class="sec" style="margin-top:20px"><div class="eyebrow">Milestones — worked back from race start</div><table class="ms" id="mstable"><thead><tr><th>Step</th><th>Duration (min)</th><th>Starts</th><th></th></tr></thead><tbody>';
  r.milestones.forEach(function(m,i){ h += msRow(m,i); });
  h += '<tr class="fixed"><td>Race start</td><td></td><td class="h mono" id="ms-race"></td><td></td></tr></tbody></table>'
     + '<button class="btn small" type="button" data-act="ms-add">+ Add step</button><div class="hint">Each step’s start time is the race time minus its duration and every step after it.</div></div>';
  h += '<div class="sec" style="margin-top:20px"><div class="field"><label for="ed-bring">What to bring (one per line)</label><textarea id="ed-bring" name="bring" style="min-height:150px">'+esc(r.bring.join("\n"))+'</textarea></div></div>';
  h += '<div class="ed-actions"><div><button class="btn primary" type="submit">'+(isNew?'Create race':'Save changes')+'</button><button class="btn" type="button" data-act="cancel">Cancel</button></div>'
     + (isNew?'':'<div><button class="btn danger" type="button" data-act="delete" data-id="'+esc(r.id)+'">Delete race</button></div>')+'</div></form>';
  return h;
  function f(label,name,val,ph,type,cls){ return '<div class="field '+(cls||'')+'"><label for="ed-'+name+'">'+label+'</label><input id="ed-'+name+'" name="'+name+'" type="'+(type||'text')+'" value="'+esc(val)+'" placeholder="'+esc(ph)+'"></div>'; }
}
function msRow(m,i){
  return '<tr data-ms="'+i+'"><td><input type="text" id="ms-l-'+i+'" name="ms-label" value="'+esc(m.label)+'"></td><td><input class="n mono" type="number" min="0" step="1" id="ms-m-'+i+'" name="ms-mins" value="'+esc(m.mins)+'"></td><td class="h mono ms-at"></td><td class="ctl"><button type="button" data-act="ms-up" title="Move up">↑</button> <button type="button" data-act="ms-down" title="Move down">↓</button> <button type="button" data-act="ms-del" title="Remove">✕</button></td></tr>';
}
function readForm(){
  var form = document.getElementById("edform"); if(!form) return null;
  var g = function(n){ var el=form.querySelector('[name="'+n+'"]'); return el?el.value.trim():""; };
  var ms=[]; form.querySelectorAll("tr[data-ms]").forEach(function(tr){ ms.push({label: tr.querySelector('[name="ms-label"]').value.trim(), mins: Math.max(0, parseInt(tr.querySelector('[name="ms-mins"]').value,10)||0)}); });
  var bring = g("bring").split("\n").map(function(s){return s.trim();}).filter(Boolean);
  var name = g("name") || "Untitled race";
  var oldId = form.getAttribute("data-id");
  var id = oldId || uniqueId(slug(name));
  return { id:id, name:name, event:g("event"), venue:g("venue"), raceAt: (g("date")&&g("time")) ? g("date")+"T"+g("time") : "", link:g("link"), preceding:g("preceding"), focus:g("focus"), milestones: ms.filter(function(m){return m.label;}), bring: bring };
}
function uniqueId(base){ var id=base, n=2; while (state.races.some(function(r){return r.id===id;})) id=base+"-"+(n++); return id; }
function updateMsPreview(){
  var form=document.getElementById("edform"); if(!form) return;
  var r = readForm(); var rows = schedule(r);
  var trs = form.querySelectorAll("tr[data-ms]");
  var t0 = parseLocal(r.raceAt);
  trs.forEach(function(tr,i){ tr.querySelector(".ms-at").textContent = rows[i] ? fmtClock(rows[i].at)+"  ("+fmtOffset(rows[i].before)+")" : "—"; });
  var rc=document.getElementById("ms-race"); if(rc) rc.textContent = t0 ? fmtClock(t0) : "set date & time";
}

// ---- persistence ----
function persist(next, msg){
  state = next; saveLocal();
  editing=null; lastHeroKey=""; render(); toast(msg||"Saved");
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }

var toastT;
function toast(m){ var t=document.getElementById("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(function(){ t.classList.remove("show"); }, 2200); }

// ---- events ----
document.addEventListener("click", function(e){
  var b = e.target.closest("[data-act]"); if(!b) return;
  var act = b.getAttribute("data-act");
  if (act==="new"){ editing="new"; render(); window.scrollTo(0,0); }
  else if (act==="edit"){ editing=b.getAttribute("data-id"); render(); window.scrollTo(0,0); setTimeout(updateMsPreview,0); }
  else if (act==="cancel"){ editing=null; render(); }
  else if (act==="copy"){
    var url = permalink(currentRace());
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ toast("Share link copied"); }, function(){ prompt("Copy this link", url); });
    else prompt("Copy this link", url);
  }
  else if (act==="keep"){
    if (!linkRace) return;
    var nx=clone(state); var r=clone(linkRace);
    var at=-1; nx.races.forEach(function(x,i){ if(x.id===r.id) at=i; });
    if (at>=0) nx.races[at]=r; else nx.races.push(r); location.hash="#"+encodeURIComponent(r.id); linkRace=null;
    persist(nx,"Saved to my races");
  }
  else if (act==="ics"){ downloadIcs(currentRace()); }
  else if (act==="delete"){
    var id=b.getAttribute("data-id"); var r=state.races.filter(function(x){return x.id===id;})[0];
    if (!r || !confirm("Delete “"+r.name+"”? This can’t be undone.")) return;
    var next=clone(state); next.races=next.races.filter(function(x){return x.id!==id;});
    editing=null; if (location.hash==="#"+id) history.replaceState(null,"",location.pathname+location.search);
    persist(next,"Race deleted");
  }
  else if (act==="ms-add"){
    var tb=document.querySelector("#mstable tbody"); var n=tb.querySelectorAll("tr[data-ms]").length;
    var tmp=document.createElement("tbody"); tmp.innerHTML=msRow({label:"",mins:10},n);
    tb.insertBefore(tmp.firstElementChild, tb.lastElementChild); renumber(); updateMsPreview();
    document.getElementById("ms-l-"+n).focus();
  }
  else if (act==="ms-del"){ b.closest("tr").remove(); renumber(); updateMsPreview(); }
  else if (act==="ms-up"||act==="ms-down"){
    var tr=b.closest("tr"), sib = act==="ms-up"?tr.previousElementSibling:tr.nextElementSibling;
    if (!sib || !sib.hasAttribute("data-ms")) return;
    if (act==="ms-up") tr.parentNode.insertBefore(tr,sib); else tr.parentNode.insertBefore(sib,tr);
    renumber(); updateMsPreview();
  }
});
function renumber(){ document.querySelectorAll("#mstable tr[data-ms]").forEach(function(tr,i){ tr.setAttribute("data-ms",i); }); }
document.addEventListener("input", function(e){
  if (e.target.closest("#edform")) updateMsPreview();
});
document.addEventListener("change", function(e){
  var cb=e.target.closest("[data-bring]"); if(!cb) return;
  var race=currentRace(); if(!race) return;
  var i=+cb.getAttribute("data-bring"); var arr=getChecks(race.id).filter(function(x){return x!==i;}); if (cb.checked) arr.push(i);
  setChecks(race.id, arr); cb.nextElementSibling.className = cb.checked?"ck":""; tick();
});
document.addEventListener("submit", function(e){
  var form=e.target.closest("#edform"); if(!form) return; e.preventDefault();
  var r=readForm(); if(!r) return;
  var next=clone(state); var idx=-1;
  next.races.forEach(function(x,i){ if(x.id===r.id) idx=i; });
  if (idx>=0) next.races[idx]=r; else next.races.push(r);
  try { sessionStorage.setItem("raceday.hash", "#"+r.id); } catch(x){}
  location.hash = "#"+encodeURIComponent(r.id);
  persist(next, idx>=0?"Saved":"Race created");
});
window.addEventListener("hashchange", function(){ editing=null; lastHeroKey=""; render(); });

// ---- calendar export ----
function downloadIcs(race){
  var rows=schedule(race); if(!rows.length){ toast("Set a race time first"); return; }
  var t0=parseLocal(race.raceAt), first=rows[0].at;
  function u(d){ return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+"T"+pad(d.getUTCHours())+pad(d.getUTCMinutes())+"00Z"; }
  var desc = rows.map(function(r){ return fmtClock(r.at)+"  "+r.label; }).join("\\n") + (race.focus?"\\n\\n"+race.focus.replace(/\n/g,"\\n"):"");
  var ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Race Day Countdown//EN","BEGIN:VEVENT","UID:"+race.id+"@raceday","DTSTAMP:"+u(new Date()),"DTSTART:"+u(first),"DTEND:"+u(new Date(t0.getTime()+15*60000)),"SUMMARY:"+race.name+(race.event?" — "+race.event:"")+" (race "+fmtClock(t0)+")","LOCATION:"+(race.venue||""),"DESCRIPTION:"+desc,"URL:"+permalink(race),"END:VEVENT","END:VCALENDAR"].join("\r\n");
  var a=document.createElement("a"); a.href="data:text/calendar;charset=utf-8,"+encodeURIComponent(ics); a.download=slug(race.name)+".ics"; document.body.appendChild(a); a.click(); a.remove();
}

// ---- boot ----
render();
})();
