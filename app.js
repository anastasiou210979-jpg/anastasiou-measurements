import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, enableIndexedDbPersistence, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const KEY = "ANASTASIOU_MEASUREMENTS_V53";
const PHOTO_KEY = `${KEY}_PHOTOS`;
const LEGACY_KEYS = [
  "ANASTASIOU_MEASUREMENTS_V52", "ANASTASIOU_MEASUREMENTS_V51",
  "ANASTASIOU_OFFLINE_V4", "ANASTASIOU_PROJECTS", "anastasiou_projects"
];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const fieldIds = ["id","projectNo","date","stage","assignee","customer","phone","customerEmail","address","afm","doy","measurer","gps","generalNotes"];
let auth, db, currentUser = null, offlineMode = false, projects = [], photos = [], unsubscribe = null, saveTimer = null;

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const createId = () => crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const stageName = stage => ({offer:"Μέτρηση προσφοράς", final:"Τελική μέτρηση", done:"Ολοκληρώθηκε"}[stage] || stage || "Μέτρηση προσφοράς");
const normalizeStage = value => {
  const text = String(value || "").toLowerCase();
  if (["final","τελική μέτρηση","εγκεκριμένο","approved"].some(x => text.includes(x))) return "final";
  if (["done","ολοκληρωμένο","ολοκληρώθηκε"].some(x => text.includes(x))) return "done";
  return "offer";
};
const setSync = (text, kind = "") => {
  const badge = $("#syncState");
  badge.textContent = text;
  badge.style.background = kind === "bad" ? "#b42318" : kind === "ok" ? "#15734c" : "#ffffff22";
};

function extractLegacyProjects(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.projects)) return parsed.projects;
  if (parsed && typeof parsed === "object") return Object.values(parsed).filter(x => x && typeof x === "object");
  return [];
}
function migrateProject(raw) {
  const project = {...raw};
  project.id = project.id || createId();
  project.projectNo = project.projectNo ?? project.number ?? project.projectNumber ?? "";
  project.customer = project.customer ?? project.customerName ?? project.client ?? "";
  project.customerEmail = project.customerEmail ?? project.email ?? "";
  project.stage = normalizeStage(project.stage ?? project.status);
  project.assignee = project.assignee || (project.stage === "final" ? "Γιώργος" : "Κώστας");
  project.windows = Array.isArray(project.windows) ? project.windows : Array.isArray(project.rows) ? project.rows : [];
  project.extra = project.extra || {};
  project.special = project.special ?? project.specialConstruction ?? "";
  project.generalNotes = project.generalNotes ?? project.notes ?? "";
  project.history = Array.isArray(project.history) ? project.history : [];
  return project;
}
function readLocal() {
  try {
    const current = extractLegacyProjects(JSON.parse(localStorage.getItem(KEY) || "[]")).map(migrateProject);
    if (current.length) return current;
    for (const key of LEGACY_KEYS) {
      const old = extractLegacyProjects(JSON.parse(localStorage.getItem(key) || "[]")).map(migrateProject);
      if (old.length) {
        localStorage.setItem(KEY, JSON.stringify(old));
        return old;
      }
    }
  } catch {}
  return [];
}
const writeLocal = data => localStorage.setItem(KEY, JSON.stringify(data));

