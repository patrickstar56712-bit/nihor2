/* Control Panel: sent by /api/admin to a logged-in browser only, then run on top of index.html (it uses the page's functions and data).
   Its pages are in panel.html, its styles stay in index.html. */
"use strict";
Object.assign(V,{admin:"admin","admin/items":"items","admin/upgrade":"cpup","admin/skills":"cpsk","admin/stats":"cpst","admin/screen":"cpsc","admin/keys":"cpdk","admin/loot":"cplt","admin/divine":"cpdv"});
GROUPS.push(["admin","Control Panel",[["admin/items","Items"],["admin/upgrade","Upgrade Cost"],["admin/skills","Skill Booster"],["admin/stats","Statistics"],["admin/screen","Screen Tracker"],["admin/keys","Dungeon Keys"],["admin/loot","Loot Tracker"],["admin/divine","Divine Simulator"]]]);
/* called by route() for every page */
function cpRoute(c,quiet){
  if(c.v==="admin")drawDb();
  if(c.v==="items")drawItems();
  if(c.v==="cpup"){cuRen=-1;loadCat(cuCat);drawCpU()}
  if(c.v==="cpsk")drawCpS();
  if(c.v==="cpst")drawStats();
  if(c.v==="cpsc"&&!quiet)drawScA();
  if(c.v==="cpdk"&&!quiet)drawDk();
  if(c.v==="cplt"&&!quiet)drawLt();
  if(c.v==="cpdv")dvLoad().then(drawCpDv,()=>{$("cdvBody").innerHTML=`<tr><td colspan="4" class="err">The bonus list could not be loaded.</td></tr>`});
}

/* ---------- Divine Simulator: switch bonus rows off (DVOFF, saved as meta 'dvOff') ---------- */
const CDV_POOLS=["Normal","6/7","Exalted","Exalted 6/7","Divine","Divine 6/7","Exalted + Divine","Exalted + Divine 6/7"];   // the pools the simulator uses
let cdvP="Exalted";
function drawCpDv(){
  if(!DVB)return;
  const it=$("cdvIt"),sel=it.value,q=$("cdvQ").value.trim().toLowerCase();
  if(!it.options.length)it.innerHTML='<option value="">All items</option>'+DVB.items.map((n,i)=>`<option value="${i}">${esc(n)}</option>`).join("");
  $("cdvPool").innerHTML=CDV_POOLS.map(p=>{const off=(DVB.pools[p]||[]).filter(r=>DVOFF.has(p+"|"+r[0])).length;
    return `<button data-p="${esc(p)}" aria-pressed="${p===cdvP}">${esc(p)}${off?` <small>(${off} off)</small>`:""}</button>`}).join("");
  const rows=(DVB.pools[cdvP]||[]).filter(r=>(sel===""||r[1].includes(+sel))&&(!q||r[0].toLowerCase().includes(q)));
  $("cdvCnt").textContent=`${DVOFF.size} switched off`;
  $("cdvBody").innerHTML=rows.map((r,i)=>{const k=cdvP+"|"+r[0],on=!DVOFF.has(k);
    return `<tr class="${on?"":"off"}" style="--i:${Math.min(i,30)}"><td><b>${esc(r[0])}</b></td><td class="it">${r[1].map(x=>esc(DVB.items[x])).join(", ")}</td><td class="tr">${r[2].map(esc).join(" / ")}</td>`+
      `<td><label><input type="checkbox" data-k="${esc(k)}"${on?" checked":""}> ${on?"On":"Off"}</label></td></tr>`}).join("")||`<tr><td colspan="4" class="muted">No attribute in this pool for these filters.</td></tr>`;
}
const cdvSave=()=>{sv("dvOff",[...DVOFF]);dbQueue("dvOff");drawCpDv()};
$("cdvPool").onclick=e=>{const b=e.target.closest("[data-p]");if(b){cdvP=b.dataset.p;drawCpDv()}};
$("cdvIt").onchange=drawCpDv;$("cdvQ").oninput=drawCpDv;
$("cdvBody").addEventListener("change",e=>{const k=e.target.dataset.k;if(k===undefined)return;e.target.checked?DVOFF.delete(k):DVOFF.add(k);cdvSave()});
$("cdvAll").onclick=()=>{for(const k of [...DVOFF])if(k.startsWith(cdvP+"|"))DVOFF.delete(k);cdvSave()};

/* ---------- Loot Tracker: the logs visitors loaded (api/logs.js) ---------- */
async function drawLt(){
  const b=$("ltBody");
  if(!LOGAPI){b.innerHTML=`<p class="muted">The logs are kept on the website only.</p>`;return}
  if(!b.children.length)b.innerHTML=`<p class="muted">Loading…</p>`;
  let L;
  try{const r=await fetch(LOGAPI,{cache:"no-store"});if(!r.ok)throw await why(r);L=(await r.json()).logs}
  catch(e){b.innerHTML=`<p class="err">Could not load the logs (${esc(typeof e==="string"?e:"no answer")}).</p>`;return}
  const day=t=>new Date(String(t).replace(" ","T")+"Z").toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  const hue=v=>{let h=0;for(const c of v)h=(h*31+c.charCodeAt(0))%360;return h};
  b.innerHTML=`<section class="dlc"><h2>Loaded Logs <small>${L.length}</small>${L.length?`<button class="scax" id="ltClr">Clear all</button>`:""}</h2>`+
    (L.length?`<div class="ltw"><table class="ltt"><thead><tr><th>Loaded</th><th>File</th><th>Loot lines</th><th>Game time</th><th>Visitor</th><th></th></tr></thead><tbody>`+
      L.map((l,i)=>`<tr style="--i:${Math.min(i,30)}"><td>${day(l.created)}</td><td class="ltf" title="${esc(l.name)}">${esc(l.name||"–")}</td><td>${f(l.n)}</td>`+
        `<td>${l.from?fd(l.from)+" – "+fd(l.to):"–"}</td><td>${l.vid?`<span class="ltv" style="--h:${hue(l.vid)}" title="Same code = same browser">${esc(l.vid.slice(0,6))}</span>`:"–"}</td>`+
        `<td class="lta"><button class="primary" data-lo="${l.id}" data-nm="${esc(l.name)}">Open</button><button data-ld="${l.id}" title="Remove" aria-label="Remove ${esc(l.name)}">✕</button></td></tr>`).join("")+`</tbody></table></div>`
      :`<p class="muted">No logs yet: they show here once visitors load a log file in the Loot Tracker.</p>`)+`</section>`;
}
async function ltPost(o,ok){
  try{const r=await fetch(LOGAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(o)});if(!r.ok)throw await why(r)}
  catch(e){dbNote("NOT done ("+(typeof e==="string"?e:"no answer")+").",true);return}
  dbNote(ok);drawLt();
}
/* a kept log opens in the Loot Tracker like a file loaded there (it is not kept again: this browser is an admin's) */
async function ltOpen(id,name){
  dbNote("Opening…");
  try{
    const r=await fetch(LOGAPI+"?id="+id,{cache:"no-store"});if(!r.ok)throw await why(r);
    const bin=Uint8Array.from(atob((await r.json()).data),c=>c.charCodeAt(0));
    const txt=await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    history.pushState(null,"",href("tools/loot"));route();
    await loadFile(new File([txt],name||"log.txt"));
    dbNote(`Opened ${name||"the log"} in the Loot Tracker.`);
  }catch(e){dbNote("Could not open the log ("+(typeof e==="string"?e:"broken file")+").",true)}
}
$("ltRe").onclick=drawLt;
$("ltBody").addEventListener("click",e=>{
  const o=e.target.closest("[data-lo]");if(o){ltOpen(+o.dataset.lo,o.dataset.nm);return}
  const d=e.target.closest("[data-ld]");if(d){ltPost({del:[+d.dataset.ld]},"Log removed.");return}
  const c=e.target.closest("#ltClr");if(!c)return;
  if(!c.classList.contains("armed")){c.classList.add("armed");c.textContent="Click again to clear all";setTimeout(()=>{c.classList.remove("armed");c.textContent="Clear all"},4000);return}
  ltPost({clear:true},"All logs cleared.");
});

