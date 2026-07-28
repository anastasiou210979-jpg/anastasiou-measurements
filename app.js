import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, enableIndexedDbPersistence, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const KEY="ANASTASIOU_MEASUREMENTS_V52", LEGACY_KEYS=["ANASTASIOU_MEASUREMENTS_V51","ANASTASIOU_OFFLINE_V4"], PHOTO_KEY=KEY+"_PHOTOS";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let auth,db,user=null,offline=false,projects=[],photos=[],unsubscribe=null,saveTimer=null;
const ids=["id","projectNo","date","stage","assignee","customer","phone","customerEmail","address","afm","doy","measurer","gps"];
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const uid=()=>crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
const localRead=()=>{try{const current=JSON.parse(localStorage.getItem(KEY)||"[]");if(current.length)return current;for(const key of LEGACY_KEYS){const old=JSON.parse(localStorage.getItem(key)||"[]");if(Array.isArray(old)&&old.length){localStorage.setItem(KEY,JSON.stringify(old));return old}}return[]}catch{return[]}};
const localWrite=a=>localStorage.setItem(KEY,JSON.stringify(a));
const setSync=(text,kind="")=>{const e=$("#syncState");e.textContent=text;e.style.background=kind==="bad"?"#b42318":kind==="ok"?"#137a49":"#ffffff22"};

