frappe.provide("frappe.tmc_strategy_dash");

// ===========================================================================
// CONSTANTS
// ===========================================================================

const RAG_COLORS = { Green: "#16a34a", Amber: "#f59e0b", Red: "#dc2626", "": "#9ca3af" };
const RAG_BG     = { Green: "#dcfce7", Amber: "#fef9c3", Red: "#fee2e2", "": "#f3f4f6" };
const RAG_TEXT   = { Green: "#166534", Amber: "#854d0e", Red: "#991b1b", "": "#4b5563" };
const RAG_SEVERITY = { Red: 3, Amber: 2, Green: 1, "": 0 };
const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";

const METHOD_BASE = "strategy_tracker.strategy_tracker.page.tmc___strategy_dash.tmc___strategy_dash";

// ===========================================================================
// PAGE BOOTSTRAP
// ===========================================================================

frappe.pages["tmc---strategy-dash"].on_page_load = function (wrapper) {
	frappe.tmc_strategy_dash.report.setup(wrapper);
};

frappe.tmc_strategy_dash.report = {

	setup: async function (wrapper) {
		if (this.initialized) return;
		this.initialized = true;

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Strategy Execution Dashboard — TMC",
			single_column: true,
		});

		this.wrapper = $(wrapper);
		this.main_section = this.wrapper.find(".layout-main-section");
		this.charts = {};
		this.grid_sort = { key: "severity", dir: "desc" };

		this.main_section.css({
			"max-width": "1440px",
			"margin": "0 auto",
			"padding": "0 24px",
		});

		this._injectStyles();
		this._buildLayout();

		this.page.add_button("Refresh", () => this.loadDashboard());

		await frappe.require(CHART_JS_URL);
		this._configureChartDefaults();

		await this._bootstrapFilters();
		await this.loadDashboard();
	},

	refresh: function () {},

	_configureChartDefaults: function () {
		if (typeof Chart === "undefined") return;
		Chart.defaults.color = "#94a3b8";
		Chart.defaults.borderColor = "rgba(148,163,184,0.25)";
		Chart.defaults.font.size = 11;
	},

	// -----------------------------------------------------------------
	// LAYOUT
	// -----------------------------------------------------------------

	_buildLayout: function () {
		this.main_section.append(`
			<div class="filters-bar border rounded p-3 mb-4">
				<div class="row align-items-end">
					<div class="col-md-2 year-filter"></div>
					<div class="col-md-4 review-period-filter"></div>
					<div class="col-md-6 d-flex align-items-end justify-content-end">
						<div class="scope-badge"></div>
					</div>
				</div>
			</div>

			<div class="cards-row mb-4"></div>

			<div class="section-card mb-4">
				<div class="section-card-title">Function Comparison — This Period</div>
				<div class="comparison-table-wrap"></div>
			</div>

			<div class="row mb-4">
				<div class="col-md-12">
					<div class="chart-card">
						<div class="chart-card-title">RAG Trend — Last Periods (Org-Wide)</div>
						<div class="chart-card-body" data-canvas-id="tmc-rag-trend"><canvas id="tmc-rag-trend"></canvas></div>
					</div>
				</div>
			</div>

			<div class="section-card mb-4">
				<div class="section-card-title">Pillar Performance by Function</div>
				<div class="heatmap-wrap"></div>
			</div>
		`);

		this.year_filter_wrap = this.main_section.find(".year-filter");
		this.review_period_filter_wrap = this.main_section.find(".review-period-filter");
		this.scope_badge = this.main_section.find(".scope-badge");
		this.cards_row = this.main_section.find(".cards-row");
		this.comparison_table_wrap = this.main_section.find(".comparison-table-wrap");
		this.heatmap_wrap = this.main_section.find(".heatmap-wrap");
	},

	_injectStyles: function () {
		if (document.getElementById("tmc-strategy-dash-style")) return;
		const style = document.createElement("style");
		style.id = "tmc-strategy-dash-style";
		style.innerHTML = `
			:root{--fh-radius:14px;}
			.scope-badge{font-weight:600;font-size:12.5px;letter-spacing:.01em;color:#1e40af;background:linear-gradient(180deg,#eff6ff,#e0edff);border:1px solid var(--border-color,#bfdbfe);border-radius:20px;padding:6px 14px;}
			.filters-bar{background:var(--card-bg,#fff);border-color:var(--border-color,#e9eaec)!important;border-radius:var(--fh-radius);box-shadow:0 2px 4px rgba(16,24,40,0.06),0 8px 20px -6px rgba(16,24,40,0.12);}
			.cards-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}
			.metric-card{position:relative;background:var(--card-bg,#fff);border:1px solid var(--border-color,#edeef0);border-radius:var(--fh-radius);padding:16px 18px;box-shadow:0 2px 4px rgba(16,24,40,0.07),0 10px 24px -8px rgba(16,24,40,0.18);transition:box-shadow .18s ease,transform .18s ease;}
			.metric-card:hover{box-shadow:0 3px 6px rgba(16,24,40,0.08),0 16px 30px -10px rgba(16,24,40,0.22);transform:translateY(-2px);}
			.metric-card .m-label{font-size:10.5px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted,#9ca3af);font-weight:700;margin-bottom:7px;}
			.metric-card .m-value{font-size:25px;font-weight:700;color:var(--text-color,#111827);letter-spacing:-0.02em;}
			.metric-card.rag-green{box-shadow:inset 3px 0 0 #16a34a,0 2px 4px rgba(16,24,40,0.07),0 10px 24px -8px rgba(16,24,40,0.18);}
			.metric-card.rag-amber{box-shadow:inset 3px 0 0 #f59e0b,0 2px 4px rgba(16,24,40,0.07),0 10px 24px -8px rgba(16,24,40,0.18);}
			.metric-card.rag-red{box-shadow:inset 3px 0 0 #dc2626,0 2px 4px rgba(16,24,40,0.07),0 10px 24px -8px rgba(16,24,40,0.18);}
			.chart-card,.section-card{background:var(--card-bg,#fff);border:1px solid var(--border-color,#edeef0);border-radius:var(--fh-radius);padding:18px;height:100%;box-shadow:0 2px 4px rgba(16,24,40,0.06),0 10px 26px -8px rgba(16,24,40,0.16);}
			.chart-card-title,.section-card-title{font-size:12.5px;font-weight:700;color:var(--text-muted,#374151);margin-bottom:14px;padding-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border-color,#f0f1f3);}
			.chart-card-body{position:relative;height:280px;}
			.rag-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.01em;}
			.pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;background:var(--control-bg,#f3f4f6);color:var(--text-color,#374151);}
			.pill.overdue{background:#fee2e2;color:#991b1b;}
			.pill.not-submitted{background:var(--control-bg,#f3f4f6);color:var(--text-muted,#6b7280);}
			.empty-state{padding:40px;text-align:center;color:var(--text-muted,#9ca3af);font-size:13px;}
			.loading-state{font-weight:600;letter-spacing:.02em;animation:tmc-pulse 1.1s ease-in-out infinite;}
			@keyframes tmc-pulse{0%,100%{opacity:.45;}50%{opacity:1;}}

			.fh-table-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--border-color,#edeef0);}
			.fh-table{width:100%;border-collapse:collapse;font-size:12.5px;}
			.fh-table thead th{background:var(--control-bg,#f9fafb);padding:10px 12px;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;color:var(--text-muted,#6b7280);border-bottom:2px solid var(--border-color,#edeef0);white-space:nowrap;}
			.fh-table tbody td{padding:10px 12px;border-bottom:1px solid var(--border-color,#f4f5f6);vertical-align:middle;color:var(--text-color,#111827);}
			.fh-table tbody tr{transition:background-color .12s ease;}
			.fh-table tbody tr:last-child td{border-bottom:none;}

			/* Comparison grid: sortable headers + clickable rows */
			.comparison-table thead th.sortable{cursor:pointer;user-select:none;}
			.comparison-table thead th.sortable:hover{color:var(--text-color,#374151);}
			.comparison-table thead th .sort-arrow{margin-left:4px;opacity:.6;}
			.comparison-table tbody tr.has-entry{cursor:pointer;}
			.comparison-table tbody tr.has-entry:hover{background:var(--control-bg,#f9fafb);}
			.comparison-table .fn-head{display:block;font-size:11px;color:var(--text-muted,#9ca3af);font-weight:500;margin-top:1px;}
			.comparison-table .rag-count-strip{display:flex;gap:8px;font-size:12px;white-space:nowrap;}
			.comparison-table .rag-count-strip b{font-weight:700;}

			/* Pillar x Function heatmap */
			.heatmap-table{width:100%;border-collapse:collapse;font-size:11.5px;}
			.heatmap-table th,.heatmap-table td{padding:8px 10px;text-align:center;white-space:nowrap;border-bottom:1px solid var(--border-color,#f4f5f6);}
			.heatmap-table thead th{background:var(--control-bg,#f9fafb);font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;color:var(--text-muted,#6b7280);border-bottom:2px solid var(--border-color,#edeef0);}
			.heatmap-table th:first-child,.heatmap-table td:first-child{position:sticky;left:0;background:var(--card-bg,#fff);text-align:left;font-weight:600;color:var(--text-color,#111827);z-index:1;box-shadow:1px 0 0 var(--border-color,#edeef0);}
			.heatmap-table thead th:first-child{background:var(--control-bg,#f9fafb);z-index:2;}
			.hm-cell{display:inline-flex;align-items:center;justify-content:center;width:34px;height:22px;border-radius:6px;font-size:10px;font-weight:700;}
			.hm-cell.hm-none{background:transparent;color:var(--border-color,#e5e7eb);}
		`;
		document.head.appendChild(style);
	},

	// -----------------------------------------------------------------
	// FILTERS (same Year → Review Period pattern as the Function Head dashboard)
	// -----------------------------------------------------------------

	_bootstrapFilters: async function () {
		const r = await frappe.call({ method: `${METHOD_BASE}.get_filter_options` });
		const data = r.message || {};
		this.scope_badge.text(data.scope_label || "");

		this.all_review_periods = data.review_periods || [];

		const default_period = data.default_review_period
			? this.all_review_periods.find(p => p.name === data.default_review_period)
			: null;

		const years = [...new Set(
			this.all_review_periods
				.map(p => p.calendar_year)
				.filter(y => y !== null && y !== undefined && y !== "")
		)].sort((a, b) => b - a);

		const default_year = default_period ? default_period.calendar_year : (years[0] ?? null);

		this.year_field = frappe.ui.form.make_control({
			parent: this.year_filter_wrap,
			df: {
				label: "Year",
				fieldname: "calendar_year",
				fieldtype: "Select",
				options: years.map(y => ({ label: String(y), value: String(y) })),
				change: () => this._onYearChange(),
			},
			render_input: true,
		});

		this.review_period_field = frappe.ui.form.make_control({
			parent: this.review_period_filter_wrap,
			df: {
				label: "Review Period",
				fieldname: "review_period",
				fieldtype: "Select",
				options: this._reviewPeriodOptions(default_year),
				change: () => this.loadDashboard(),
			},
			render_input: true,
		});

		if (default_year !== null) {
			await this.year_field.set_value(String(default_year));
		}
		if (data.default_review_period) {
			await this.review_period_field.set_value(data.default_review_period);
		}
	},

	_reviewPeriodOptions: function (year) {
		const filtered = (year === null || year === undefined || year === "")
			? this.all_review_periods
			: this.all_review_periods.filter(p => String(p.calendar_year) === String(year));
		return filtered.map(p => ({
			label: `${p.review_name || p.name} (${frappe.datetime.str_to_user(p.review_meeting_date) || ""})`,
			value: p.name,
		}));
	},

	_onYearChange: async function () {
		const year = this.year_field.get_value();
		this.review_period_field.df.options = this._reviewPeriodOptions(year);
		this.review_period_field.refresh();

		const periods_in_year = this.all_review_periods.filter(p => String(p.calendar_year) === String(year));
		const today = frappe.datetime.get_today();
		const started = periods_in_year.filter(p => p.review_window_start && p.review_window_start <= today);
		const next_value = started.length
			? started[started.length - 1].name
			: (periods_in_year[0] ? periods_in_year[0].name : "");

		await this.review_period_field.set_value(next_value);
		this.loadDashboard();
	},

	// -----------------------------------------------------------------
	// DATA LOAD
	// -----------------------------------------------------------------

	loadDashboard: async function () {
		const review_period = this.review_period_field ? this.review_period_field.get_value() : null;
		this._startLoadingSequence();

		let data = {};
		try {
			const r = await frappe.call({
				method: `${METHOD_BASE}.get_dashboard_data`,
				args: { review_period },
			});
			data = r.message || {};
		} finally {
			this._stopLoadingSequence();
		}

		this._data = data;
		this.renderCards(data);
		this._safe(() => this.renderComparisonGrid(data), "comparison grid");
		this._safe(() => this.renderTrend(data), "trend");
		this._safe(() => this.renderHeatmap(data), "heatmap");
	},

	_startLoadingSequence: function () {
		const messages = ["Fetching data…", "Organizing charts…", "Presenting now…"];
		let i = 0;
		this.cards_row.html(`<div class="empty-state loading-state">${messages[0]}</div>`);
		this._loading_interval = setInterval(() => {
			i = (i + 1) % messages.length;
			this.cards_row.find(".loading-state").text(messages[i]);
		}, 500);
	},

	_stopLoadingSequence: function () {
		if (this._loading_interval) {
			clearInterval(this._loading_interval);
			this._loading_interval = null;
		}
	},

	_safe: function (fn, label) {
		try {
			fn();
		} catch (e) {
			console.error(`[TMC Strategy Dash] failed to render ${label}:`, e);
		}
	},

	// -----------------------------------------------------------------
	// RENDERERS
	// -----------------------------------------------------------------

	renderCards: function (data) {
		const c = data.cards || {};
		this.cards_row.html(`
			<div class="metric-card"><div class="m-label">Total KPIs</div><div class="m-value">${c.total_kpis || 0}</div></div>
			<div class="metric-card rag-green"><div class="m-label">Green</div><div class="m-value" style="color:#16a34a;">${c.green_count || 0}</div></div>
			<div class="metric-card rag-amber"><div class="m-label">Amber</div><div class="m-value" style="color:#f59e0b;">${c.amber_count || 0}</div></div>
			<div class="metric-card rag-red"><div class="m-label">Red</div><div class="m-value" style="color:#dc2626;">${c.red_count || 0}</div></div>
			<div class="metric-card"><div class="m-label">Open Actions</div><div class="m-value">${c.open_actions || 0}</div></div>
			<div class="metric-card"><div class="m-label">Overdue Actions</div><div class="m-value" style="color:${(c.overdue_actions || 0) > 0 ? '#dc2626' : 'var(--text-color,#111827)'};">${c.overdue_actions || 0}</div></div>
			<div class="metric-card"><div class="m-label">Functions Reporting</div><div class="m-value" style="color:${(c.functions_reported || 0) < (c.functions_in_scope || 0) ? '#f59e0b' : 'var(--text-color,#111827)'};">${c.functions_reported || 0}/${c.functions_in_scope || 0}</div></div>
		`);

		const ragIndicator = { Green: "green", Amber: "orange", Red: "red" }[c.overall_rag] || "gray";
		this.page.set_indicator(c.overall_rag || "No Data", ragIndicator);
	},

	// Sortable, clickable comparison grid — one row per scoped function.
	// Default sort surfaces the worst-performing functions first.
	renderComparisonGrid: function (data) {
		this._grid_rows = data.grid || [];
		this._renderComparisonGridRows();
	},

	_gridSortValue: function (row, key) {
		if (key === "severity") return RAG_SEVERITY[row.overall_rag] ?? -1;
		if (key === "function") return (row.function || "").toLowerCase();
		return row[key] ?? 0;
	},

	_renderComparisonGridRows: function () {
		const rows = this._grid_rows || [];
		if (!rows.length) {
			this.comparison_table_wrap.html(`<div class="empty-state">No functions in scope. Assign a Department Head to bring a department into this view.</div>`);
			return;
		}

		const { key, dir } = this.grid_sort;
		const sorted = [...rows].sort((a, b) => {
			const av = this._gridSortValue(a, key), bv = this._gridSortValue(b, key);
			if (av < bv) return dir === "asc" ? -1 : 1;
			if (av > bv) return dir === "asc" ? 1 : -1;
			return 0;
		});

		const arrow = (colKey) => key === colKey ? `<span class="sort-arrow">${dir === "asc" ? "↑" : "↓"}</span>` : "";

		const rowsHtml = sorted.map(r => {
			const rag = r.overall_rag || "";
			const clickable = r.submitted && r.entry_name;
			return `
				<tr class="${clickable ? "has-entry" : ""}" ${clickable ? `data-entry="${encodeURIComponent(r.entry_name)}"` : ""}>
					<td>
						${frappe.utils.escape_html(r.function || "")}
						${r.department_head_name ? `<span class="fn-head">${frappe.utils.escape_html(r.department_head_name)}</span>` : ""}
					</td>
					<td>${r.submitted ? '<span class="pill" style="background:#dcfce7;color:#166534;">Reported</span>' : '<span class="pill not-submitted">Not Submitted</span>'}</td>
					<td><span class="rag-badge" style="background:${RAG_BG[rag]};color:${RAG_TEXT[rag]};">${rag || "No Data"}</span></td>
					<td>
						<div class="rag-count-strip">
							<span style="color:#16a34a;"><b>${r.green_count}</b> G</span>
							<span style="color:#f59e0b;"><b>${r.amber_count}</b> A</span>
							<span style="color:#dc2626;"><b>${r.red_count}</b> R</span>
						</div>
					</td>
					<td>${r.open_actions}</td>
					<td>${r.overdue_actions > 0 ? `<span class="pill overdue">${r.overdue_actions}</span>` : r.overdue_actions}</td>
					<td>${r.escalation || r.escalated_actions > 0 ? '<span class="pill overdue">Escalated</span>' : ""}</td>
				</tr>
			`;
		}).join("");

		this.comparison_table_wrap.html(`
			<div class="fh-table-wrap">
				<table class="fh-table comparison-table">
					<thead>
						<tr>
							<th class="sortable" data-sort="function">Function${arrow("function")}</th>
							<th>Status</th>
							<th class="sortable" data-sort="severity">Overall RAG${arrow("severity")}</th>
							<th>KPI Breakdown</th>
							<th class="sortable" data-sort="open_actions">Open Actions${arrow("open_actions")}</th>
							<th class="sortable" data-sort="overdue_actions">Overdue${arrow("overdue_actions")}</th>
							<th></th>
						</tr>
					</thead>
					<tbody>${rowsHtml}</tbody>
				</table>
			</div>
		`);

		this.comparison_table_wrap.find("th.sortable").on("click", (e) => {
			const sortKey = $(e.currentTarget).data("sort");
			if (this.grid_sort.key === sortKey) {
				this.grid_sort.dir = this.grid_sort.dir === "asc" ? "desc" : "asc";
			} else {
				this.grid_sort = { key: sortKey, dir: sortKey === "function" ? "asc" : "desc" };
			}
			this._renderComparisonGridRows();
		});

		// Drill-down: open the submitted KPI Period Entry for that function.
		// (Not routed into the Function Head dashboard itself, since that page
		// resolves "my function" from the logged-in user rather than a URL param.)
		this.comparison_table_wrap.find("tr.has-entry").on("click", (e) => {
			const entry = $(e.currentTarget).data("entry");
			if (entry) window.open(`/app/kpi-period-entry/${entry}`, "_blank");
		});
	},

	renderTrend: function (data) {
		this._destroyChart("trend");
		const ctx = this._resetCanvas("tmc-rag-trend");
		if (!ctx) return;
		const trend = data.trend || [];
		if (!trend.length) {
			ctx.parentElement.innerHTML = `<div class="empty-state">No trend data available</div>`;
			return;
		}
		this.charts.trend = new Chart(ctx, {
			type: "bar",
			data: {
				labels: trend.map(t => t.review_name || t.review_period),
				datasets: [
					{ label: "Green", data: trend.map(t => t.green_count), backgroundColor: RAG_COLORS.Green, stack: "s" },
					{ label: "Amber", data: trend.map(t => t.amber_count), backgroundColor: RAG_COLORS.Amber, stack: "s" },
					{ label: "Red", data: trend.map(t => t.red_count), backgroundColor: RAG_COLORS.Red, stack: "s" },
				],
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
				scales: {
					x: { stacked: true, ticks: { font: { size: 10 } } },
					y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
				},
			},
		});
	},

	// Pillar (rows) x Function (columns) heatmap. Each cell shows the
	// dominant/worst RAG status for that function's KPIs under that pillar;
	// a hover tooltip breaks down the underlying counts.
	renderHeatmap: function (data) {
		const hm = data.heatmap || { pillars: [], functions: [], rows: [] };
		if (!hm.pillars.length || !hm.functions.length) {
			this.heatmap_wrap.html(`<div class="empty-state">No pillar/function data available for this period.</div>`);
			return;
		}

		const headerCells = hm.functions.map(f => `<th title="${frappe.utils.escape_html(f.head || "")}">${frappe.utils.escape_html(f.name)}</th>`).join("");

		const bodyRows = hm.rows.map(row => {
			const cells = row.cells.map(cell => {
				if (cell.status === null) {
					return `<td><span class="hm-cell hm-none">—</span></td>`;
				}
				const status = cell.status || "";
				const c = cell.counts || {};
				const tooltip = `Green: ${c.green || 0}, Amber: ${c.amber || 0}, Red: ${c.red || 0}, Not Rated: ${c.not_rated || 0}`;
				return `<td title="${tooltip}"><span class="hm-cell" style="background:${RAG_BG[status]};color:${RAG_TEXT[status]};">${status ? status[0] : "—"}</span></td>`;
			}).join("");
			return `<tr><td>${frappe.utils.escape_html(row.pillar)}</td>${cells}</tr>`;
		}).join("");

		this.heatmap_wrap.html(`
			<div class="fh-table-wrap">
				<table class="heatmap-table">
					<thead><tr><th>Pillar</th>${headerCells}</tr></thead>
					<tbody>${bodyRows}</tbody>
				</table>
			</div>
		`);
	},

	_destroyChart: function (key) {
		if (this.charts[key]) {
			try { this.charts[key].destroy(); } catch (_) {}
			delete this.charts[key];
		}
	},

	_resetCanvas: function (id) {
		let el = document.getElementById(id);
		if (!el) {
			const body = this.main_section.find(`.chart-card-body`).filter((i, node) => $(node).data("canvas-id") === id);
			if (!body.length) return null;
			body.html(`<canvas id="${id}"></canvas>`);
			el = document.getElementById(id);
		}
		return el;
	},
};