const PNAME={home:"Main Page",tools:"Tools",loot:"Loot Tracker",dloot:"Loot Tracker (Detailed)",screen:"Screen Tracker",upgrade:"Upgrade Cost",weapons:"Weapons",
  jewellery:"Jewellery",armour:"Armour",helmets:"Helmets",shields:"Shields",dews:"Dew Upgrade",progress:"Progress",skills:"Skill Booster",divine:"Divine Simulator"};
const stDay=d=>new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"UTC"});
async function drawStats(){
  const b=$("stBody");
  if(!STATS){b.innerHTML=`<p class="muted">Statistics are collected on the website only.</p>`;return}
  if(!ADK){b.innerHTML=`<p class="muted">Log in with the admin password on the <a href="${href("admin")}">Control Panel</a> page to see the statistics.</p>`;return}
  b.innerHTML=`<p class="muted">Loading…</p>`;
  let s;
  try{const r=await fetch(STATS,{cache:"no-store"});if(!r.ok)throw await why(r);s=await r.json()}
  catch(e){b.innerHTML=`<p class="err">Could not load the statistics (${esc(typeof e==="string"?e:"no answer")}).</p>`;return}
  /* the last 30 days, days without visits included */
  const by=Object.fromEntries(s.days.map(d=>[d.day,d])),days=[];
  for(let i=29;i>=0;i--){const t=new Date(s.today+"T12:00:00Z");t.setUTCDate(t.getUTCDate()-i);const k=t.toISOString().slice(0,10);days.push(by[k]||{day:k,visits:0,unique:0,views:0,uploads:0})}
  const td=days[29],max=Math.max(1,...days.map(d=>d.visits)),pmax=Math.max(1,...s.pages.map(p=>p.views)),T=s.totals;
  const tile=(l,v,sub)=>`<div class="stt"><small>${l}</small><b>${f(v)}</b>${sub?`<span>${sub}</span>`:""}</div>`;
  const up=k=>s.uploads[k]||{files:0,lines:0};
  b.innerHTML=
    `<div class="stg">`+tile("Visits today",td.visits,`${f(td.unique)} unique visitor${td.unique===1?"":"s"}`)+tile("Total visits",T.visits)+
      tile("Unique visitors",T.unique,"all time")+tile("Page views",T.views,`${f(td.views)} today`)+tile("Files uploaded",T.uploads,`${f(td.uploads)} today`)+`</div>`+
    `<section class="panel stc"><h2>Visits · last 30 days</h2><div class="stch" id="stCh" style="--max:${max}">`+
      `<div class="sty"><span>${f(max)}</span><span>${f(Math.round(max/2))}</span><span>0</span></div><div class="stbars">`+
      days.map((d,i)=>`<div class="stb${i===29?" now":""}" data-i="${i}" tabindex="0" aria-label="${stDay(d.day)}: ${d.visits} visits, ${d.unique} unique visitors"><i style="height:${d.visits/max*100}%"></i></div>`).join("")+
      `</div><div class="stx"><span>${stDay(days[0].day)}</span><span>${stDay(days[15].day)}</span><span>Today</span></div><div class="sttip" id="stTip" hidden></div></div>`+
      `<details class="stdt"><summary>Show as table</summary><table><thead><tr><th>Day</th><th>Visits</th><th>Unique</th><th>Page views</th><th>Files</th></tr></thead><tbody>`+
      days.slice().reverse().map(d=>`<tr><td>${stDay(d.day)}</td><td>${f(d.visits)}</td><td>${f(d.unique)}</td><td>${f(d.views)}</td><td>${f(d.uploads)}</td></tr>`).join("")+`</tbody></table></details></section>`+
    `<div class="st2"><section class="panel"><h2>Most opened pages</h2>`+
      (s.pages.length?`<div class="stls">`+s.pages.map(p=>`<div class="stpr"><span>${esc(PNAME[p.page]||p.page)}</span><i><em style="width:${p.views/pmax*100}%"></em></i><b>${f(p.views)}</b></div>`).join("")+`</div>`:`<p class="muted">No page views yet.</p>`)+
    `</section><section class="panel"><h2>Uploaded tracker files</h2><div class="stls">`+
      [["loot","Loot Tracker","file","loot lines"],["dloot","Loot Tracker (Detailed)","file","loot lines"],["screen","Screen Tracker","picture","items read"]].map(([k,l,u,w])=>`<div class="stu"><span>${l}</span><b>${f(up(k).files)}</b><small>${u}${up(k).files===1?"":"s"} · ${f(up(k).lines)} ${w}</small></div>`).join("")+
    `</div></section></div>`;
  /* hover / focus tooltip for a day */
  const tip=$("stTip"),ch=$("stCh");
  const show=el=>{const d=days[+el.dataset.i];
    tip.innerHTML=`<b>${stDay(d.day)}${+el.dataset.i===29?" · today":""}</b><span>Visits <em>${f(d.visits)}</em></span><span>Unique visitors <em>${f(d.unique)}</em></span><span>Page views <em>${f(d.views)}</em></span><span>Files uploaded <em>${f(d.uploads)}</em></span>`;
    tip.hidden=false;const r=el.getBoundingClientRect(),c=ch.getBoundingClientRect();
    tip.style.left=Math.min(Math.max(r.left-c.left+r.width/2-tip.offsetWidth/2,0),c.width-tip.offsetWidth)+"px";};
  ch.addEventListener("pointerover",e=>{const el=e.target.closest(".stb");if(el)show(el)});
  ch.addEventListener("focusin",e=>{const el=e.target.closest(".stb");if(el)show(el)});
  ch.addEventListener("pointerleave",()=>{tip.hidden=true});
  ch.addEventListener("focusout",()=>{tip.hidden=true});
}
$("stRe").onclick=drawStats;