function rowHTML(d={}){return `<tr><td class="num"></td><td><input data-k="room" value="${esc(d.room)}"></td><td><input data-k="height" inputmode="decimal" value="${esc(d.height)}"></td><td><input data-k="width" inputmode="decimal" value="${esc(d.width)}"></td><td><input data-k="lampas" inputmode="decimal" value="${esc(d.lampas)}"></td><td><input data-k="armokalipto" value="${esc(d.armokalipto)}"></td><td><input data-k="type" value="${esc(d.type)}"></td><td><select data-k="roller"><option></option><option ${d.roller==="Ναι"?"selected":""}>Ναι</option><option ${d.roller==="Όχι"?"selected":""}>Όχι</option></select></td><td><select data-k="screen"><option></option><option ${d.screen==="Ναι"?"selected":""}>Ναι</option><option ${d.screen==="Όχι"?"selected":""}>Όχι</option></select></td><td><textarea data-k="notes">${esc(d.notes)}</textarea></td><td><button type="button" class="danger del">×</button></td></tr>`}
function addRows(n,data=[]){for(let i=0;i<n;i++)$("#windows").insertAdjacentHTML("beforeend",rowHTML(data[i]||{}));bindRows()}
function bindRows(){$$(".del").forEach(b=>b.onclick=()=>{if($("#windows").children.length>1)b.closest("tr").remove();bindRows()});$$(".num").forEach((e,i)=>e.textContent=i+1)}
function collect(){
  const p={};ids.forEach(id=>p[id]=$("#"+id).value);p.id=p.id||uid();p.updatedAt=new Date().toISOString();
  p.windows=$$("#windows tr").map(tr=>{const o={};tr.querySelectorAll("[data-k]").forEach(e=>o[e.dataset.k]=e.value);return o});
  p.extra={};$$("[data-extra]").forEach(e=>p.extra[e.dataset.extra]=e.value);p.special=$("#special").value;
  p.updatedBy=$("#activeUser").value||user?.email||"offline";return p;
}
function clearForm(){
  ids.forEach(id=>$("#"+id).value="");$("#date").value=new Date().toISOString().slice(0,10);$("#stage").value="offer";$("#assignee").value="Κώστας";
  $("#activeUser").value=localStorage.getItem(KEY+"_ACTIVE_USER")||"Κώστας";
  $$("[data-extra]").forEach(e=>e.value="");$("#special").value="";$("#windows").innerHTML="";addRows(20);photos=[];renderPhotos();
}
function fill(p){clearForm();ids.forEach(id=>$("#"+id).value=p[id]||"");$$("[data-extra]").forEach(e=>e.value=p.extra?.[e.dataset.extra]||"");$("#special").value=p.special||"";$("#windows").innerHTML="";addRows(Math.max(1,p.windows?.length||0),p.windows||[]);photos=JSON.parse(localStorage.getItem(PHOTO_KEY+"_"+p.id)||"[]");renderPhotos();location.hash="#project"}
function render(){
  const q=$("#search").value.toLowerCase(),stageFilter=$("#stageFilter").value,box=$("#projectList");box.innerHTML="";
  projects.filter(p=>[p.projectNo,p.customer,p.phone,p.address].join(" ").toLowerCase().includes(q)&&(!stageFilter||p.stage===stageFilter)).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")).forEach(p=>{
    const d=document.createElement("div");d.className="item";d.innerHTML=`<div><div class="title">${esc(p.projectNo||"Χωρίς αριθμό")} — ${esc(p.customer||"Χωρίς πελάτη")}</div><div class="muted">${esc(p.phone)} • ${p.stage==="offer"?"Προσφορά":p.stage==="final"?"Τελική μέτρηση":"Ολοκληρώθηκε"} • ${esc(p.assignee)}</div></div><div class="tools"><button class="open">Άνοιγμα</button><button class="danger remove">Διαγραφή</button></div>`;
    d.querySelector(".open").onclick=()=>fill(p);d.querySelector(".remove").onclick=()=>removeProject(p.id);box.appendChild(d);
  });if(!box.children.length)box.innerHTML='<div class="note">Δεν υπάρχουν έργα.</div>';
  $("#offerCount").textContent=projects.filter(p=>p.stage==="offer").length;
  $("#finalCount").textContent=projects.filter(p=>p.stage==="final").length;
  $("#doneCount").textContent=projects.filter(p=>p.stage==="done").length;
  renderCustomers();
}
function renderCustomers(){
  const q=$("#customerSearch").value.toLowerCase(),map=new Map(),box=$("#customerList");box.innerHTML="";
  for(const p of projects){const key=(p.customer||"").trim().toLowerCase();if(!key)continue;const c=map.get(key)||{name:p.customer,phone:p.phone,email:p.customerEmail,address:p.address,count:0};c.count++;map.set(key,c)}
  [...map.values()].filter(c=>[c.name,c.phone,c.email,c.address].join(" ").toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name,"el")).forEach(c=>{
    const d=document.createElement("div");d.className="item";d.innerHTML=`<div><div class="title">${esc(c.name)}</div><div class="muted">${esc(c.phone||"")} ${c.email?"• "+esc(c.email):""} ${c.address?"• "+esc(c.address):""}<br>${c.count} έργο/έργα</div></div><button class="light">Νέο έργο</button>`;
    d.querySelector("button").onclick=()=>{clearForm();$("#customer").value=c.name;$("#phone").value=c.phone||"";$("#customerEmail").value=c.email||"";$("#address").value=c.address||"";location.hash="#project"};box.appendChild(d);
  });if(!box.children.length)box.innerHTML='<div class="note">Δεν υπάρχουν πελάτες.</div>';
}
async function saveProject(silent=false){
  const p=collect();if(!p.projectNo&&!p.customer){if(!silent)alert("Γράψε αριθμό έργου ή πελάτη.");return}
  $("#id").value=p.id;localUpsert(p);localStorage.setItem(PHOTO_KEY+"_"+p.id,JSON.stringify(photos));
  if(user&&!offline){try{setSync("⏳ Συγχρονισμός…");await setDoc(doc(db,"projects",p.id),{...p,serverUpdatedAt:serverTimestamp()},{merge:true});setSync("☁️ Συγχρονίστηκε","ok")}catch(e){setSync("📴 Αποθηκεύτηκε τοπικά","bad")}}
  if(!silent)alert("Η μέτρηση αποθηκεύτηκε.");
}
function localUpsert(p){const a=localRead(),i=a.findIndex(x=>x.id===p.id);i<0?a.push(p):a[i]=p;localWrite(a);projects=a;render()}
async function removeProject(id){if(!confirm("Να διαγραφεί το έργο;"))return;localWrite(localRead().filter(p=>p.id!==id));if(user&&!offline)try{await deleteDoc(doc(db,"projects",id))}catch{}projects=localRead();render()}
function subscribe(){unsubscribe?.();unsubscribe=onSnapshot(collection(db,"projects"),snap=>{projects=snap.docs.map(d=>({id:d.id,...d.data()}));localWrite(projects);render();setSync("☁️ Συγχρονίστηκε","ok")},()=>{projects=localRead();render();setSync("📴 Τοπικό αντίγραφο","bad")})}
function showApp(){ $("#loginCard").classList.add("hidden");$("#app").classList.remove("hidden");$("#bottomBar").classList.remove("hidden");projects=localRead();render();if(!$("#windows").children.length)clearForm()}
function messageBody(){const p=collect(),rows=p.windows.filter(r=>Object.values(r).some(v=>String(v).trim()));return [`ANASTASIOU O.E. — ΜΕΤΡΗΣΕΙΣ`,`Αρ. έργου: ${p.projectNo||"-"}`,`Πελάτης: ${p.customer||"-"}`,`Τηλέφωνο: ${p.phone||"-"}`,`Email: ${p.customerEmail||"-"}`,`Διεύθυνση: ${p.address||"-"}`,`ΑΦΜ: ${p.afm||"-"}`,`ΔΟΥ: ${p.doy||"-"}`,`GPS: ${p.gps||"-"}`,`Στάδιο: ${p.stage}`,`Υπεύθυνος: ${p.assignee}`,"",...rows.map((r,i)=>`${i+1}. ${r.room||"-"} | Υ:${r.height||"-"} | Φ:${r.width||"-"} | Λάμπας:${r.lampas||"-"} | Αρμοκάλυπτο:${r.armokalipto||"-"} | ${r.type||""} | Ρολό:${r.roller||"-"} | Σίτα:${r.screen||"-"} | ${r.notes||""}`),p.special?`\nΕΙΔΙΚΕΣ ΚΑΤΑΣΚΕΥΕΣ\n${p.special}`:""].join("\n")}
async function share(){const text=messageBody();try{if(navigator.share)await navigator.share({title:"ANASTASIOU Μετρήσεις",text});else{await navigator.clipboard.writeText(text);alert("Τα στοιχεία αντιγράφηκαν.")}}catch(e){}}
function renderPhotos(){const g=$("#photos");g.innerHTML="";photos.forEach((src,i)=>{const d=document.createElement("div");d.className="photo";d.innerHTML=`<img src="${src}"><button class="danger">×</button>`;d.querySelector("button").onclick=()=>{photos.splice(i,1);renderPhotos()};g.appendChild(d)})}
function compress(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const s=Math.min(1,1000/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=im.width*s;c.height=im.height*s;c.getContext("2d").drawImage(im,0,0,c.width,c.height);res(c.toDataURL("image/jpeg",.7))};im.src=r.result};r.onerror=rej;r.readAsDataURL(file)})}