function rowHtml(data = {}) {
  const roller = data.roller ?? data.roll ?? "";
  const screen = data.screen ?? data.sita ?? "";
  return `<tr>
    <td class="num"></td>
    <td><input data-k="room" value="${escapeHtml(data.room)}"></td>
    <td><input data-k="height" inputmode="decimal" value="${escapeHtml(data.height)}"></td>
    <td><input data-k="width" inputmode="decimal" value="${escapeHtml(data.width)}"></td>
    <td><input data-k="lampas" inputmode="decimal" value="${escapeHtml(data.lampas)}"></td>
    <td><input data-k="armokalipto" value="${escapeHtml(data.armokalipto)}"></td>
    <td><input data-k="type" value="${escapeHtml(data.type)}"></td>
    <td><select data-k="roller"><option></option><option ${roller === "Ναι" ? "selected" : ""}>Ναι</option><option ${roller === "Όχι" ? "selected" : ""}>Όχι</option></select></td>
    <td><select data-k="screen"><option></option><option ${screen === "Ναι" ? "selected" : ""}>Ναι</option><option ${screen === "Όχι" ? "selected" : ""}>Όχι</option></select></td>
    <td><textarea data-k="notes">${escapeHtml(data.notes)}</textarea></td>
    <td><button type="button" class="danger deleteRow">×</button></td>
  </tr>`;
}
function addRows(count, data = []) {
  for (let i = 0; i < count; i++) $("#windows").insertAdjacentHTML("beforeend", rowHtml(data[i] || {}));
  bindRows();
}
function bindRows() {
  $$(".deleteRow").forEach(button => button.onclick = () => {
    if ($("#windows").children.length > 1) button.closest("tr").remove();
    bindRows();
  });
  $$(".num").forEach((cell, index) => cell.textContent = index + 1);
}

function collectProject() {
  const project = {};
  fieldIds.forEach(id => project[id] = $(`#${id}`).value);
  project.id = project.id || createId();
  project.stage = normalizeStage(project.stage);
  project.updatedAt = new Date().toISOString();
  project.updatedBy = $("#activeUser").value || currentUser?.email || "offline";
  project.windows = $$("#windows tr").map(row => {
    const item = {};
    row.querySelectorAll("[data-k]").forEach(input => item[input.dataset.k] = input.value);
    return item;
  });
  project.extra = {};
  $$("[data-extra]").forEach(input => project.extra[input.dataset.extra] = input.value);
  project.special = $("#special").value;
  const old = projects.find(item => item.id === project.id);
  project.history = old?.history ? [...old.history] : [];
  return project;
}
function clearForm() {
  fieldIds.forEach(id => $(`#${id}`).value = "");
  $("#date").value = new Date().toISOString().slice(0, 10);
  $("#stage").value = "offer";
  $("#assignee").value = "Κώστας";
  $("#activeUser").value = localStorage.getItem(`${KEY}_ACTIVE_USER`) || "Κώστας";
  $$("[data-extra]").forEach(input => input.value = "");
  $("#special").value = "";
  $("#windows").innerHTML = "";
  addRows(20);
  photos = [];
  renderPhotos();
  renderHistory([]);
  location.hash = "#project";
}
function highestExistingProjectNumber(year) {
  const prefix = `${year}-`;
  return projects.reduce((highest, project) => {
    const projectNumber = String(project.projectNo || "");
    if (!projectNumber.startsWith(prefix)) return highest;
    const number = Number(projectNumber.slice(prefix.length));
    return Number.isFinite(number) ? Math.max(highest, number) : highest;
  }, 0);
}
async function assignNextProjectNumber() {
  if (!currentUser || offlineMode || !navigator.onLine) {
    alert("Για ασφαλή αυτόματη αρίθμηση συνδέσου στο Internet και στον λογαριασμό σου.");
    return false;
  }
  const year = new Date().getFullYear();
  const counterRef = doc(db, "projects", `_counter_${year}`);
  const localMaximum = highestExistingProjectNumber(year);
  try {
    setSync("⏳ Νέος αριθμός έργου…");
    const next = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(counterRef);
      const stored = Number(snapshot.data()?.value || 0);
      const value = Math.max(stored, localMaximum) + 1;
      transaction.set(counterRef, {value, updatedAt:serverTimestamp()});
      return value;
    });
    $("#projectNo").value = `${year}-${String(next).padStart(3, "0")}`;
    setSync("☁️ Συγχρονίστηκε", "ok");
    return true;
  } catch {
    setSync("⚠️ Δεν δόθηκε αριθμός", "bad");
    alert("Δεν μπόρεσε να δημιουργηθεί νέος αριθμός έργου. Έλεγξε τη σύνδεση και δοκίμασε ξανά.");
    return false;
  }
}
function fillForm(project) {
  clearForm();
  fieldIds.forEach(id => $(`#${id}`).value = project[id] || "");
  $("#stage").value = normalizeStage(project.stage);
  $$("[data-extra]").forEach(input => input.value = project.extra?.[input.dataset.extra] || "");
  $("#special").value = project.special || "";
  $("#windows").innerHTML = "";
  addRows(Math.max(1, project.windows?.length || 0), project.windows || []);
  try { photos = JSON.parse(localStorage.getItem(`${PHOTO_KEY}_${project.id}`) || "[]"); } catch { photos = []; }
  renderPhotos();
  renderHistory(project.history || []);
  location.hash = "#project";
}
function renderHistory(history) {
  $("#historyBox").innerHTML = history.length
    ? `<strong>Ιστορικό:</strong> ${history.slice(-4).reverse().map(item => `${escapeHtml(item.when)} — ${escapeHtml(item.user)}: ${escapeHtml(item.action)}`).join("<br>")}`
    : "";
}
function localUpsert(project) {
  const local = readLocal();
  const index = local.findIndex(item => item.id === project.id);
  if (index < 0) local.push(project); else local[index] = project;
  writeLocal(local);
  projects = local;
  renderAll();
}
async function saveProject(silent = false, action = "Αποθήκευση μέτρησης") {
  const project = collectProject();
  if (!project.projectNo && !project.customer) {
    if (!silent) alert("Γράψε αριθμό έργου ή όνομα πελάτη.");
    return false;
  }
  const last = project.history.at(-1);
  if (!silent || !last || Date.now() - new Date(last.iso || 0).getTime() > 60000) {
    project.history.push({iso:new Date().toISOString(), when:new Date().toLocaleString("el-GR"), user:project.updatedBy, action});
  }
  $("#id").value = project.id;
  localUpsert(project);
  try { localStorage.setItem(`${PHOTO_KEY}_${project.id}`, JSON.stringify(photos)); } catch { if (!silent) alert("Οι φωτογραφίες είναι πολλές για τη μνήμη της συσκευής. Κράτησε λιγότερες φωτογραφίες."); }
  if (currentUser && !offlineMode) {
    try {
      setSync("⏳ Συγχρονισμός…");
      await setDoc(doc(db, "projects", project.id), {...project, serverUpdatedAt:serverTimestamp()}, {merge:true});
      setSync("☁️ Συγχρονίστηκε", "ok");
    } catch {
      setSync("📴 Αποθηκεύτηκε τοπικά", "bad");
    }
  }
  if (!silent) alert("Η μέτρηση αποθηκεύτηκε.");
  return true;
}
async function removeProject(id) {
  if (!confirm("Να διαγραφεί το έργο;")) return;
  writeLocal(readLocal().filter(project => project.id !== id));
  localStorage.removeItem(`${PHOTO_KEY}_${id}`);
  if (currentUser && !offlineMode) try { await deleteDoc(doc(db, "projects", id)); } catch {}
  projects = readLocal();
  renderAll();
}