/* ---------- control panel: upgrade cost items (new / rename / delete, text to list, material counts) ---------- */
let cuCat=CATS[ld("cpCat","weapons")]?ld("cpCat","weapons"):"weapons",cuRen=-1;
$("cuSeg").innerHTML=Object.keys(CATS).map(c=>`<button data-c="${c}" aria-pressed="false">${CATS[c][0]}</button>`).join("");
function drawCpU(){
  if(CAT!==cuCat||!W)loadCat(cuCat);
  $("cuSeg").querySelectorAll("[data-c]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.c===cuCat)));
  $("cuCnt").textContent=`(${W.length})`;
  $("cuNew").placeholder="New "+CATS[CAT][1].toLowerCase()+" name";
  $("cuList").innerHTML=wOrd().map(([w,i],k)=>`<div class="cur${i===WS?" sel":""}" data-i="${i}" style="--i:${Math.min(k,12)}">${ico(w)}`+
    (i===cuRen?`<input class="cun" value="${esc(w.n)}" maxlength="60" aria-label="New name">`:`<button class="cunb" data-pick="${i}">${esc(w.n)}</button>`)+
    `<button class="xb" data-ren="${i}">${i===cuRen?"Save":"Rename"}</button><button class="xb" data-del="${i}"${W.length<2?" disabled":""}>Delete</button></div>`).join("");
  $("cuSelN").textContent="· "+cw().n;
  $("cuMats").innerHTML=matTable(cw(),-1,-1);
  if(cuRen>=0){const n=$("cuList").querySelector(".cun");n.focus();n.select()}
}
const cuSel=i=>{WS=i;sv(K("upgSel"),WS)};
function cuEndRen(){
  if(cuRen<0)return;
  const n=$("cuList").querySelector(".cun"),v=n?n.value.trim():"";
  if(v){W[cuRen].n=v;saveW()}
  cuRen=-1;drawCpU();
}
$("cuSeg").onclick=e=>{const b=e.target.closest("[data-c]");if(b){cuCat=b.dataset.c;sv("cpCat",cuCat);cuRen=-1;loadCat(cuCat);drawCpU()}};
$("cuList").addEventListener("click",e=>{
  const p=e.target.closest("[data-pick]"),r=e.target.closest("[data-ren]"),d=e.target.closest("[data-del]");
  if(p){cuSel(+p.dataset.pick);drawCpU();return}
  if(r){const i=+r.dataset.ren;if(cuRen===i)cuEndRen();else{cuEndRen();cuRen=i;cuSel(i);drawCpU()}return}
  if(d){
    if(!d.classList.contains("armed")){
      $("cuList").querySelectorAll(".armed").forEach(x=>{x.classList.remove("armed");x.textContent="Delete"});
      d.classList.add("armed");d.textContent="Sure?";
      clearTimeout(delTm);delTm=setTimeout(()=>{d.classList.remove("armed");d.textContent="Delete"},3000);return;
    }
    clearTimeout(delTm);const i=+d.dataset.del;
    W.splice(i,1);if(WS>=i)WS=Math.max(0,WS-1);saveW();sv(K("upgSel"),WS);cuRen=-1;drawCpU();
  }
});
$("cuList").addEventListener("keydown",e=>{
  if(!e.target.matches(".cun")||e.isComposing||e.keyCode===229)return;
  if(e.key==="Enter"){e.preventDefault();cuEndRen()}
  if(e.key==="Escape"){cuRen=-1;drawCpU()}
});
$("cuList").addEventListener("focusout",e=>{if(e.target.matches(".cun")&&!(e.relatedTarget&&e.relatedTarget.dataset.ren))cuEndRen()});
$("cuNewF").onsubmit=e=>{
  e.preventDefault();
  const n=$("cuNew").value.trim()||"New "+CATS[CAT][1]+" "+(W.length+1);
  W.push(blankW(n));cuSel(W.length-1);saveW();$("cuNew").value="";drawCpU();
};
$("cuImp").onclick=()=>{
  const r=importText($("impTx").value),o=$("impMsg");
  if(!r.steps&&!r.craft){o.textContent="No step headers like “+0 -> +1:” found.";o.className="err";return}
  saveW();drawCpU();
  o.className="";
  o.textContent=`${cw().n}: `+(r.steps?`filled ${r.steps} step${r.steps>1?"s":""}, ${r.mats} material${r.mats===1?"":"s"}.`:"")+(r.craft?" Craft block saved.":"")+(r.skip.length?` Skipped: ${r.skip.join(", ")}`:"");
};
$("cuMats").addEventListener("input",e=>matInput(e.target,cw()));
$("cuMats").addEventListener("click",e=>matClick(e,$("cuMats"),drawCpU));


/* control panel: add / remove skill books for one character group */
let csSel=ld("cpSkGrp","warrior/body");
function drawCpS(){
  $("csChar").innerHTML=CHARS.map(([k,n,gs])=>`<div class="csr">${chPic(k)}<b>${n}</b>${gs.map(([gk,gl])=>{const id=k+"/"+gk,c=(CSK[id]||[]).length;
    return `<button data-cs="${id}" aria-pressed="${id===csSel}">${gl}<small>${c}</small></button>`}).join("")}</div>`).join("");
  const [c,g]=csSel.split("/"),mine=CSK[csSel]||[];
  $("csIn").innerHTML=`<h3>${esc(chOf(c)[1])} · ${esc(gLbl(c,g))} <small>${mine.length} skill${mine.length===1?"":"s"} · ‹ › set the order</small></h3>`+
    (mine.length?`<div class="csl">${mine.map((n,i)=>`<span class="csi" title="${esc(skBase(n))}">${img(skGP(n))}<span>${esc(skBase(n))}</span><button class="xb" data-mv="${i}" data-d="-1" aria-label="Move ${esc(skBase(n))} left"${i?"":" disabled"}>‹</button><button class="xb" data-mv="${i}" data-d="1" aria-label="Move ${esc(skBase(n))} right"${i<mine.length-1?"":" disabled"}>›</button><button class="xb" data-rm="${esc(n)}" aria-label="Remove ${esc(skBase(n))}">✕</button></span>`).join("")}</div>`
      :`<p class="muted">No skills yet. Click skill books below to add them.</p>`);
  const own={};for(const id in CSK)for(const n of CSK[id])(own[n]=own[n]||[]).push(id);
  const q=$("csQ").value.trim().toLowerCase(),list=SKBOOKS.filter(n=>!q||n.toLowerCase().includes(q));
  $("csAll").innerHTML=list.map(n=>{const on=mine.includes(n),o=(own[n]||[]).filter(x=>x!==csSel).map(x=>{const [a,b]=x.split("/");return chOf(a)[1]+" "+gLbl(a,b)});
    return `<button class="csb${on?" on":""}" data-add="${esc(n)}" aria-pressed="${on}" title="${esc(skBase(n))}">${img(skGP(n))}<span>${esc(skBase(n))}</span>${o.length?`<small>${esc(o.join(", "))}</small>`:""}</button>`}).join("")
    ||`<p class="muted">No skill book matches.</p>`;
  $("csCnt").textContent=`${list.length} skill books`;
}
const csSave=()=>{sv("skChars",CSK);dbQueue("chars");drawCpS();drawCh()};
$("csChar").onclick=e=>{const b=e.target.closest("[data-cs]");if(b){csSel=b.dataset.cs;sv("cpSkGrp",csSel);drawCpS()}};
$("csAll").onclick=e=>{const b=e.target.closest("[data-add]");if(!b)return;
  const n=b.dataset.add,l=CSK[csSel]=CSK[csSel]||[],i=l.indexOf(n);if(i<0)l.push(n);else l.splice(i,1);csSave()};
$("csIn").onclick=e=>{const l=CSK[csSel]||[],r=e.target.closest("[data-rm]"),m=e.target.closest("[data-mv]");
  if(r){l.splice(l.indexOf(r.dataset.rm),1);csSave()}
  else if(m){const i=+m.dataset.mv,j=i+ +m.dataset.d;if(j>=0&&j<l.length){[l[i],l[j]]=[l[j],l[i]];csSave()}}};
$("csQ").addEventListener("input",drawCpS);
/* Parses blocks headed "M1:" (or "M1 -> M2:" / "Master 1 -> Master 2:", stored on the start
   level M1; Grandmaster = G, Perfect Master = P; a bare "P:" means P1) followed by "Name: 3 adet"
   lines (also "10k (10.000) adet") and a "Toplam Maliyet: 500.000 Yang" line. */
function skImport(src){
  const HEAD=/^([mgp])\s*(\d{0,2})\s*(?:(?:->|→|=>|-)\s*([mgp])\s*(\d{0,2}))?\s*:?\s*$/i,LINE=/^(.+?)\s*[:=]\s*([\d.,\s]+)\s*([^\d]*)$/,
    YANG=/^(toplam\s*maliyet|toplam|total(\s*cost)?|yang(\s*cost)?|maliyet)$/i;
  const toN=s=>+s.replace(/[\s.,]/g,"")||0,lv=(t,n)=>{const ti=SKT.indexOf(t.toUpperCase()),k=n===""?1:+n;return ti>=0&&k>=1&&k<=10?ti*10+k-1:-1};
  const tier=l=>l.replace(/\(.*?\)/g,"").replace(/grand\s*master/gi,"G").replace(/perfect(\s*master)?/gi,"P").replace(/master/gi,"M").trim();
  const got={},yang={},order=[],skip=[];let at=-1;
  for(const raw of src.split(/\r?\n/)){
    let l=raw.replace(/^[\s*•·•-]+(?=\S)/,"").trim();if(!l)continue;
    const h=HEAD.exec(tier(l));
    if(h){at=lv(h[1],h[2]);if(at<0)skip.push(l.replace(/:$/,""));else yang[at]??=0;continue}
    if(at<0)continue;
    l=l.replace(/\d[\d.,]*\s*k+\s*\(\s*([\d.,\s]+)\)/i,"$1");   // "10k (10.000)" -> "10.000"
    const m=LINE.exec(l);if(!m)continue;
    const u=/^(k{1,2})\b/i.exec(m[3].trim()),n=m[1].trim(),v=toN(m[2])*(u?u[1].length>1?1e6:1e3:1),k=n.toLowerCase();
    if(YANG.test(n)||/yang/i.test(m[3])){yang[at]=v;continue}
    if(!got[k]){got[k]={n,c:{}};order.push(k)}
    got[k].c[at]=(got[k].c[at]||0)+v;
  }
  const lvs=Object.keys(yang).map(Number);
  for(const s of lvs)SB.y[s]=yang[s];
  for(const m of SB.m)if(!got[m.n.trim().toLowerCase()])for(const s of lvs)m.c[s]=0;
  for(const k of order){
    let m=SB.m.find(x=>x.n.trim().toLowerCase()===k);
    if(!m){m={n:got[k].n,c:Array(SKN).fill(0)};SB.m.push(m)}
    for(const s of lvs)m.c[s]=got[k].c[s]||0;
  }
  SB.m=SB.m.filter(m=>m.c.some(c=>c>0));
  return{lvs,mats:order.length,skip};
}
$("skApply").onclick=()=>{
  const r=skImport($("skTx").value),o=$("skMsg");
  if(!r.lvs.length){o.textContent="No level headers like “M1:” found.";o.className="err";return}
  sv("skB",SB);dbQueue("skills");drawSk();
  o.className="";
  o.textContent=`Filled ${r.lvs.length} level${r.lvs.length>1?"s":""} (${r.lvs.sort((a,b)=>a-b).map(skL).join(", ")}), ${r.mats} material${r.mats===1?"":"s"}.`+(r.skip.length?` Skipped: ${r.skip.join(", ")}`:"");
};


/* a saved slot picture: the empty slot's background and the count are made see-through */
async function scClean(src){
  const im=await scImgLd(src);if(!im)return "";
  const d=new Uint8ClampedArray(scPx(im)),[,box]=scCount(d,32,32,0,0),m=scMask(d,box);
  for(let p=0;p<1024;p++)if(m[p]||Math.abs(scLum(d,p*4)-SC_FR[p])<10)d[p*4+3]=0;
  return scURL(d);
}
/* an uploaded picture, fitted into 32x32 */
const scFit=x=>new Promise(r=>{const u=URL.createObjectURL(x),im=new Image();
  im.onload=()=>{const c=document.createElement("canvas");c.width=c.height=32;const k=Math.min(32/im.width,32/im.height),w=im.width*k,h=im.height*k;
    c.getContext("2d").drawImage(im,(32-w)/2,(32-h)/2,w,h);URL.revokeObjectURL(u);r(c.toDataURL("image/png"))};
  im.onerror=()=>{URL.revokeObjectURL(u);r("")};im.src=u});
async function scaPost(body,ok){
  try{
    const r=await fetch(SCAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    if(r.status===401){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawScA();return}
    if(!r.ok)throw await why(r);
    dbNote(ok);scRefP=null;drawScA();
  }catch(e){dbNote("NOT saved ("+(typeof e==="string"?e:"no answer")+").",true)}
}
async function drawScA(){
  const b=$("scaBody");
  if(!SCAPI){b.innerHTML=`<p class="muted">The Screen Tracker pictures are kept on the website only.</p>`;return}
  if(!ADK){b.innerHTML=`<p class="muted">Log in with the admin password on the <a href="${href("admin")}">Control Panel</a> page to see the missing pictures.</p>`;return}
  if(!b.children.length)b.innerHTML=`<p class="muted">Loading…</p>`;
  let s;
  try{const r=await fetch(SCAPI,{cache:"no-store"});if(!r.ok)throw await why(r);s=await r.json()}
  catch(e){b.innerHTML=`<p class="err">Could not load the Screen Tracker pictures (${esc(typeof e==="string"?e:"no answer")}).</p>`;return}
  if(setPics(s.icons)&&s.missing)scRefP=null;
  if(!s.missing){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawScA();return}   // the key was not accepted
  scaO=await scaOpts();
  const day=t=>new Date(String(t).replace(" ","T")+"Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  const M=s.missing,I=s.icons;
  b.innerHTML=`<section class="dlc"><h2>Missing Images <small>${M.length}</small>${M.length?`<button class="scax" id="scaClr">Clear all</button>`:""}</h2>`+
    (M.length?`<div class="scag">`+M.map((m,i)=>`<form class="scac" data-id="${m.id}" style="--i:${Math.min(i,20)}"><div class="pix"><img src="${m.image}" alt="Slot from a screenshot"><div><b>Not recognized</b><small>Seen ${f(m.seen)}× · ${day(m.last)}</small></div></div>`+
      `<div class="scdd"><input name="n" placeholder="Search item name" aria-label="Item name" maxlength="80" autocomplete="off" required role="combobox" aria-expanded="false" aria-autocomplete="list"><ul role="listbox" hidden></ul></div>`+
      `<div class="scsg" hidden></div>`+
      `<div class="edf"><label class="fbtn" tabindex="0">Upload picture<input type="file" accept="image/*" hidden></label><button class="primary">Save</button><button type="button" data-rm="${m.id}" title="Remove" aria-label="Remove">✕</button></div></form>`).join("")+`</div>`
      :`<p class="muted">Nothing missing: every item in the uploaded screenshots was recognized.</p>`)+
    `</section><section class="dlc"><h2>Added Pictures <small>${I.length}</small></h2>`+
    (I.length?`<div class="scag">`+I.map((c,i)=>`<div class="scac ok" style="--i:${Math.min(i,20)}"><div class="pix"><img src="${c.image}" alt=""><div><b title="${esc(c.name)}">${esc(c.name)}</b><small>Recognized in screenshots</small></div><button type="button" data-ri="${c.id}" title="Remove" aria-label="Remove ${esc(c.name)}">✕</button></div></div>`).join("")+`</div>`
      :`<p class="muted">No pictures added yet.</p>`)+`</section>`;
  /* the closest pictures the site already has, one card after the other */
  const refs=await scRefs();
  for(const fm of b.querySelectorAll("form.scac")){
    await new Promise(r=>setTimeout(r,0));if(!fm.isConnected)return;
    const im=await scImgLd(fm.querySelector(".pix img").src);if(!im)continue;
    const cell=scPx(im),[,box]=scCount(cell,32,32,0,0),sg=fm.querySelector(".scsg"),s=scBest(cell,scMask(cell,box),refs).filter(x=>x[1]<90);
    if(!s.length)continue;
    sg.innerHTML=`<span>Closest in Items:</span>`+s.map(([n])=>`<button type="button" data-pick="${esc(n)}" title="Use this name">${img(n)}${esc(n)}</button>`).join("");sg.hidden=false;
  }
}
/* ---------- control panel: Dungeon Keys (a dungeon's key next to its chest) ---------- */
const DKS=[["key","Dungeon Key"],["chest","Dungeon Chest"]];
const dkRow=(p,i)=>`<div class="dkp${p.id?"":" new"}" data-id="${p.id||""}" style="--i:${Math.min(i,20)}">`+
  DKS.map(([s,lb])=>{const n=p[s]||"";return `<div class="dks" data-s="${s}"><button type="button" class="dkpic" title="Upload the ${lb.toLowerCase()} picture" aria-label="Upload the ${lb.toLowerCase()} picture">${n?img(n):"+"}</button>`+
    `<div class="dkn"><small>${lb}</small><div class="scdd"><input data-cb="items" value="${esc(n)}" placeholder="${lb} name" aria-label="${lb} name" maxlength="80" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list"><ul role="listbox" hidden></ul></div></div></div>`}).join(`<span class="dkx" aria-hidden="true">⇄</span>`)+
  `<div class="dka"><button class="primary" data-dks>Save</button><button data-dkd title="Remove" aria-label="Remove this pair">✕</button></div></div>`;
async function drawDk(){
  const b=$("dkBody");$("dkAdd").hidden=!(SCAPI&&ADK);
  if(!SCAPI){b.innerHTML=`<p class="muted">The dungeon keys are kept on the website only.</p>`;return}
  if(!ADK){b.innerHTML=`<p class="muted">Log in with the admin password on the <a href="${href("admin")}">Control Panel</a> page to edit the dungeon keys.</p>`;return}
  if(!b.children.length)b.innerHTML=`<p class="muted">Loading…</p>`;
  let s;
  try{const r=await fetch(SCAPI,{cache:"no-store"});if(!r.ok)throw await why(r);s=await r.json()}
  catch(e){b.innerHTML=`<p class="err">Could not load the dungeon keys (${esc(typeof e==="string"?e:"no answer")}).</p>`;return}
  if(!s.missing){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawDk();return}
  setPics(s.icons||[]);ITY=s.types||{};sv("itTypes",ITY);
  const P2=s.pairs||[];
  b.innerHTML=`<div class="dkl" id="dkL">${P2.map(dkRow).join("")}</div>`+(P2.length?"":`<p class="muted" id="dkNo">No pairs yet · press <b>+ Add Pair</b>.</p>`);
  if(!scaO.length)scaO=await scaOpts();
}
async function dkPost(o){
  try{
    const r=await fetch(SCAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(o)});
    if(r.status===401){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawDk();return false}
    if(!r.ok)throw await why(r);return true;
  }catch(x){dbNote("NOT saved ("+(typeof x==="string"?x:"no answer")+").",true);return false}
}
$("dkAdd").onclick=()=>{
  const l=$("dkL");if(!l)return;const no=$("dkNo");if(no)no.remove();
  l.insertAdjacentHTML("afterbegin",dkRow({},0));l.firstElementChild.querySelector("input").focus();
};
$("dkBody").addEventListener("change",e=>{
  const t=e.target;if(!t.dataset.cb)return;
  const n=t.value.trim(),pic=t.closest(".dks").querySelector(".dkpic");pic.innerHTML=n?img(n):"+";
});
$("dkBody").addEventListener("click",async e=>{
  const row=e.target.closest(".dkp");if(!row)return;
  const nm=s=>row.querySelector(`.dks[data-s="${s}"] input`).value.trim().replace(/\s+/g," ");
  const pic=e.target.closest(".dkpic");
  if(pic){
    const side=pic.closest(".dks"),lb=DKS.find(x=>x[0]===side.dataset.s)[1],n=nm(side.dataset.s);
    if(!n){dbNote(`Write the ${lb.toLowerCase()}'s name first.`,true);side.querySelector("input").focus();return}
    const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
    inp.onchange=async()=>{
      const fl=inp.files[0];if(!fl)return;const u=await scFit(fl);if(!u){dbNote("That picture could not be opened.",true);return}
      const k=slug(n);
      if(!await dkPost({save:{name:n,image:u},type:{k,t:lb}}))return;
      PICS[k]=[n,u];sv("pics",PICS);ITY[k]=lb;sv("itTypes",ITY);scRefP=null;scaO=[];
      pic.innerHTML=`<img src="${u}" alt="">`;dbNote(`Saved the picture of ${n} · it shows in Items too.`);
    };
    inp.click();return;
  }
  if(e.target.closest("[data-dks]")){
    const key=nm("key"),chest=nm("chest");
    if(!key&&!chest){dbNote("Write the key's or the chest's name first.",true);return}
    const types=[[key,"Dungeon Key"],[chest,"Dungeon Chest"]].filter(x=>slug(x[0])).map(([n,t])=>({k:slug(n),t}));
    if(!await dkPost({pair:{id:+row.dataset.id||0,key,chest},types}))return;
    types.forEach(y=>ITY[y.k]=y.t);sv("itTypes",ITY);
    dbNote(`Saved: ${key||"–"} ⇄ ${chest||"–"}.`);drawDk();return;
  }
  if(e.target.closest("[data-dkd]")){
    if(row.dataset.id&&!await dkPost({delPair:+row.dataset.id}))return;
    row.remove();dbNote("Pair removed.");
  }
});

const scaPick=(inp,v)=>{inp.value=v;scaList(inp,false)};
$("scaRe").onclick=drawScA;
$("scaBody").addEventListener("input",e=>{if(e.target.name==="n")scaList(e.target,true)});
$("scaBody").addEventListener("focusin",e=>{if(e.target.name==="n")scaList(e.target,true)});
$("scaBody").addEventListener("focusout",e=>{if(e.target.name==="n")scaList(e.target,false)});
$("scaBody").addEventListener("mousedown",e=>{
  const li=e.target.closest(".scdd li");if(!li)return;
  e.preventDefault();if(li.dataset.v)scaPick(li.closest(".scdd").querySelector("input"),li.dataset.v);
});
$("scaBody").addEventListener("change",async e=>{
  const i=e.target;if(i.type!=="file"||!i.files[0])return;
  const u=await scFit(i.files[0]),pic=i.closest(".scac").querySelector(".pix img");i.value="";
  if(!u){dbNote("That picture could not be opened.",true);return}
  pic.src=u;pic.classList.add("up");pic.dataset.up="1";
  /* with a name already written the picture is saved right away */
  const fm=pic.closest("form");if(fm.elements.n.value.trim())fm.requestSubmit();else{fm.elements.n.focus();dbNote("Picture ready · write the item's name and press Save.")}
});
$("scaBody").addEventListener("keydown",e=>{
  const t=e.target;
  if((e.key==="Enter"||e.key===" ")&&t.matches("label.fbtn")){e.preventDefault();t.querySelector("input").click();return}
  if(t.name!=="n")return;
  const ul=t.nextElementSibling,li=[...ul.querySelectorAll("li[data-v]")],a=ul.querySelector(".act"),i=li.indexOf(a);
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();if(ul.hidden){scaList(t,true);return}if(!li.length)return;
    a&&a.classList.remove("act");const n=li[(i+(e.key==="ArrowDown"?1:-1)+li.length)%li.length];n.classList.add("act");n.scrollIntoView({block:"nearest"});
  }else if(e.key==="Enter"&&!ul.hidden&&a){e.preventDefault();scaPick(t,a.dataset.v)}
  else if(e.key==="Escape")scaList(t,false);
});
$("scaBody").addEventListener("submit",async e=>{
  e.preventDefault();const fm=e.target,pic=fm.querySelector(".pix img"),name=fm.elements.n.value.trim();if(!name)return;
  const image=pic.dataset.up?pic.src:await scClean(pic.src);
  scaPost({save:{name,image,miss:+fm.dataset.id}},`Saved: ${name} is recognized from now on.`);
});
$("scaBody").addEventListener("click",e=>{
  const rm=e.target.closest("[data-rm]"),ri=e.target.closest("[data-ri]"),cl=e.target.closest("#scaClr"),pk=e.target.closest("[data-pick]");
  if(pk){const i=pk.closest("form").elements.n;scaPick(i,pk.dataset.pick);i.focus();scaList(i,false)}
  if(rm)scaPost({del:[+rm.dataset.rm]},"Removed.");
  if(ri)scaPost({delIcon:+ri.dataset.ri},"Picture removed.");
  if(cl){
    if(!cl.classList.contains("armed")){cl.classList.add("armed");cl.textContent="Click again to clear all";setTimeout(()=>{cl.classList.remove("armed");cl.textContent="Clear all"},4000);return}
    scaPost({clear:true},"Missing images cleared.");
  }
});


/* ---------- Items: every item the site knows and whether it has a picture ---------- */
let itF="all";
/* the kinds an item can be given in Items; ITY: item key -> kind, set by the admins (database) */
const KINDS=["Loot","Material","Weapon","Armour","Helmet","Shield","Shoes","Jewellery","Necklace","Earring","Bracelet","Skill Book","Character","Chest","Dungeon Key","Dungeon Chest","Pet","Mount","Costume","Other"];
let ITY=ld("itTypes",{});
async function itTypes(){
  if(!SCAPI)return;
  try{const r=await fetch(SCAPI,{cache:"no-store"});if(r.ok){const j=await r.json();ITY=j.types||{};sv("itTypes",ITY);setPics(j.icons||[])}}catch(e){}
}

function probe(k,t,cb){
  const a=new Image();a.onload=()=>cb("png");
  a.onerror=()=>{const b=new Image();b.onload=()=>cb("webp");b.onerror=()=>cb("");b.src=`png/${k}.webp?t=${t}`};
  a.src=`png/${k}.png?t=${t}`;
}
function itFilter(){
  const q=$("itQ").value.trim().toLowerCase(),its=[...$("itg").children];let miss=0,ok=0;
  its.forEach(e=>{if(e.classList.contains("miss"))miss++;if(e.classList.contains("ok"))ok++;
    e.hidden=(q&&!e.dataset.n.includes(q))||(itF==="miss"&&!e.classList.contains("miss"))||(itF==="ok"&&!e.classList.contains("ok"))});
  $("itCnt").textContent=`${its.length} items · ${ok} with picture · ${miss} missing`;
  $("itSeg").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===itF)));
}