try{const fa=initializeApp(firebaseConfig);auth=getAuth(fa);db=getFirestore(fa);enableIndexedDbPersistence(db).catch(()=>{});onAuthStateChanged(auth,u=>{user=u;if(u){offline=false;showApp();subscribe()}else if(!offline){$("#loginCard").classList.remove("hidden")}})}catch(e){$("#loginMessage").textContent="Δεν φορτώθηκε το Firebase. Μπορείς να συνεχίσεις χωρίς σύνδεση."}
$("#loginBtn").onclick=async()=>{try{$("#loginMessage").textContent="Σύνδεση…";await signInWithEmailAndPassword(auth,$("#loginEmail").value.trim(),$("#loginPassword").value);$("#loginMessage").textContent=""}catch(e){$("#loginMessage").textContent="Αποτυχία σύνδεσης. Έλεγξε email και κωδικό."}};
$("#offlineBtn").onclick=()=>{offline=true;setSync("📴 Τοπική λειτουργία");showApp()};$("#logoutBtn").onclick=()=>signOut(auth);$("#newBtn").onclick=clearForm;$("#projectsBtn").onclick=()=>location.hash="#projectListCard";
$("#homeBtn").onclick=()=>location.hash="#dashboard";$("#customersBtn").onclick=()=>location.hash="#customersCard";$("#backupBtn").onclick=()=>location.hash="#backupCard";
$("#addRow").onclick=()=>addRows(1);$("#add5").onclick=()=>addRows(5);$("#saveBtn").onclick=()=>saveProject();$("#shareBtn").onclick=share;$("#printBtn").onclick=()=>window.print();$("#search").oninput=render;$("#stageFilter").onchange=render;$("#customerSearch").oninput=renderCustomers;
$("#gpsBtn").onclick=()=>navigator.geolocation?.getCurrentPosition(p=>$("#gps").value=`${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`,()=>alert("Δεν δόθηκε πρόσβαση στην τοποθεσία."),{enableHighAccuracy:true,timeout:15000});
$("#mapsBtn").onclick=()=>{const q=$("#gps").value||$("#address").value;if(q)location.href=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`};$("#callBtn").onclick=()=>{if($("#phone").value)location.href=`tel:${$("#phone").value.replace(/\s/g,"")}`};
$("#handoffBtn").onclick=()=>{$("#stage").value="final";$("#assignee").value="Γιώργος";saveProject()};
$("#photoInput").onchange=async e=>{for(const f of e.target.files)try{photos.push(await compress(f))}catch{}renderPhotos();e.target.value=""};
$("#clearPhotosBtn").onclick=()=>{if(photos.length&&confirm("Να διαγραφούν όλες οι φωτογραφίες αυτού του έργου;")){photos=[];renderPhotos()}};
$("#activeUser").onchange=()=>{localStorage.setItem(KEY+"_ACTIVE_USER",$("#activeUser").value);$("#assignee").value=$("#activeUser").value};
function download(name,text){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:"application/json"}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$("#exportBtn").onclick=()=>{download(`ANASTASIOU_BACKUP_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({version:"5.2",exportedAt:new Date().toISOString(),projects},null,2));$("#backupStatus").textContent="Το backup δημιουργήθηκε."};
$("#importBtn").onclick=()=>$("#importFile").click();
$("#importFile").onchange=async e=>{try{const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text()),incoming=Array.isArray(data)?data:data.projects;if(!Array.isArray(incoming))throw new Error();const map=new Map(projects.map(p=>[p.id,p]));incoming.forEach(p=>{if(p.id)map.set(p.id,p)});projects=[...map.values()];localWrite(projects);render();if(user&&!offline){setSync("⏳ Συγχρονισμός backup…");for(const p of incoming)if(p.id)await setDoc(doc(db,"projects",p.id),{...p,serverUpdatedAt:serverTimestamp()},{merge:true});setSync("☁️ Συγχρονίστηκε","ok")}$("#backupStatus").textContent=`Εισήχθησαν ${incoming.length} έργα.`}catch{$("#backupStatus").textContent="Το αρχείο backup δεν είναι έγκυρο."}e.target.value=""};
$("#app").addEventListener("input",()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveProject(true),1200)});
window.addEventListener("online",()=>{if(user){setSync("⏳ Επανασύνδεση…");subscribe()}});window.addEventListener("offline",()=>setSync("📴 Χωρίς σύνδεση","bad"));
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js");
