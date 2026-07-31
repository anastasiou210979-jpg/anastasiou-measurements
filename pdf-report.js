(function () {
  "use strict";

  const PAGE_W = 1600, PAGE_H = 1131, MARGIN = 62;
  const BLUE = "#0b3a78", LIGHT = "#eaf2fb", TEXT = "#172033", BORDER = "#9eabb9";
  const display = value => String(value == null || value === "" ? "—" : value);

  function makePage() {
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_W; canvas.height = PAGE_H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = "top"; ctx.fillStyle = TEXT;
    return { canvas, ctx, y: MARGIN };
  }
  function font(ctx, size, bold = false) {
    ctx.font = `${bold ? "700" : "400"} ${size}px Arial, Helvetica, sans-serif`;
  }
  function wrap(ctx, value, maxWidth) {
    const words = display(value).split(/\s+/), lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["—"];
  }
  function drawText(ctx, value, x, y, width, size = 21, bold = false, color = TEXT, lineHeight = 27) {
    font(ctx, size, bold); ctx.fillStyle = color;
    const lines = wrap(ctx, value, width);
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
    return lines.length * lineHeight;
  }
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }
  function continuedPage(pages, heading) {
    const page = makePage(); pages.push(page);
    drawText(page.ctx, "ANASTASIOU O.E.", MARGIN, MARGIN, 520, 25, true, BLUE, 31);
    drawText(page.ctx, heading, PAGE_W - 720, MARGIN, 658, 23, true, BLUE, 29);
    page.ctx.strokeStyle = BLUE; page.ctx.lineWidth = 4; page.ctx.beginPath();
    page.ctx.moveTo(MARGIN, 108); page.ctx.lineTo(PAGE_W - MARGIN, 108); page.ctx.stroke();
    page.y = 132; return page;
  }
  function ensure(pages, page, needed, heading) {
    return page.y + needed > PAGE_H - MARGIN ? continuedPage(pages, heading) : page;
  }
  function section(page, title) {
    page.ctx.fillStyle = BLUE; page.ctx.fillRect(MARGIN, page.y, PAGE_W - MARGIN * 2, 48);
    drawText(page.ctx, title, MARGIN + 16, page.y + 10, PAGE_W - MARGIN * 2 - 32, 24, true, "#fff", 29);
    page.y += 58;
  }
  function infoGrid(page, entries) {
    const cols = 3, gap = 14, rowHeight = 100;
    const width = (PAGE_W - MARGIN * 2 - gap * 2) / cols;
    entries.forEach(([label, value], index) => {
      const col = index % cols, row = Math.floor(index / cols);
      const x = MARGIN + col * (width + gap), y = page.y + row * (rowHeight + gap);
      page.ctx.fillStyle = LIGHT; page.ctx.fillRect(x, y, width, rowHeight);
      page.ctx.strokeStyle = "#c8d9ec"; page.ctx.strokeRect(x, y, width, rowHeight);
      drawText(page.ctx, label, x + 13, y + 11, width - 26, 17, true, BLUE, 21);
      drawText(page.ctx, value, x + 13, y + 40, width - 26, 21, false, TEXT, 26);
    });
    page.y += Math.ceil(entries.length / cols) * (rowHeight + gap);
  }
  function rowHeight(ctx, cells, widths, size = 17, padding = 8) {
    font(ctx, size); let lines = 1;
    cells.forEach((cell, i) => { lines = Math.max(lines, wrap(ctx, cell, widths[i] - padding * 2).length); });
    return Math.max(45, lines * (size + 7) + padding * 2);
  }
  function tableHeader(page, headers, widths) {
    const height = rowHeight(page.ctx, headers, widths); let x = MARGIN;
    headers.forEach((header, i) => {
      page.ctx.fillStyle = LIGHT; page.ctx.fillRect(x, page.y, widths[i], height);
      page.ctx.strokeStyle = BORDER; page.ctx.strokeRect(x, page.y, widths[i], height);
      drawText(page.ctx, header, x + 8, page.y + 8, widths[i] - 16, 17, true, BLUE, 23);
      x += widths[i];
    });
    page.y += height;
  }
  function table(pages, page, title, headers, rows, widths, heading) {
    page = ensure(pages, page, 130, heading); section(page, title); tableHeader(page, headers, widths);
    for (const row of rows) {
      const height = rowHeight(page.ctx, row, widths);
      if (page.y + height > PAGE_H - MARGIN) {
        page = continuedPage(pages, heading); section(page, `${title} (συνέχεια)`); tableHeader(page, headers, widths);
      }
      let x = MARGIN;
      row.forEach((cell, i) => {
        page.ctx.fillStyle = "#fff"; page.ctx.fillRect(x, page.y, widths[i], height);
        page.ctx.strokeStyle = BORDER; page.ctx.strokeRect(x, page.y, widths[i], height);
        drawText(page.ctx, cell, x + 8, page.y + 8, widths[i] - 16, 17, false, TEXT, 23);
        x += widths[i];
      });
      page.y += height;
    }
    page.y += 18; return page;
  }
  function details(pages, page, title, entries, heading) {
    const filled = entries.filter(([, value]) => String(value || "").trim());
    if (!filled.length) return page;
    return table(pages, page, title, ["Πεδίο", "Στοιχεία"], filled.map(([a, b]) => [a, display(b)]),
      [390, PAGE_W - MARGIN * 2 - 390], heading);
  }
  function longText(pages, page, title, value, heading) {
    if (!String(value || "").trim()) return page;
    font(page.ctx, 21); const lines = wrap(page.ctx, value, PAGE_W - MARGIN * 2 - 28);
    for (let start = 0; start < lines.length; start += 30) {
      const chunk = lines.slice(start, start + 30);
      page = ensure(pages, page, 120 + chunk.length * 28, heading);
      section(page, start ? `${title} (συνέχεια)` : title);
      const height = Math.max(68, chunk.length * 28 + 24);
      page.ctx.strokeStyle = BORDER; page.ctx.strokeRect(MARGIN, page.y, PAGE_W - MARGIN * 2, height);
      chunk.forEach((line, i) => drawText(page.ctx, line, MARGIN + 14, page.y + 12 + i * 28,
        PAGE_W - MARGIN * 2 - 28, 21, false, TEXT, 28));
      page.y += height + 18;
    }
    return page;
  }
  async function photoPages(pages, page, sources, heading) {
    const images = (await Promise.all((sources || []).map(loadImage))).filter(Boolean);
    if (!images.length) return page;
    page = continuedPage(pages, heading); section(page, "Φωτογραφίες έργου");
    const gap = 22, width = (PAGE_W - MARGIN * 2 - gap) / 2, height = 410;
    images.forEach((image, index) => {
      if (index && index % 4 === 0) { page = continuedPage(pages, heading); section(page, "Φωτογραφίες έργου (συνέχεια)"); }
      const position = index % 4, col = position % 2, row = Math.floor(position / 2);
      const x = MARGIN + col * (width + gap), y = page.y + row * (height + gap);
      page.ctx.strokeStyle = BORDER; page.ctx.strokeRect(x, y, width, height);
      const ratio = Math.min((width - 16) / image.width, (height - 16) / image.height);
      const drawW = image.width * ratio, drawH = image.height * ratio;
      page.ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
      if (position === 3 || index === images.length - 1) page.y = y + height + 18;
    });
    return page;
  }

  async function createProjectPdfBlob(project, photos, stageLabel) {
    const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
    if (!JsPDF) throw new Error("PDF library unavailable");
    const pages = [], first = makePage(); pages.push(first);
    let page = first;
    const logo = await loadImage("logo.png");
    if (logo) {
      const ratio = Math.min(330 / logo.width, 105 / logo.height);
      page.ctx.drawImage(logo, MARGIN, MARGIN, logo.width * ratio, logo.height * ratio);
    } else drawText(page.ctx, "ANASTASIOU O.E.", MARGIN, MARGIN + 18, 460, 31, true, BLUE, 38);
    drawText(page.ctx, "ΔΕΛΤΙΟ ΜΕΤΡΗΣΕΩΝ", PAGE_W - 650, MARGIN + 8, 588, 34, true, BLUE, 42);
    drawText(page.ctx, `Έργο ${display(project.projectNo)}`, PAGE_W - 650, MARGIN + 54, 588, 24, true);
    page.ctx.strokeStyle = BLUE; page.ctx.lineWidth = 5; page.ctx.beginPath();
    page.ctx.moveTo(MARGIN, 190); page.ctx.lineTo(PAGE_W - MARGIN, 190); page.ctx.stroke(); page.y = 222;
    const heading = `Έργο ${display(project.projectNo)} • ${display(project.customer)}`;
    infoGrid(page, [
      ["Ημερομηνία",project.date],["Κατάσταση",stageLabel],["Ανάθεση σε",project.assignee],
      ["Πελάτης",project.customer],["Τηλέφωνο",project.phone],["Email",project.customerEmail],
      ["Διεύθυνση",project.address],["ΑΦΜ",project.afm],["ΔΟΥ",project.doy],
      ["Υπεύθυνος μέτρησης",project.measurer],["GPS",project.gps],["Ενημέρωση από",project.updatedBy]
    ]);
    const windows = (project.windows || []).filter(row => Object.values(row).some(value => String(value || "").trim()));
    if (windows.length) {
      page = table(pages, page, "Κουφώματα",
        ["Α/Α","Χώρος","Ύψος","Φάρδος","Λάμπας","Αρμοκάλυπτο","Τύπος","Ρολό","Σίτα","Παρατηρήσεις"],
        windows.map((row, i) => [i+1,row.room,row.height,row.width,row.lampas,row.armokalipto,row.type,row.roller,row.screen,row.notes].map(display)),
        [55,130,100,100,105,140,210,95,95,440], heading);
    }
    const e = project.extra || {};
    page = details(pages,page,"Πέργκολα",[["Τύπος",e.pergolaType],["Μήκος",e.pergolaLength],["Πλάτος",e.pergolaWidth],["Ύψος",e.pergolaHeight],["Κάλυψη",e.pergolaCover],["Χρώμα",e.pergolaColor],["Φωτισμός LED",e.pergolaLed],["Παρατηρήσεις",e.pergolaNotes]],heading);
    page = details(pages,page,"Κάγκελα",[["Τύπος",e.railType],["Συνολικό μήκος",e.railLength],["Ύψος",e.railHeight],["Υλικό",e.railMaterial],["Χρώμα",e.railColor],["Τζάμι",e.railGlass],["Σχέδιο",e.railDesign],["Παρατηρήσεις",e.railNotes]],heading);
    page = details(pages,page,"Μεσόπορτες",[["Ποσότητα",e.doorQuantity],["Ύψος",e.doorHeight],["Φάρδος",e.doorWidth],["Διαστάσεις",e.doorDimensions],["Λάμπας",e.doorLampas],["Τύπος / Μοντέλο",e.doorType],["Χρώμα",e.doorColor],["Φορά ανοίγματος",e.doorDirection],["Κάσα",e.doorFrame],["Παρατηρήσεις",e.doorNotes]],heading);
    page = longText(pages,page,"Ειδικές κατασκευές",project.special,heading);
    page = details(pages,page,"Υλικά έργου",[
      ["1. Τζαμιλίκια – Χρώμα",e.glassFramesColor],
      ["2. Εξώφυλλα – Χρώμα",e.shuttersColor],
      ["3. Πόρτες – Χρώμα",e.doorsColor],
      ["3. Πόρτες – Σχέδιο",e.doorsDesign],
      ["4. Τζάμια",e.glassType],
      ["5. Τύπος σίτας",e.screenType],
      ["6. Ρολά – Χρώμα",e.rollersColor],
      ["6. Ρολά – Τύπος",e.rollersType],
      ["7. Ρολοκουρτίνες",e.rollerBlinds],
      ["8. Λοιπά υλικά",e.materialOther]
    ],heading);
    page = longText(pages,page,"Γενικές παρατηρήσεις",project.generalNotes,heading);
    await photoPages(pages,page,photos,heading);
    pages.forEach((item,index) => {
      item.ctx.strokeStyle="#d5dbe3"; item.ctx.beginPath(); item.ctx.moveTo(MARGIN,PAGE_H-48);
      item.ctx.lineTo(PAGE_W-MARGIN,PAGE_H-48); item.ctx.stroke();
      drawText(item.ctx,`ANASTASIOU O.E. • Σελίδα ${index+1} από ${pages.length}`,MARGIN,PAGE_H-38,700,16,false,"#667085",20);
    });
    const doc = new JsPDF({orientation:"landscape",unit:"pt",format:"a4",compress:true});
    pages.forEach((item,index) => {
      if (index) doc.addPage("a4","landscape");
      doc.addImage(item.canvas.toDataURL("image/jpeg",.9),"JPEG",0,0,841.89,595.28,undefined,"FAST");
    });
    return doc.output("blob");
  }
  window.createProjectPdfBlob = createProjectPdfBlob;
})();
