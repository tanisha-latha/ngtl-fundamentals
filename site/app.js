/* Reads the JSON snapshots written by analysis/export_snapshot.py and
 * renders the page. No live network calls to the source endpoints happen
 * here -- the site only ever reads what the pipeline already computed.
 */
(function () {
  "use strict";

  const ZONE_ORDER = ["USJR", "AB/BC", "EGAT", "OSDA"];
  const ZONE_COLORS = { "USJR": "#B5502D", "AB/BC": "#2F6690", "EGAT": "#1C2B3A", "OSDA": "#5B6B3D" };
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function utilizationColor(pct) {
    if (pct === null || pct === undefined || Number.isNaN(pct)) return "var(--cell-empty)";
    if (pct > 100) return "var(--ramp-over)";
    if (pct >= 90) return "var(--ramp-4)";
    if (pct >= 70) return "var(--ramp-3)";
    if (pct >= 50) return "var(--ramp-2)";
    if (pct >= 25) return "var(--ramp-1)";
    return "var(--ramp-0)";
  }

  function fmtInt(n) {
    if (n === null || n === undefined) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function fmtPct(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return n.toFixed(digits) + "%";
  }

  function monthLabel(year, month) {
    return `${MONTH_ABBR[month - 1]} ${String(year).slice(2)}`;
  }

  async function loadJSON(path) {
    // no-store: these snapshots update daily, so a returning visitor should
    // never see a browser-cached, out-of-date one.
    const resp = await fetch(path, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${path}: ${resp.status}`);
    return resp.json();
  }

  // ---- Schematic system map ----

  const MAP_ZONE_LABELS = {
    "AB/BC": "Alberta/BC & Alberta/Montana borders",
    "EGAT": "Empress/McNeill borders",
    "OSDA": "Other Alberta sales deliveries",
  };

  function renderSystemMap(heatmap) {
    const svg = document.getElementById("system-map");
    const latestDay = heatmap.date_range.end;
    const latest = {};
    for (const c of heatmap.cells) if (c.gas_day === latestDay) latest[c.zone] = c.utilization_pct;

    const width = 640, height = 220;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", height);
    svg.setAttribute("preserveAspectRatio", "xMinYMid meet");

    const sourceBox = { x: 20, y: 80, w: 150, h: 60 };
    const destZones = ["AB/BC", "EGAT", "OSDA"];
    const destBoxes = destZones.map((z, i) => ({
      zone: z,
      x: 420, y: 20 + i * 70, w: 200, h: 52,
    }));

    const parts = [];
    // source box (USJR)
    const usjrColor = utilizationColorHex(latest["USJR"]);
    parts.push(rectWithLabel(sourceBox, "USJR", "System receipts", usjrColor));

    for (const box of destBoxes) {
      const midY = box.y + box.h / 2;
      const startX = sourceBox.x + sourceBox.w;
      const startY = sourceBox.y + sourceBox.h / 2;
      parts.push(`<path d="M ${startX} ${startY} C ${startX + 100} ${startY}, ${box.x - 80} ${midY}, ${box.x} ${midY}" fill="none" stroke="#b8a878" stroke-width="1.5" marker-end="url(#arrow)"/>`);
      const color = utilizationColorHex(latest[box.zone]);
      parts.push(rectWithLabel(box, box.zone, MAP_ZONE_LABELS[box.zone], color));
    }

    const defs = `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#b8a878"/></marker></defs>`;

    svg.innerHTML = defs + parts.join("");

    function rectWithLabel(box, title, subtitle, color) {
      const textColor = isDarkFill(color) ? "#F1E9D8" : "#1C2B3A";
      const utilVal = latest[title];
      const utilText = utilVal !== undefined ? `${utilVal.toFixed(1)}%` : "no data";
      return `
        <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${color}" rx="2"/>
        <text x="${box.x + 10}" y="${box.y + 20}" font-family="Roboto Slab, Georgia, serif" font-weight="700" font-size="13" fill="${textColor}">${title}</text>
        <text x="${box.x + 10}" y="${box.y + 34}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${textColor}">${utilText}</text>
        <text x="${box.x + 10}" y="${box.y + box.h - 8}" font-family="Source Sans 3, sans-serif" font-size="10" fill="${textColor}">${subtitle}</text>
      `;
    }
  }

  function isDarkFill(hex) {
    return hex === "#1C2B3A" || hex === "#7a3319" || hex === "#A9491F";
  }

  function utilizationColorHex(pct) {
    if (pct === null || pct === undefined || Number.isNaN(pct)) return "#e6dcc0";
    if (pct > 100) return "#1C2B3A";
    if (pct >= 90) return "#7a3319";
    if (pct >= 70) return "#A9491F";
    if (pct >= 50) return "#C98A3E";
    if (pct >= 25) return "#DEC98A";
    return "#EDE3CC";
  }

  // ---- Utilization trend (7-day rolling average) ----

  function rollingAverage(sortedCells, windowSize) {
    const result = [];
    const window = [];
    let sum = 0;
    for (const c of sortedCells) {
      window.push(c.utilization_pct);
      sum += c.utilization_pct;
      if (window.length > windowSize) sum -= window.shift();
      result.push({ gas_day: c.gas_day, avg: sum / window.length });
    }
    return result;
  }

  function renderTrendChart(heatmap) {
    const svg = document.getElementById("trend-chart");
    const zonesPresent = ZONE_ORDER.filter((z) => heatmap.zones.includes(z));

    const byZone = {};
    for (const z of zonesPresent) byZone[z] = [];
    for (const c of heatmap.cells) if (byZone[c.zone]) byZone[c.zone].push(c);
    for (const z of zonesPresent) byZone[z].sort((a, b) => (a.gas_day < b.gas_day ? -1 : 1));

    const rolling = {};
    for (const z of zonesPresent) rolling[z] = rollingAverage(byZone[z], 7);

    const dateAxis = Array.from(new Set(heatmap.cells.map((c) => c.gas_day))).sort();
    const dateIndex = {};
    dateAxis.forEach((d, i) => (dateIndex[d] = i));

    const width = 900, chartHeight = 220;
    const marginLeft = 42, marginRight = 16, marginTop = 16, marginBottom = 24;
    const innerWidth = width - marginLeft - marginRight;
    const totalHeight = chartHeight + marginTop + marginBottom;
    svg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("preserveAspectRatio", "none");

    const allValues = zonesPresent.flatMap((z) => rolling[z].map((r) => r.avg));
    const maxVal = Math.max(105, ...allValues) * 1.02;

    const xAt = (i) => marginLeft + (dateAxis.length > 1 ? (i / (dateAxis.length - 1)) * innerWidth : 0);
    const yAt = (v) => marginTop + chartHeight - (v / maxVal) * chartHeight;

    const parts = [];
    parts.push(`<line x1="${marginLeft}" y1="${yAt(100).toFixed(1)}" x2="${width - marginRight}" y2="${yAt(100).toFixed(1)}" stroke="#d8cba8" stroke-width="1" stroke-dasharray="3,3"/>`);
    parts.push(`<text x="${marginLeft - 6}" y="${(yAt(100) + 3).toFixed(1)}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="end">100%</text>`);
    parts.push(`<line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#d8cba8" stroke-width="1"/>`);

    const monthTicks = [];
    let lastMonthKey = null;
    dateAxis.forEach((day, i) => {
      const [yr, mo] = day.split("-");
      const key = `${yr}-${mo}`;
      if (key !== lastMonthKey) {
        lastMonthKey = key;
        monthTicks.push({ i, yr: Number(yr), mo: Number(mo) });
      }
    });
    const skip = monthTicks.length > 14 ? 2 : 1;
    monthTicks.forEach((t, idx) => {
      parts.push(`<line x1="${xAt(t.i).toFixed(1)}" y1="${marginTop}" x2="${xAt(t.i).toFixed(1)}" y2="${marginTop + chartHeight}" stroke="#e6dcc0" stroke-width="1"/>`);
      if (idx % skip === 0) {
        parts.push(`<text x="${xAt(t.i).toFixed(1)}" y="${marginTop + chartHeight + 15}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="middle">${monthLabel(t.yr, t.mo)}</text>`);
      }
    });

    for (const z of zonesPresent) {
      const points = rolling[z].map((r) => `${xAt(dateIndex[r.gas_day]).toFixed(1)},${yAt(r.avg).toFixed(1)}`).join(" ");
      parts.push(`<polyline points="${points}" fill="none" stroke="${ZONE_COLORS[z]}" stroke-width="1.75" stroke-linejoin="round"/>`);
    }

    svg.innerHTML = parts.join("");

    const legend = document.getElementById("trend-legend");
    legend.innerHTML = zonesPresent
      .map((z) => `<span><span class="swatch" style="background:${ZONE_COLORS[z]}"></span>${z}</span>`)
      .join("");
  }

  // ---- Heatmap ----

  function renderHeatmap(heatmap) {
    const grid = document.getElementById("heatmap-grid");

    const dateSet = new Set(heatmap.cells.map((c) => c.gas_day));
    const dateAxis = Array.from(dateSet).sort();

    const cellIndex = {};
    for (const zone of ZONE_ORDER) cellIndex[zone] = {};
    for (const c of heatmap.cells) {
      if (!cellIndex[c.zone]) cellIndex[c.zone] = {};
      cellIndex[c.zone][c.gas_day] = c;
    }

    // Month label row
    const monthRow = document.createElement("div");
    monthRow.className = "heatmap-month-row";
    let lastMonthKey = null;
    for (const day of dateAxis) {
      const [y, m] = day.split("-");
      const key = `${y}-${m}`;
      const slot = document.createElement("div");
      slot.style.width = "10px";
      slot.style.flex = "0 0 10px";
      if (key !== lastMonthKey) {
        slot.className = "month-label";
        slot.textContent = monthLabel(Number(y), Number(m));
        lastMonthKey = key;
      }
      monthRow.appendChild(slot);
    }
    grid.appendChild(monthRow);

    // Zone rows
    const zonesPresent = ZONE_ORDER.filter((z) => cellIndex[z] && Object.keys(cellIndex[z]).length);
    for (const zone of zonesPresent) {
      const row = document.createElement("div");
      row.className = "heatmap-row";

      const label = document.createElement("div");
      label.className = "zone-row-label";
      label.textContent = zone;
      row.appendChild(label);

      const track = document.createElement("div");
      track.className = "cell-track";

      for (const day of dateAxis) {
        const cellData = cellIndex[zone][day];
        const cell = document.createElement("div");
        cell.className = "hm-cell";
        if (cellData) {
          cell.style.background = utilizationColor(cellData.utilization_pct);
          if (cellData.outage_adjusted) cell.classList.add("has-outage");
          cell.dataset.zone = zone;
          cell.dataset.day = day;
          cell.dataset.pct = cellData.utilization_pct;
          cell.dataset.deviation = cellData.deviation_from_seasonal_normal_pct ?? "";
          cell.dataset.nPriorYears = cellData.n_prior_years ?? 0;
          cell.dataset.facilities = (cellData.facilities || []).join(", ");
        } else {
          cell.style.background = "var(--cell-empty)";
        }
        track.appendChild(cell);
      }
      row.appendChild(track);
      grid.appendChild(row);
    }

    // Legend
    const legend = document.getElementById("heatmap-legend");
    const buckets = [
      ["< 25%", "var(--ramp-0)"],
      ["25–50%", "var(--ramp-1)"],
      ["50–70%", "var(--ramp-2)"],
      ["70–90%", "var(--ramp-3)"],
      ["90–100%", "var(--ramp-4)"],
      ["> 100% (over capability)", "var(--ramp-over)"],
    ];
    legend.innerHTML =
      "<span>Utilization:</span> " +
      buckets.map(([label, color]) => `<span class="swatch" style="background:${color}"></span>${label}`).join(" ");

    // Tooltip via delegation
    const tooltip = document.getElementById("tooltip");
    grid.addEventListener("mousemove", (e) => {
      const cell = e.target.closest(".hm-cell");
      if (!cell || !cell.dataset.day) {
        tooltip.hidden = true;
        return;
      }
      const deviation = cell.dataset.deviation;
      const nPrior = Number(cell.dataset.nPriorYears);
      let deviationLine;
      if (deviation === "") {
        deviationLine = "vs. seasonal normal: insufficient prior-year history yet";
      } else {
        const sign = Number(deviation) >= 0 ? "+" : "";
        deviationLine = `vs. seasonal normal: ${sign}${Number(deviation).toFixed(1)}pp (n=${nPrior} prior yr${nPrior === 1 ? "" : "s"})`;
      }
      const facilitiesLine = cell.dataset.facilities ? `<br>Active: ${cell.dataset.facilities}` : "";
      tooltip.innerHTML = `<b>${cell.dataset.zone}</b> — ${cell.dataset.day}<br>${fmtPct(Number(cell.dataset.pct))} utilization<br>${deviationLine}${facilitiesLine}`;
      tooltip.style.left = e.clientX + 14 + "px";
      tooltip.style.top = e.clientY + 14 + "px";
      tooltip.hidden = false;
    });
    grid.addEventListener("mouseleave", () => { tooltip.hidden = true; });
  }

  // ---- Facility constraint log ----

  const FACILITY_ROWS_COLLAPSED = 12;

  function renderFacilities(facilitiesData) {
    const tbody = document.getElementById("facilities-tbody");
    const toggle = document.getElementById("facilities-toggle");
    const facilities = facilitiesData.facilities;

    if (!facilities.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No facilities recorded yet.</td></tr>`;
      toggle.hidden = true;
      return;
    }

    const rowHTML = (f) => `
      <tr>
        <td>${f.firm_risk_events > 0 ? '<span class="firm-dot" title="' + f.firm_risk_events + ' firm-risk event(s)"></span>' : ""}${f.facility}</td>
        <td class="num mono">${fmtInt(f.days_active)}</td>
        <td class="num impact-figure">${fmtInt(f.total_impact_e3m3d)}</td>
        <td>${f.zones.join(", ")}</td>
        <td class="mono">${f.first_seen} → ${f.last_seen}</td>
      </tr>`;

    let expanded = false;
    function draw() {
      const rows = expanded ? facilities : facilities.slice(0, FACILITY_ROWS_COLLAPSED);
      tbody.innerHTML = rows.map(rowHTML).join("");
      if (facilities.length > FACILITY_ROWS_COLLAPSED) {
        toggle.hidden = false;
        toggle.textContent = expanded
          ? "Show fewer ↑"
          : `Show all ${facilities.length} facilities ↓ (ranked by impact, top ${FACILITY_ROWS_COLLAPSED} shown)`;
      } else {
        toggle.hidden = true;
      }
    }
    toggle.onclick = () => { expanded = !expanded; draw(); };
    draw();
  }

  // ---- Firm vs. interruptible service impact ----

  function renderServiceImpact(serviceImpact) {
    const summary = document.getElementById("service-impact-summary");
    summary.innerHTML = `
      <div><span class="label">Firm-risk events</span><span class="big">${serviceImpact.firm_risk_events} / ${serviceImpact.total_events}</span></div>
      <div><span class="label">Share explicitly firm-risk</span><span class="big">${fmtPct(serviceImpact.firm_risk_share_pct)}</span></div>
    `;

    const zoneRows = serviceImpact.by_zone.filter((z) => z.firm_risk + z.no_firm_impact + z.unclassified > 0);
    document.getElementById("service-impact-zone-tbody").innerHTML = zoneRows
      .map(
        (z) => `
      <tr>
        <td class="mono">${z.zone_table}</td>
        <td class="num impact-figure">${z.firm_risk}</td>
        <td class="num mono">${z.no_firm_impact}</td>
        <td class="num mono">${z.unclassified}</td>
      </tr>`
      )
      .join("");

    const facilityRows = serviceImpact.facility_firm_risk_counts;
    const tbody = document.getElementById("firm-risk-facilities-tbody");
    if (!facilityRows.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-note">None yet.</td></tr>`;
    } else {
      tbody.innerHTML = facilityRows
        .slice(0, 10)
        .map(
          (f) => `
        <tr>
          <td>${f.facility}</td>
          <td class="num impact-figure">${f.firm_risk_events}</td>
          <td>${f.zones.join(", ")}</td>
        </tr>`
        )
        .join("");
    }
  }

  // ---- Monthly correlation ----

  function renderCorrelation(rollup) {
    const stat = document.getElementById("correlation-stat");
    stat.innerHTML = `
      <div><span class="label">Correlation (r)</span><span class="big">${rollup.correlation ?? "—"}</span></div>
      <div><span class="label">n (months)</span><span class="big">${rollup.n_months}</span></div>
      <div><span class="label">Statistically meaningful</span><span class="big">${rollup.statistically_meaningful ? "Yes" : "No"}</span></div>
    `;

    const caveat = document.getElementById("correlation-caveat");
    caveat.textContent = rollup.note;
    caveat.classList.toggle("meaningful", !!rollup.statistically_meaningful);

    const data = rollup.system_monthly;
    const svg = document.getElementById("correlation-chart");
    if (!data.length) {
      svg.outerHTML = '<p class="empty-note">No overlapping utilization/price months yet.</p>';
      return;
    }

    const monthWidth = 34;
    const chartHeight = 200;
    const marginLeft = 44, marginRight = 44, marginBottom = 22, marginTop = 14;
    const width = data.length * monthWidth + marginLeft + marginRight;
    const height = chartHeight + marginTop + marginBottom;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const maxUtil = Math.max(100, ...data.map((d) => d.avg_utilization_pct)) * 1.05;
    const maxPrice = Math.max(...data.map((d) => d.price_gj)) * 1.15;
    const yUtil = (v) => marginTop + chartHeight - (v / maxUtil) * chartHeight;
    const yPrice = (v) => marginTop + chartHeight - (v / maxPrice) * chartHeight;

    const parts = [];
    parts.push(`<line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#d8cba8" stroke-width="1"/>`);
    parts.push(`<line x1="${marginLeft}" y1="${yUtil(100)}" x2="${width - marginRight}" y2="${yUtil(100)}" stroke="#d8cba8" stroke-width="1" stroke-dasharray="2,3"/>`);
    parts.push(`<text x="${marginLeft - 6}" y="${yUtil(100) + 3}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="end">100%</text>`);

    data.forEach((d, i) => {
      const x = marginLeft + i * monthWidth;
      const barTop = yUtil(d.avg_utilization_pct);
      const barH = marginTop + chartHeight - barTop;
      parts.push(`<rect x="${x + 5}" y="${barTop}" width="${monthWidth - 10}" height="${barH}" fill="#A9491F" fill-opacity="0.55"/>`);
      if (data.length <= 14 || i % 2 === 0) {
        parts.push(`<text x="${x + monthWidth / 2}" y="${marginTop + chartHeight + 15}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="middle">${monthLabel(d.year, d.month)}</text>`);
      }
    });

    const linePoints = data.map((d, i) => `${marginLeft + i * monthWidth + monthWidth / 2},${yPrice(d.price_gj).toFixed(1)}`).join(" ");
    parts.push(`<polyline points="${linePoints}" fill="none" stroke="#2F6690" stroke-width="2"/>`);
    data.forEach((d, i) => {
      const cx = marginLeft + i * monthWidth + monthWidth / 2;
      parts.push(`<circle cx="${cx}" cy="${yPrice(d.price_gj).toFixed(1)}" r="2.5" fill="#2F6690"/>`);
      parts.push(`<title>${monthLabel(d.year, d.month)}: ${d.avg_utilization_pct.toFixed(1)}% util, $${d.price_gj.toFixed(2)}/GJ</title>`);
    });

    parts.push(`<text x="6" y="${marginTop - 2}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#A9491F">■ avg utilization %</text>`);
    parts.push(`<text x="${width - 6}" y="${marginTop - 2}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#2F6690" text-anchor="end">— AER price $/GJ</text>`);

    svg.innerHTML = parts.join("");
  }

  // ---- Seasonality (client-side aggregation from heatmap.cells) ----

  function renderSeasonalityChart(heatmap) {
    const svg = document.getElementById("seasonality-chart");
    const byMonth = Array.from({ length: 12 }, () => ({ sum: 0, n: 0, years: new Set() }));
    for (const c of heatmap.cells) {
      const [yr, mo] = c.gas_day.split("-");
      const m = Number(mo) - 1;
      byMonth[m].sum += c.utilization_pct;
      byMonth[m].n += 1;
      byMonth[m].years.add(yr);
    }
    const stats = byMonth.map((b, i) => ({
      month: i + 1,
      avg: b.n ? b.sum / b.n : null,
      nYears: b.years.size,
    }));

    const width = 620, chartHeight = 200;
    const marginLeft = 40, marginRight = 16, marginTop = 16, marginBottom = 26;
    const barSlot = (width - marginLeft - marginRight) / 12;
    const totalHeight = chartHeight + marginTop + marginBottom;
    svg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("preserveAspectRatio", "none");

    const maxVal = Math.max(105, ...stats.filter((s) => s.avg !== null).map((s) => s.avg)) * 1.02;
    const yAt = (v) => marginTop + chartHeight - (v / maxVal) * chartHeight;

    const parts = [];
    parts.push(`<line x1="${marginLeft}" y1="${yAt(100).toFixed(1)}" x2="${width - marginRight}" y2="${yAt(100).toFixed(1)}" stroke="#d8cba8" stroke-width="1" stroke-dasharray="3,3"/>`);
    parts.push(`<text x="${marginLeft - 6}" y="${(yAt(100) + 3).toFixed(1)}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="end">100%</text>`);
    parts.push(`<line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#d8cba8" stroke-width="1"/>`);

    stats.forEach((s, i) => {
      const x = marginLeft + i * barSlot;
      if (s.avg === null) return;
      const barTop = yAt(s.avg);
      const barH = marginTop + chartHeight - barTop;
      const color = s.nYears < 2 ? "#DEC98A" : "#A9491F";
      parts.push(`<rect x="${(x + barSlot * 0.15).toFixed(1)}" y="${barTop.toFixed(1)}" width="${(barSlot * 0.7).toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" fill-opacity="0.75"/>`);
      parts.push(`<title>${MONTH_ABBR[i]}: ${s.avg.toFixed(1)}% avg, n=${s.nYears} year${s.nYears === 1 ? "" : "s"}</title>`);
      parts.push(`<text x="${(x + barSlot / 2).toFixed(1)}" y="${marginTop + chartHeight + 15}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="middle">${MONTH_ABBR[i]}${s.nYears < 2 ? "*" : ""}</text>`);
    });

    parts.push(`<text x="${width - marginRight}" y="${marginTop - 3}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="end">* n=1 year</text>`);

    svg.innerHTML = parts.join("");
  }

  // ---- Firm/interruptible tariff rate comparison (static reference data) ----

  function renderTariffComparison(tariff) {
    const svg = document.getElementById("tariff-chart");
    const bars = [];
    const r = tariff.receipt;
    bars.push({ label: "FT-R", rate: r.find((x) => x.service === "FT-R").rate_cents_gj_d, pairIdx: 0 });
    bars.push({ label: "IT-R", rate: r.find((x) => x.service === "IT-R").rate_cents_gj_d, pairIdx: 0 });
    for (const g of ["Group 1", "Group 2"]) {
      const ft = tariff.delivery.find((x) => x.service === "FT-D" && x.group === g);
      const it = tariff.delivery.find((x) => x.service === "IT-D" && x.group === g);
      bars.push({ label: `FT-D ${g}`, rate: ft.rate_cents_gj_d, pairIdx: bars.length / 2 });
      bars.push({ label: `IT-D ${g}`, rate: it.rate_cents_gj_d, pairIdx: (bars.length - 1) / 2 });
    }
    const g3 = tariff.delivery.find((x) => x.group === "Group 3");
    bars.push({ label: "FT-D Group 3", rate: g3.rate_cents_gj_d, pairIdx: null });

    const width = 560, chartHeight = 190;
    const marginLeft = 34, marginRight = 12, marginTop = 14, marginBottom = 34;
    const slot = (width - marginLeft - marginRight) / bars.length;
    const totalHeight = chartHeight + marginTop + marginBottom;
    svg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("preserveAspectRatio", "none");

    const maxVal = Math.max(...bars.map((b) => b.rate)) * 1.15;
    const yAt = (v) => marginTop + chartHeight - (v / maxVal) * chartHeight;

    const parts = [];
    parts.push(`<line x1="${marginLeft}" y1="${marginTop + chartHeight}" x2="${width - marginRight}" y2="${marginTop + chartHeight}" stroke="#d8cba8" stroke-width="1"/>`);

    bars.forEach((b, i) => {
      const x = marginLeft + i * slot;
      const barTop = yAt(b.rate);
      const barH = marginTop + chartHeight - barTop;
      const isIT = b.label.startsWith("IT");
      const color = isIT ? "#B5502D" : "#2F6690";
      parts.push(`<rect x="${(x + slot * 0.12).toFixed(1)}" y="${barTop.toFixed(1)}" width="${(slot * 0.76).toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}"/>`);
      parts.push(`<text x="${(x + slot / 2).toFixed(1)}" y="${(barTop - 4).toFixed(1)}" font-size="9" font-family="IBM Plex Mono, monospace" fill="${color}" text-anchor="middle">${b.rate}¢</text>`);
      parts.push(`<text x="${(x + slot / 2).toFixed(1)}" y="${marginTop + chartHeight + 13}" font-size="8.5" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="middle">${b.label}</text>`);
    });

    svg.innerHTML = parts.join("");

    // Headline premium stats, computed from the data (not hardcoded)
    const receiptPremium = (bars[1].rate / bars[0].rate - 1) * 100;
    const g1Premium = (bars[3].rate / bars[2].rate - 1) * 100;
    const g2Premium = (bars[5].rate / bars[4].rate - 1) * 100;
    const tariffSummaryEl = document.getElementById("tariff-summary");
    tariffSummaryEl.className = "stat-row";
    tariffSummaryEl.innerHTML = `
      <div><span class="label">IT-R premium over FT-R</span><span class="big">+${receiptPremium.toFixed(0)}%</span></div>
      <div><span class="label">IT-D premium, Group 1</span><span class="big">+${g1Premium.toFixed(0)}%</span></div>
      <div><span class="label">IT-D premium, Group 2</span><span class="big">+${g2Premium.toFixed(0)}%</span></div>
    `;

    document.getElementById("tariff-source").innerHTML =
      `Rates effective ${tariff._meta.effective_date}, in ${tariff._meta.units}. ` +
      `Source: <a href="${tariff._meta.source}">${tariff._meta.source_title}</a>, TC Energy Customer Express. Static reference, not pipeline-updated.`;
  }

  // ---- Facility impact concentration (Pareto) ----

  function renderConcentrationChart(facilitiesData) {
    const facilities = facilitiesData.facilities;
    const svg = document.getElementById("concentration-chart");
    if (!facilities.length) {
      svg.outerHTML = '<p class="empty-note">Not enough data yet.</p>';
      return;
    }
    const total = facilities.reduce((s, f) => s + f.total_impact_e3m3d, 0);
    let running = 0;
    const points = facilities.map((f, i) => {
      running += f.total_impact_e3m3d;
      return { rank: i + 1, cumPct: (running / total) * 100 };
    });

    const n80 = points.findIndex((p) => p.cumPct >= 80) + 1;
    document.getElementById("concentration-summary").textContent =
      `The top ${n80} of ${facilities.length} facilities (${((n80 / facilities.length) * 100).toFixed(0)}% of names on the log) account for 80% of total logged impact volume.`;

    const width = 620, chartHeight = 180;
    const marginLeft = 36, marginRight = 12, marginTop = 12, marginBottom = 22;
    const innerWidth = width - marginLeft - marginRight;
    const totalHeight = chartHeight + marginTop + marginBottom;
    svg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("preserveAspectRatio", "none");

    const xAt = (rank) => marginLeft + ((rank - 1) / (points.length - 1 || 1)) * innerWidth;
    const yAt = (pct) => marginTop + chartHeight - (pct / 100) * chartHeight;

    const parts = [];
    [50, 80].forEach((mark) => {
      parts.push(`<line x1="${marginLeft}" y1="${yAt(mark).toFixed(1)}" x2="${width - marginRight}" y2="${yAt(mark).toFixed(1)}" stroke="#d8cba8" stroke-width="1" stroke-dasharray="2,3"/>`);
      parts.push(`<text x="${marginLeft - 4}" y="${(yAt(mark) + 3).toFixed(1)}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#6b6350" text-anchor="end">${mark}%</text>`);
    });

    const areaPoints = points.map((p) => `${xAt(p.rank).toFixed(1)},${yAt(p.cumPct).toFixed(1)}`).join(" ");
    const areaPath = `M ${marginLeft},${marginTop + chartHeight} L ${areaPoints} L ${xAt(points[points.length - 1].rank).toFixed(1)},${marginTop + chartHeight} Z`;
    parts.push(`<path d="${areaPath}" fill="#A9491F" fill-opacity="0.12"/>`);
    parts.push(`<polyline points="${areaPoints}" fill="none" stroke="#A9491F" stroke-width="1.75"/>`);

    svg.innerHTML = parts.join("");
  }

  // ---- Events ----

  function renderEvents(eventsData) {
    const list = document.getElementById("events-list");
    if (!eventsData.events.length) {
      list.innerHTML = `<p class="empty-note">No completed named-facility events fall within the realized flow history yet — most currently scheduled outages are still in the future. This list grows automatically as the daily pipeline runs.</p>`;
      return;
    }
    list.innerHTML = eventsData.events
      .map((ev) => {
        const deviation =
          ev.avg_deviation_from_seasonal_normal_pct === null
            ? `insufficient history (n=${ev.n_prior_years_for_seasonal_normal} prior yrs)`
            : `${ev.avg_deviation_from_seasonal_normal_pct >= 0 ? "+" : ""}${ev.avg_deviation_from_seasonal_normal_pct}pp`;
        return `
        <div class="event-card">
          <div class="event-title">${ev.facility} — ${ev.activity_type || "Outage"}</div>
          <div class="event-meta">${ev.zone} &middot; ${ev.start_date} → ${ev.end_date}</div>
          <div class="event-figures">
            <div><span class="figure-value">${fmtPct(ev.avg_utilization_pct_during)}</span><span class="figure-label">avg utilization during</span></div>
            <div><span class="figure-value">${ev.avg_capability_reduction_pct !== null ? fmtPct(ev.avg_capability_reduction_pct) : "—"}</span><span class="figure-label">capability reduction</span></div>
            <div><span class="figure-value">${deviation}</span><span class="figure-label">vs. seasonal normal</span></div>
          </div>
        </div>`;
      })
      .join("");
  }

  // ---- Boot ----

  async function main() {
    const [heatmap, facilities, correlation, events, serviceImpact, tariff] = await Promise.all([
      loadJSON("data/heatmap.json"),
      loadJSON("data/facilities.json"),
      loadJSON("data/monthly_correlation.json"),
      loadJSON("data/events.json"),
      loadJSON("data/service_impact.json"),
      loadJSON("data/tariff_rates.json"),
    ]);

    document.getElementById("meta-latest-day").textContent = heatmap.date_range.end;
    document.getElementById("meta-generated-at").textContent = new Date(heatmap.generated_at).toISOString().slice(0, 16).replace("T", " ") + " UTC";

    renderSystemMap(heatmap);
    renderTrendChart(heatmap);
    renderHeatmap(heatmap);
    renderSeasonalityChart(heatmap);
    renderServiceImpact(serviceImpact);
    renderTariffComparison(tariff);
    renderFacilities(facilities);
    renderConcentrationChart(facilities);
    renderCorrelation(correlation);
    renderEvents(events);
  }

  main().catch((err) => {
    console.error(err);
    document.querySelector("main").innerHTML = `<p class="empty-note">Failed to load data snapshots: ${err.message}</p>`;
  });
})();