function renderProjects() {
  const query = $("#search").value.toLowerCase();
  const filter = $("#stageFilter").value;
  const box = $("#projectList");
  box.innerHTML = "";
  projects
    .filter(project => [project.projectNo,project.customer,project.phone,project.address].join(" ").toLowerCase().includes(query) && (!filter || normalizeStage(project.stage) === filter))
    .sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .forEach(project => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<div><div class="title">${escapeHtml(project.projectNo || "Χωρίς αριθμό")} — ${escapeHtml(project.customer || "Χωρίς πελάτη")}</div><div class="muted">${escapeHtml(project.phone || "")} • ${stageName(normalizeStage(project.stage))} • ${escapeHtml(project.assignee || "")}</div></div><div class="tools"><button class="open">Άνοιγμα</button><button class="danger remove">Διαγραφή</button></div>`;
      item.querySelector(".open").onclick = () => fillForm(project);
      item.querySelector(".remove").onclick = () => removeProject(project.id);
      box.appendChild(item);
    });
  if (!box.children.length) box.innerHTML = '<div class="note">Δεν υπάρχουν έργα.</div>';
}
function renderCustomers() {
  const query = $("#customerSearch").value.toLowerCase();
  const customers = new Map();
  for (const project of projects) {
    const key = (project.customer || "").trim().toLowerCase();
    if (!key) continue;
    const customer = customers.get(key) || {name:project.customer,phone:project.phone,email:project.customerEmail,address:project.address,afm:project.afm,doy:project.doy,count:0};
    customer.count++;
    customers.set(key, customer);
  }
  const box = $("#customerList");
  box.innerHTML = "";
  [...customers.values()]
    .filter(customer => [customer.name,customer.phone,customer.email,customer.address].join(" ").toLowerCase().includes(query))
    .sort((a,b) => a.name.localeCompare(b.name, "el"))
    .forEach(customer => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<div><div class="title">${escapeHtml(customer.name)}</div><div class="muted">${escapeHtml(customer.phone || "")} ${customer.email ? "• "+escapeHtml(customer.email) : ""} ${customer.address ? "• "+escapeHtml(customer.address) : ""}<br>${customer.count} έργο/έργα</div></div><button class="light">Νέο έργο</button>`;
      item.querySelector("button").onclick = () => {
        clearForm();
        $("#customer").value = customer.name;
        $("#phone").value = customer.phone || "";
        $("#customerEmail").value = customer.email || "";
        $("#address").value = customer.address || "";
        $("#afm").value = customer.afm || "";
        $("#doy").value = customer.doy || "";
      };
      box.appendChild(item);
    });
  if (!box.children.length) box.innerHTML = '<div class="note">Δεν υπάρχουν πελάτες.</div>';
}
function renderAll() {
  renderProjects();
  renderCustomers();
  $("#offerCount").textContent = projects.filter(project => normalizeStage(project.stage) === "offer").length;
  $("#finalCount").textContent = projects.filter(project => normalizeStage(project.stage) === "final").length;
  $("#doneCount").textContent = projects.filter(project => normalizeStage(project.stage) === "done").length;
}
function subscribeToProjects() {
  unsubscribe?.();
  unsubscribe = onSnapshot(collection(db, "projects"), snapshot => {
    const cloud = snapshot.docs
      .filter(document => !document.id.startsWith("_counter"))
      .map(document => migrateProject({id:document.id, ...document.data()}));
    const local = readLocal();
    const merged = new Map(local.map(project => [project.id, project]));
    cloud.forEach(project => merged.set(project.id, project));
    projects = [...merged.values()];
    writeLocal(projects);
    renderAll();
    setSync("☁️ Συγχρονίστηκε", "ok");
  }, () => {
    projects = readLocal();
    renderAll();
    setSync("📴 Τοπικό αντίγραφο", "bad");
  });
}
async function uploadUnsyncedLocal() {
  for (const project of readLocal()) {
    await setDoc(doc(db, "projects", project.id), {...project, serverUpdatedAt:serverTimestamp()}, {merge:true});
  }
}
function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#bottomBar").classList.remove("hidden");
  projects = readLocal();
  renderAll();
  if (!$("#windows").children.length) clearForm();
}

