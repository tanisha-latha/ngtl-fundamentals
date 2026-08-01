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

  function renderFacilities(facilitiesData) {
    const tbody = document.getElementById("facilities-tbody");
    if (!facilitiesData.facilities.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No facilities recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = facilitiesData.facilities
      .map(
        (f) => `
      <tr>
        <td>${f.firm_risk_events > 0 ? '<span class="firm-dot" title="' + f.firm_risk_events + ' firm-risk event(s)"></span>' : ""}${f.facility}</td>
        <td class="num mono">${fmtInt(f.days_active)}</td>
        <td class="num impact-figure">${fmtInt(f.total_impact_e3m3d)}</td>
        <td>${f.zones.join(", ")}</td>
        <td class="mono">${f.first_seen} → ${f.last_seen}</td>
      </tr>`
      )
      .join("");
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
    const [heatmap, facilities, correlation, events, serviceImpact] = await Promise.all([
      loadJSON("data/heatmap.json"),
      loadJSON("data/facilities.json"),
      loadJSON("data/monthly_correlation.json"),
      loadJSON("data/events.json"),
      loadJSON("data/service_impact.json"),
    ]);

    document.getElementById("meta-latest-day").textContent = heatmap.date_range.end;
    document.getElementById("meta-generated-at").textContent = new Date(heatmap.generated_at).toISOString().slice(0, 16).replace("T", " ") + " UTC";

    renderTrendChart(heatmap);
    renderHeatmap(heatmap);
    renderServiceImpact(serviceImpact);
    renderFacilities(facilities);
    renderCorrelation(correlation);
    renderEvents(events);
  }

  main().catch((err) => {
    console.error(err);
    document.querySelector("main").innerHTML = `<p class="empty-note">Failed to load data snapshots: ${err.message}</p>`;
  });
})();