async function drawItems(){
  const adm=!!(SCAPI&&ADK);$("itAdd").hidden=!adm;
  await itTypes();
  const t=Date.now(),list=itemNames(),have=new Set(list.map(x=>x[0]));
  /* pictures no item on the site uses yet are listed too, under their catalog or file name */
  for(const[n,fl]of await picList()){const k=fl.replace(/\.\w+$/,"");if(!have.has(k)){have.add(k);list.push([k,n||k,"Picture only"])}}
  for(const[k,[n]]of Object.entries(PICS))if(!have.has(k)){have.add(k);list.push([k,n,"Picture only"])}
  list.forEach(x=>{if(ITY[x[0]])x[2]=ITY[x[0]]});
  list.sort((a,b)=>a[1].localeCompare(b[1]));
  if(!$("itAt").options.length)$("itAt").innerHTML=KINDS.map(k=>`<option>${k}</option>`).join("");
  $("itg").innerHTML=list.map(([k,n,g],i)=>`<div class="itm" style="--i:${Math.min(i,40)}" data-k="${k}" data-nm="${esc(n)}" data-n="${esc((n+" "+g).toLowerCase())}"><div class="itp">${esc(n[0].toUpperCase())}</div><b>${esc(n)}</b>${adm?`<button class="itg-t" title="Click to set what this item is">${esc(g)}</button>`:`<small class="itg-t">${esc(g)}</small>`}<button class="cp" title="Copy file name">${k}.png</button><small class="its">Checking…</small></div>`).join("")
    ||`<p class="muted">No items yet.</p>`;
  itFilter();
  $("itg").querySelectorAll(".itm").forEach(e=>probe(e.dataset.k,t,x=>{
    const db=!x&&PICS[e.dataset.k];
    e.classList.add(x||db?"ok":"miss");
    if(x){e.querySelector(".itp").innerHTML=`<img src="png/${e.dataset.k}.${x}?t=${t}" alt="">`;e.querySelector(".cp").textContent=`${e.dataset.k}.${x}`}
    else if(db)e.querySelector(".itp").innerHTML=`<img src="${db[1]}" alt="">`;
    const up=!x&&!db&&SCAPI&&ADK;e.classList.toggle("adm",!!up);if(up){const p=e.querySelector(".itp");p.title="Upload a picture";p.tabIndex=0;p.setAttribute("role","button")}
    e.querySelector(".its").textContent=x?"Has picture":db?"Picture from Control Panel":up?"Missing picture · click the box to upload":"Missing picture";
    itFilter();
  }));
}
$("itSeg").onclick=e=>{const b=e.target.closest("[data-v]");if(b){itF=b.dataset.v;itFilter()}};
$("itQ").addEventListener("input",itFilter);
$("itRe").onclick=drawItems;
/* a missing picture uploaded on its card: kept in the database (like Control Panel -> Screen Tracker), so every visitor sees it */
function itUpload(card){
  const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
  inp.onchange=async()=>{
    const fl=inp.files[0];if(!fl)return;
    const u=await scFit(fl),n=card.dataset.nm,k=card.dataset.k;
    if(!u){dbNote("That picture could not be opened.",true);return}
    try{
      const r=await fetch(SCAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({save:{name:n,image:u}})});
      if(r.status===401){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawItems();return}
      if(!r.ok)throw await why(r);
    }catch(x){dbNote("Picture NOT saved ("+(typeof x==="string"?x:"no answer")+").",true);return}
    PICS[k]=[n,u];sv("pics",PICS);scRefP=null;
    card.classList.remove("miss","adm");card.classList.add("ok");card.querySelector(".itp").innerHTML=`<img src="${u}" alt="">`;card.querySelector(".itp").title="";
    card.querySelector(".its").textContent="Picture from Control Panel";itFilter();
    dbNote(`Saved the picture of ${n} · every visitor sees it now.`);
  };
  inp.click();
}
$("itg").addEventListener("keydown",e=>{const p=e.target.closest(".itm.adm .itp");if(p&&(e.key==="Enter"||e.key===" ")){e.preventDefault();itUpload(p.closest(".itm"))}});
/* the kind under a picture: click it, pick one from the list; saved in the database */
async function itKind(card,t){
  const k=card.dataset.k,old=ITY[k];ITY[k]=t;sv("itTypes",ITY);
  try{
    const r=await fetch(SCAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:{k,t}})});
    if(r.status===401){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawItems();return}
    if(!r.ok)throw await why(r);
  }catch(x){if(old)ITY[k]=old;else delete ITY[k];sv("itTypes",ITY);dbNote("Kind NOT saved ("+(typeof x==="string"?x:"no answer")+").",true);drawItems();return}
  dbNote(`${card.dataset.nm} is now: ${t}.`);
}
function itKindPick(b){
  const card=b.closest(".itm"),cur=b.textContent,s=document.createElement("select");s.className="itg-s";s.setAttribute("aria-label","Kind of "+card.dataset.nm);
  s.innerHTML=[...new Set([cur,...KINDS])].map(k=>`<option${k===cur?" selected":""}>${esc(k)}</option>`).join("");
  b.replaceWith(s);s.focus();try{s.showPicker()}catch(e){}
  let done=false;const end=()=>{if(done)return;done=true;const v=s.value;b.textContent=v;s.replaceWith(b);
    card.dataset.n=(card.dataset.nm+" "+v).toLowerCase();if(v!==cur)itKind(card,v);b.focus()};
  s.onchange=end;s.onblur=end;s.onkeydown=e=>{if(e.key==="Escape"){s.value=cur;end()}};
}
/* Add a picture: any name (a known item or a new one), its kind, a picture file */
let itAU="";
$("itAf").onchange=async()=>{const fl=$("itAf").files[0];$("itAf").value="";if(!fl)return;itAU=await scFit(fl)||"";
  $("itApv").innerHTML=itAU?`<img src="${itAU}" alt="">`:"";if(!itAU)dbNote("That picture could not be opened.",true)};