function messageBody() {
  const project = collectProject();
  const rows = project.windows.filter(row => Object.values(row).some(value => String(value).trim()));
  const mapUrl = project.gps || project.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.gps || project.address)}` : "";
  return [
    "ANASTASIOU O.E. — ΜΕΤΡΗΣΕΙΣ",
    `Αρ. έργου: ${project.projectNo || "-"}`, `Ημερομηνία: ${project.date || "-"}`,
    `Πελάτης: ${project.customer || "-"}`, `Τηλέφωνο: ${project.phone || "-"}`, `Email: ${project.customerEmail || "-"}`,
    `Διεύθυνση: ${project.address || "-"}`, `ΑΦΜ: ${project.afm || "-"}`, `ΔΟΥ: ${project.doy || "-"}`,
    `Στάδιο: ${stageName(project.stage)}`, `Υπεύθυνος: ${project.assignee || "-"}`, mapUrl ? `Χάρτης: ${mapUrl}` : "",
    "", "ΚΟΥΦΩΜΑΤΑ",
    ...rows.map((row,index) => `${index+1}. ${row.room||"-"} | Ύψος:${row.height||"-"} | Φάρδος:${row.width||"-"} | Λάμπας:${row.lampas||"-"} | Αρμοκάλυπτο:${row.armokalipto||"-"} | ${row.type||""} | Ρολό:${row.roller||"-"} | Σίτα:${row.screen||"-"} | ${row.notes||""}`),
    project.generalNotes ? `\nΓΕΝΙΚΕΣ ΠΑΡΑΤΗΡΗΣΕΙΣ\n${project.generalNotes}` : "",
    project.special ? `\nΕΙΔΙΚΕΣ ΚΑΤΑΣΚΕΥΕΣ\n${project.special}` : ""
  ].filter(Boolean).join("\n");
}
function reportValue(value) {
  return escapeHtml(String(value || "").trim() || "—");
}
function reportDetails(title, rows) {
  const filled = rows.filter(([,value]) => String(value || "").trim());
  if (!filled.length) return "";
  return `<section class="pdf-section"><h2>${escapeHtml(title)}</h2><table class="pdf-details"><tbody>${
    filled.map(([label,value]) => `<tr><th>${escapeHtml(label)}</th><td>${reportValue(value)}</td></tr>`).join("")
  }</tbody></table></section>`;
}
function buildPdfReport() {
  const project = collectProject();
  const rows = project.windows.filter(row => Object.values(row).some(value => String(value).trim()));
  const extra = project.extra || {};
  const report = document.createElement("div");
  report.className = "pdf-report";
  report.innerHTML = `
    <style>
      .pdf-report{width:1080px;background:#fff;color:#172033;font:16px Arial,sans-serif;padding:32px}
      .pdf-report *{box-sizing:border-box}.pdf-head{display:flex;align-items:center;justify-content:space-between;border-bottom:5px solid #0b3a78;padding-bottom:16px;margin-bottom:18px}
      .pdf-head img{max-width:240px;max-height:82px;object-fit:contain}.pdf-title{text-align:right}.pdf-title h1{margin:0;color:#0b3a78;font-size:28px}.pdf-title p{margin:6px 0 0;font-size:17px}
      .pdf-info{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px;background:#edf4fc;border:1px solid #c8d9ec;border-radius:10px;padding:15px;margin-bottom:18px}
      .pdf-info div{min-height:42px}.pdf-info b{display:block;color:#0b3a78;font-size:13px;margin-bottom:4px}
      .pdf-section{margin-top:18px;break-inside:avoid}.pdf-section h2{margin:0 0 8px;background:#0b3a78;color:#fff;padding:8px 11px;font-size:19px}
      .pdf-table,.pdf-details{width:100%;border-collapse:collapse;font-size:13px}.pdf-table th,.pdf-table td,.pdf-details th,.pdf-details td{border:1px solid #9eabb9;padding:6px;vertical-align:top}
      .pdf-table th,.pdf-details th{background:#e8eef5;color:#0b3a78;font-weight:700}.pdf-details th{width:28%;text-align:left}.pdf-notes{white-space:pre-wrap;border:1px solid #9eabb9;padding:12px;min-height:52px}
      .pdf-photos{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pdf-photos figure{margin:0;break-inside:avoid}.pdf-photos img{width:100%;max-height:430px;object-fit:contain;border:1px solid #9eabb9}
      .pdf-footer{margin-top:22px;padding-top:9px;border-top:1px solid #9eabb9;color:#667085;font-size:12px;text-align:right}
    </style>
    <header class="pdf-head">
      <img src="logo.png" alt="ANASTASIOU O.E.">
      <div class="pdf-title"><h1>ΔΕΛΤΙΟ ΜΕΤΡΗΣΕΩΝ</h1><p>Έργο ${reportValue(project.projectNo)}</p></div>
    </header>
    <div class="pdf-info">
      <div><b>Ημερομηνία</b>${reportValue(project.date)}</div><div><b>Στάδιο</b>${reportValue(stageName(project.stage))}</div><div><b>Ανάθεση σε</b>${reportValue(project.assignee)}</div>
      <div><b>Πελάτης</b>${reportValue(project.customer)}</div><div><b>Τηλέφωνο</b>${reportValue(project.phone)}</div><div><b>Email</b>${reportValue(project.customerEmail)}</div>
      <div><b>Διεύθυνση</b>${reportValue(project.address)}</div><div><b>ΑΦΜ</b>${reportValue(project.afm)}</div><div><b>ΔΟΥ</b>${reportValue(project.doy)}</div>
      <div><b>Υπεύθυνος μέτρησης</b>${reportValue(project.measurer)}</div><div><b>GPS</b>${reportValue(project.gps)}</div><div><b>Ενημέρωση από</b>${reportValue(project.updatedBy)}</div>
    </div>
    ${rows.length ? `<section class="pdf-section"><h2>Κουφώματα</h2><table class="pdf-table"><thead><tr><th>Α/Α</th><th>Χώρος</th><th>Ύψος</th><th>Φάρδος</th><th>Λάμπας</th><th>Αρμοκάλυπτο</th><th>Τύπος</th><th>Ρολό</th><th>Σίτα</th><th>Παρατηρήσεις</th></tr></thead><tbody>${
      rows.map((row,index) => `<tr><td>${index+1}</td><td>${reportValue(row.room)}</td><td>${reportValue(row.height)}</td><td>${reportValue(row.width)}</td><td>${reportValue(row.lampas)}</td><td>${reportValue(row.armokalipto)}</td><td>${reportValue(row.type)}</td><td>${reportValue(row.roller)}</td><td>${reportValue(row.screen)}</td><td>${reportValue(row.notes)}</td></tr>`).join("")
    }</tbody></table></section>` : ""}
    ${reportDetails("Πέργκολα", [["Τύπος",extra.pergolaType],["Μήκος",extra.pergolaLength],["Πλάτος",extra.pergolaWidth],["Ύψος",extra.pergolaHeight],["Κάλυψη",extra.pergolaCover],["Χρώμα",extra.pergolaColor],["Φωτισμός LED",extra.pergolaLed],["Παρατηρήσεις",extra.pergolaNotes]])}
    ${reportDetails("Κάγκελα", [["Τύπος",extra.railType],["Συνολικό μήκος",extra.railLength],["Ύψος",extra.railHeight],["Υλικό",extra.railMaterial],["Χρώμα",extra.railColor],["Τζάμι",extra.railGlass],["Σχέδιο",extra.railDesign],["Παρατηρήσεις",extra.railNotes]])}
    ${reportDetails("Μεσόπορτες", [["Ποσότητα",extra.doorQuantity],["Ύψος",extra.doorHeight],["Φάρδος",extra.doorWidth],["Διαστάσεις",extra.doorDimensions],["Λάμπας",extra.doorLampas],["Τύπος / Μοντέλο",extra.doorType],["Χρώμα",extra.doorColor],["Φορά ανοίγματος",extra.doorDirection],["Κάσα",extra.doorFrame],["Παρατηρήσεις",extra.doorNotes]])}
    ${project.special ? `<section class="pdf-section"><h2>Ειδικές κατασκευές</h2><div class="pdf-notes">${escapeHtml(project.special)}</div></section>` : ""}
    ${reportDetails("Υλικά έργου", [["Προφίλ / Εταιρεία",extra.materialProfile],["Σύστημα",extra.materialSystem],["Χρώμα",extra.materialColor],["Τζάμι",extra.materialGlass],["Σίτες",extra.materialScreens],["Ρολά / Παντζούρια",extra.materialRollers],["Μηχανισμοί",extra.materialHardware],["Λοιπά υλικά",extra.materialOther]])}
    ${project.generalNotes ? `<section class="pdf-section"><h2>Γενικές παρατηρήσεις</h2><div class="pdf-notes">${escapeHtml(project.generalNotes)}</div></section>` : ""}
    ${photos.length ? `<section class="pdf-section"><h2>Φωτογραφίες έργου</h2><div class="pdf-photos">${photos.map((src,index) => `<figure><img src="${src}" alt="Φωτογραφία ${index+1}"></figure>`).join("")}</div></section>` : ""}
    <footer class="pdf-footer">ANASTASIOU O.E. • Δημιουργήθηκε ${new Date().toLocaleString("el-GR")}</footer>`;
  report.style.position = "fixed";
  report.style.left = "-12000px";
  report.style.top = "0";
  document.body.appendChild(report);
  return {report, project};
}
async function shareProject() {
  if (!window.html2pdf) {
    alert("Δεν φορτώθηκε η δημιουργία PDF. Έλεγξε τη σύνδεση στο Internet και δοκίμασε ξανά.");
    return;
  }
  const button = $("#shareBtn");
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "⏳ Δημιουργία PDF…";
  const {report, project} = buildPdfReport();
  const safeNumber = String(project.projectNo || "ΝΕΟ-ΕΡΓΟ").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const filename = `ANASTASIOU_${safeNumber}.pdf`;
  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    const blob = await window.html2pdf().set({
      margin:[7,7,7,7],
      filename,
      image:{type:"jpeg",quality:.94},
      html2canvas:{scale:1.45,useCORS:true,backgroundColor:"#ffffff"},
      jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},
      pagebreak:{mode:["css","legacy"],avoid:["tr","figure",".pdf-info"]}
    }).from(report).outputPdf("blob");
    const file = new File([blob], filename, {type:"application/pdf"});
    const savePdf = () => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    };
    if (navigator.canShare?.({files:[file]})) {
      try {
        await navigator.share({files:[file],title:`Μετρήσεις ${project.projectNo || ""}`,text:`ANASTASIOU O.E. — ${project.customer || "Έργο"}`});
      } catch (shareError) {
        if (shareError?.name === "AbortError") return;
        savePdf();
        alert("Το PDF αποθηκεύτηκε. Άνοιξέ το από τα Αρχεία για να το στείλεις.");
      }
    } else {
      savePdf();
      alert("Το PDF αποθηκεύτηκε. Μπορείς να το στείλεις από τα Αρχεία.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") alert("Δεν δημιουργήθηκε το PDF. Δοκίμασε ξανά ή χρησιμοποίησε το κουμπί PDF / Εκτύπωση.");
  } finally {
    report.remove();
    button.disabled = false;
    button.textContent = oldText;
  }
}
function renderPhotos() {
  const gallery = $("#photos");
  gallery.innerHTML = "";
  photos.forEach((src,index) => {
    const item = document.createElement("div");
    item.className = "photo";
    item.innerHTML = `<img src="${src}" alt="Φωτογραφία έργου"><button class="danger">×</button>`;
    item.querySelector("button").onclick = () => { photos.splice(index,1); renderPhotos(); };
    gallery.appendChild(item);
  });
}
function compressPhoto(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(image.width,image.height));
        const canvas = document.createElement("canvas");
        canvas.width = image.width * scale;
        canvas.height = image.height * scale;
        canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg",.72));
      };
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function download(name,text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text],{type:"application/json"}));
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

try {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  enableIndexedDbPersistence(db).catch(() => {});
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    if (user) {
      offlineMode = false;
      showApp();
      try { await uploadUnsyncedLocal(); } catch {}
      subscribeToProjects();
    } else if (!offlineMode) {
      $("#login").classList.remove("hidden");
      $("#app").classList.add("hidden");
      $("#bottomBar").classList.add("hidden");
    }
  });
} catch {
  $("#loginMessage").textContent = "Δεν φορτώθηκε το Firebase. Μπορείς να συνεχίσεις χωρίς σύνδεση.";
}

$("#loginBtn").onclick = async () => {
  try {
    $("#loginMessage").textContent = "Σύνδεση…";
    await signInWithEmailAndPassword(auth,$("#loginEmail").value.trim(),$("#loginPassword").value);
    $("#loginMessage").textContent = "";
  } catch { $("#loginMessage").textContent = "Αποτυχία σύνδεσης. Έλεγξε email και κωδικό."; }
};
$("#offlineBtn").onclick = () => { offlineMode=true; setSync("📴 Τοπική λειτουργία"); showApp(); };
$("#logoutBtn").onclick = () => signOut(auth);
$("#newBtn").onclick = async () => {
  clearForm();
  await assignNextProjectNumber();
};
$$("[data-go]").forEach(button => button.onclick = () => { location.hash = `#${button.dataset.go}`; });
$$(".stat").forEach(card => card.onclick = () => { $("#stageFilter").value=card.dataset.stage; renderProjects(); location.hash="#projectListCard"; });
$("#addRow").onclick = () => addRows(1);
$("#add5").onclick = () => addRows(5);
$("#clearRows").onclick = () => { if(confirm("Να καθαριστούν όλες οι γραμμές κουφωμάτων;")) { $("#windows").innerHTML=""; addRows(20); } };
$("#saveBtn").onclick = () => saveProject();
$("#shareBtn").onclick = shareProject;
$("#printBtn").onclick = () => window.print();
$("#search").oninput = renderProjects;
$("#stageFilter").onchange = renderProjects;
$("#customerSearch").oninput = renderCustomers;
$("#gpsBtn").onclick = () => navigator.geolocation?.getCurrentPosition(
  position => $("#gps").value = `${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`,
  () => alert("Δεν δόθηκε πρόσβαση στην τοποθεσία."),
  {enableHighAccuracy:true,timeout:15000}
);
$("#mapsBtn").onclick = () => {
  const destination = $("#gps").value || $("#address").value;
  if (destination) location.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
};
$("#callBtn").onclick = () => { if ($("#phone").value) location.href = `tel:${$("#phone").value.replace(/\s/g,"")}`; };
$("#handoffBtn").onclick = () => {
  $("#stage").value = "final";
  $("#assignee").value = "Γιώργος";
  saveProject(false,"Παράδοση για τελική μέτρηση");
};
$("#activeUser").onchange = () => localStorage.setItem(`${KEY}_ACTIVE_USER`,$("#activeUser").value);
$("#photoInput").onchange = async event => {
  for (const file of event.target.files) try { photos.push(await compressPhoto(file)); } catch {}
  renderPhotos();
  event.target.value = "";
};
$("#clearPhotosBtn").onclick = () => { if (!photos.length || confirm("Να διαγραφούν όλες οι φωτογραφίες αυτού του έργου;")) { photos=[]; renderPhotos(); } };
$("#exportBtn").onclick = () => {
  download(`ANASTASIOU_BACKUP_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({version:"5.3",exportedAt:new Date().toISOString(),projects},null,2));
  $("#backupStatus").textContent = "Το backup δημιουργήθηκε.";
};
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const parsed = JSON.parse(await file.text());
    const incoming = extractLegacyProjects(parsed).map(migrateProject);
    if (!incoming.length) throw new Error();
    const merged = new Map(projects.map(project => [project.id,project]));
    incoming.forEach(project => merged.set(project.id,project));
    projects = [...merged.values()];
    writeLocal(projects);
    renderAll();
    if (currentUser && !offlineMode) {
      setSync("⏳ Συγχρονισμός backup…");
      for (const project of incoming) await setDoc(doc(db,"projects",project.id),{...project,serverUpdatedAt:serverTimestamp()},{merge:true});
      setSync("☁️ Συγχρονίστηκε","ok");
    }
    $("#backupStatus").textContent = `Εισήχθησαν ${incoming.length} έργα.`;
  } catch { $("#backupStatus").textContent = "Το αρχείο backup δεν είναι έγκυρο."; }
  event.target.value = "";
};

$("#app").addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if ($("#id").value || $("#projectNo").value || $("#customer").value) saveProject(true);
  }, 1500);
});
window.addEventListener("online", () => { if (currentUser) { setSync("⏳ Επανασύνδεση…"); subscribeToProjects(); } });
window.addEventListener("offline", () => setSync("📴 Χωρίς σύνδεση","bad"));
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