$("itAfL").onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("itAf").click()}};
$("itAn").addEventListener("change",()=>{const k=slug($("itAn").value),c=$("itg").querySelector(`.itm[data-k="${k}"] .itg-t`);if(c&&KINDS.includes(c.textContent))$("itAt").value=c.textContent});
$("itAs").onclick=async()=>{
  const n=$("itAn").value.trim().replace(/\s+/g," "),k=slug(n),t=$("itAt").value;
  if(!k){dbNote("Write the item's name first.",true);return $("itAn").focus()}
  if(!itAU){dbNote("Choose a picture first.",true);return $("itAfL").focus()}
  try{
    const r=await fetch(SCAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({save:{name:n,image:itAU},type:{k,t}})});
    if(r.status===401){ADK="";sv("admKey","");drawDb();dbNote("Not logged in any more.",true);drawItems();return}
    if(!r.ok)throw await why(r);
  }catch(x){dbNote("Picture NOT saved ("+(typeof x==="string"?x:"no answer")+").",true);return}
  PICS[k]=[n,itAU];sv("pics",PICS);ITY[k]=t;sv("itTypes",ITY);scRefP=null;
  $("itAn").value="";$("itApv").innerHTML="";itAU="";
  dbNote(`Saved the picture of ${n} · every visitor sees it now.`);
  await drawItems();const c=$("itg").querySelector(`.itm[data-k="${k}"]`);if(c)c.scrollIntoView({block:"center",behavior:RM.matches?"auto":"smooth"});
};
$("itg").addEventListener("click",e=>{
  const kb=e.target.closest("button.itg-t");if(kb){itKindPick(kb);return}
  const up=e.target.closest(".itm.adm .itp");if(up){itUpload(up.closest(".itm"));return}
  const b=e.target.closest(".cp");if(!b)return;
  const s=b.textContent,done=()=>{b.textContent="Copied!";setTimeout(()=>{b.textContent=s},900)};
  try{navigator.clipboard.writeText(s).then(done,()=>{})}catch(x){}
});


/* ---------- Database box ---------- */
/* logging out ends the admin cookie (here, or in every browser); the page reloads without the Control Panel */
async function cpOut(all){
  try{await fetch(CPAPI,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(all?{logoutAll:true}:{logout:true})})}catch(e){}
  sv("admKey","");location.href=href("");
}
$("dbOut").onclick=()=>cpOut(false);
$("dbOutAll").onclick=()=>{
  const b=$("dbOutAll");
  if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="Click again: log out every browser";setTimeout(()=>{b.classList.remove("armed");b.textContent="Log out everywhere"},4000);return}
  cpOut(true);
};
$("dbRe").onclick=()=>dbLoad(true);
/* overwrites the database with this browser's lists, so it asks for a second click */
$("dbUp").onclick=()=>{
  const b=$("dbUp");
  if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="Click again to overwrite the database";setTimeout(()=>{b.classList.remove("armed");b.textContent="Upload this browser's data"},4000);return}
  b.classList.remove("armed");b.textContent="Upload this browser's data";
  const cur=CAT;for(const c of Object.keys(CATS))loadCat(c);loadCat(cur);   // every category gets its saved list (with the built-in items)
  dbPush([...Object.keys(CATS),"skills","chars","dvOff"]);
};
