// frappe.pages['fh---strategy-dash'].on_page_load = function(wrapper) {
// 	var page = frappe.ui.make_app_page({
// 		parent: wrapper,
// 		title: 'Strategy Execution Dashboard - FH',
// 		single_column: true
// 	});
// }


frappe.provide("frappe.fh_strategy_dash");

// ===========================================================================
// CONSTANTS
// ===========================================================================

const RAG_COLORS = { Green: "#16a34a", Amber: "#f59e0b", Red: "#dc2626", "": "#9ca3af" };
const RAG_BG     = { Green: "#dcfce7", Amber: "#fef9c3", Red: "#fee2e2", "": "#f3f4f6" };
const RAG_TEXT   = { Green: "#166534", Amber: "#854d0e", Red: "#991b1b", "": "#4b5563" };
const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";

const METHOD_BASE = "strategy_tracker.strategy_tracker.page.fh___strategy_dash.fh___strategy_dash";

// ===========================================================================
// PAGE BOOTSTRAP
// ===========================================================================

frappe.pages["fh---strategy-dash"].on_page_load = function (wrapper) {
	frappe.fh_strategy_dash.report.setup(wrapper);
};

frappe.fh_strategy_dash.report = {

	setup: async function (wrapper) {
		if (this.initialized) return;
		this.initialized = true;

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Strategy Execution Dashboard",
			single_column: true,
		});

		this.wrapper = $(wrapper);
		this.main_section = this.wrapper.find(".layout-main-section");
		this.charts = {};

		// Centered, comfortably-margined content instead of edge-to-edge.
		this.main_section.css({
			"max-width": "1440px",
			"margin": "0 auto",
			"padding": "0 24px",
		});

		this._injectStyles();
		this._buildLayout();

		this.page.add_button("Refresh", () => this.loadDashboard());

		// IMPORTANT: must be awaited — chart rendering will throw a
		// ReferenceError (Chart is not defined) if this hasn't resolved yet,
		// which silently aborts the rest of the render pass.
		await frappe.require(CHART_JS_URL);
		this._configureChartDefaults();

		await this._bootstrapFilters();
		await this.loadDashboard();
	},

	refresh: function () {},

	_configureChartDefaults: function () {
		// Neutral mid-tones that read fine on both light and dark desk themes,
		// since Chart.js renders to a plain <canvas> and can't inherit
		// Frappe's CSS custom properties automatically.
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
						<div class="function-badge"></div>
					</div>
				</div>
			</div>

			<div class="cards-row mb-4"></div>

			<div class="row mb-4">
				<div class="col-md-4">
					<div class="chart-card">
						<div class="chart-card-title">RAG Split — This Period</div>
						<div class="chart-card-body" data-canvas-id="fh-rag-donut"><canvas id="fh-rag-donut"></canvas></div>
					</div>
				</div>
				<div class="col-md-8">
					<div class="chart-card">
						<div class="chart-card-title">RAG Trend — Last Periods</div>
						<div class="chart-card-body" data-canvas-id="fh-rag-trend"><canvas id="fh-rag-trend"></canvas></div>
					</div>
				</div>
			</div>

			<div class="row mb-4">
				<div class="col-md-6">
					<div class="chart-card">
						<div class="chart-card-title">RAG by Pillar</div>
						<div class="chart-card-body" data-canvas-id="fh-pillar-chart"><canvas id="fh-pillar-chart"></canvas></div>
					</div>
				</div>
				<div class="col-md-6">
					<div class="chart-card">
						<div class="chart-card-title">Actions by Priority &amp; Status</div>
						<div class="chart-card-body" data-canvas-id="fh-priority-chart"><canvas id="fh-priority-chart"></canvas></div>
					</div>
				</div>
			</div>

			<div class="section-card mb-4">
				<div class="section-card-title">KPI Performance — This Period</div>
				<div class="kpi-table-wrap"></div>
			</div>

			<div class="section-card mb-4">
				<div class="section-card-title d-flex justify-content-between align-items-center">
					<span>KPI Actions (Amber / Red follow-ups)</span>
					<div class="action-funnel"></div>
				</div>
				<div class="actions-table-wrap"></div>
			</div>
		`);

		this.year_filter_wrap = this.main_section.find(".year-filter");
		this.review_period_filter_wrap = this.main_section.find(".review-period-filter");
		this.function_badge = this.main_section.find(".function-badge");
		this.cards_row = this.main_section.find(".cards-row");
		this.kpi_table_wrap = this.main_section.find(".kpi-table-wrap");
		this.actions_table_wrap = this.main_section.find(".actions-table-wrap");
		this.action_funnel_wrap = this.main_section.find(".action-funnel");
	},

	_injectStyles: function () {
		if (document.getElementById("fh-strategy-dash-style")) return;
		const style = document.createElement("style");
		style.id = "fh-strategy-dash-style";
		style.innerHTML = `
			.function-badge{font-weight:600;font-size:13px;color:var(--text-color,#374151);background:var(--control-bg,#f0fdf4);border:1px solid var(--border-color,#bbf7d0);border-radius:20px;padding:6px 14px;}
			.filters-bar{background:var(--card-bg,transparent);border-color:var(--border-color,#e5e7eb)!important;}
			.cards-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;}
			.metric-card{background:var(--card-bg,transparent);border:1px solid var(--border-color,#e5e7eb);border-radius:12px;padding:14px 16px;}
			.metric-card .m-label{font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#9ca3af);font-weight:600;margin-bottom:6px;}
			.metric-card .m-value{font-size:24px;font-weight:700;color:var(--text-color,#111827);}
			.metric-card.rag-green{border-left:4px solid #16a34a;}
			.metric-card.rag-amber{border-left:4px solid #f59e0b;}
			.metric-card.rag-red{border-left:4px solid #dc2626;}
			.overall-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;}
			.chart-card,.section-card{background:var(--card-bg,transparent);border:1px solid var(--border-color,#e5e7eb);border-radius:12px;padding:16px;height:100%;}
			.chart-card-title,.section-card-title{font-size:13px;font-weight:700;color:var(--text-muted,#374151);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.03em;}
			.chart-card-body{position:relative;height:260px;}
			.rag-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;}
			.inline-bar-wrap{display:flex;align-items:center;gap:6px;}
			.inline-bar-bg{width:60px;height:6px;background:var(--border-color,#e5e7eb);border-radius:3px;overflow:hidden;flex-shrink:0;}
			.inline-bar-fill{height:100%;border-radius:3px;}
			.fh-table-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--border-color,#e5e7eb);}
			.fh-table{width:100%;border-collapse:collapse;font-size:12.5px;}
			.fh-table thead th{background:var(--control-bg,#f9fafb);padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#6b7280);border-bottom:2px solid var(--border-color,#e5e7eb);white-space:nowrap;}
			.fh-table tbody td{padding:9px 12px;border-bottom:1px solid var(--border-color,#f0f1f3);vertical-align:middle;color:var(--text-color,#111827);}
			.fh-table tbody tr:hover{background:var(--control-bg,#f9fafb);}
			.fh-table tbody tr:last-child td{border-bottom:none;}
			.pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;background:var(--control-bg,#f3f4f6);color:var(--text-color,#374151);}
			.pill.overdue{background:#fee2e2;color:#991b1b;}
			.pill.high{background:#fee2e2;color:#991b1b;}
			.pill.medium{background:#fef9c3;color:#854d0e;}
			.pill.low{background:#e0f2fe;color:#075985;}
			.funnel-mini{display:flex;gap:10px;font-size:12px;color:var(--text-muted,#4b5563);}
			.funnel-mini span b{color:var(--text-color,#111827);}
			.empty-state{padding:40px;text-align:center;color:var(--text-muted,#9ca3af);font-size:13px;}
		`;
		document.head.appendChild(style);
	},

	// -----------------------------------------------------------------
	// FILTERS
	// -----------------------------------------------------------------

	_bootstrapFilters: async function () {
		const r = await frappe.call({ method: `${METHOD_BASE}.get_filter_options` });
		const data = r.message || {};
		this.function_badge.text(data.function_label || "");

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

	// Review Period <select> options scoped to a given calendar_year
	// (or all periods if no year is passed).
	_reviewPeriodOptions: function (year) {
		const filtered = (year === null || year === undefined || year === "")
			? this.all_review_periods
			: this.all_review_periods.filter(p => String(p.calendar_year) === String(year));
		return filtered.map(p => ({
			label: `${p.review_name || p.name} (${frappe.datetime.str_to_user(p.review_meeting_date) || ""})`,
			value: p.name,
		}));
	},

	// Re-scope the Review Period dropdown whenever Year changes, then pick
	// a sensible default within that year (mirrors the backend's own
	// "most recent started, else first upcoming" logic in get_filter_options).
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
		// set_value only fires the field's own change handler when the value
		// actually differs from before — force a reload here so the dashboard
		// always reflects the new year even if the resolved period is the same.
		this.loadDashboard();
	},

	// -----------------------------------------------------------------
	// DATA LOAD
	// -----------------------------------------------------------------

	loadDashboard: async function () {
		const review_period = this.review_period_field ? this.review_period_field.get_value() : null;
		this.cards_row.html(`<div class="empty-state">Loading dashboard&hellip;</div>`);

		const r = await frappe.call({
			method: `${METHOD_BASE}.get_dashboard_data`,
			args: { review_period },
		});
		const data = r.message || {};
		this.renderCards(data);
		this._safe(() => this.renderDonut(data), "donut");
		this._safe(() => this.renderTrend(data), "trend");
		this._safe(() => this.renderPillarChart(data), "pillar");
		this._safe(() => this.renderPriorityChart(data), "priority");
		this._safe(() => this.renderKpiTable(data), "kpi table");
		this._safe(() => this.renderActionsTable(data), "actions table");
	},

	_safe: function (fn, label) {
		try {
			fn();
		} catch (e) {
			console.error(`[FH Strategy Dash] failed to render ${label}:`, e);
		}
	},

	// -----------------------------------------------------------------
	// RENDERERS
	// -----------------------------------------------------------------

	renderCards: function (data) {
		const c = data.cards || {};
		const ragClass = (c.overall_rag || "").toLowerCase();
		this.cards_row.html(`
			<div class="metric-card"><div class="m-label">Total KPIs</div><div class="m-value">${c.total_kpis || 0}</div></div>
			<div class="metric-card rag-green"><div class="m-label">Green</div><div class="m-value" style="color:#16a34a;">${c.green_count || 0}</div></div>
			<div class="metric-card rag-amber"><div class="m-label">Amber</div><div class="m-value" style="color:#f59e0b;">${c.amber_count || 0}</div></div>
			<div class="metric-card rag-red"><div class="m-label">Red</div><div class="m-value" style="color:#dc2626;">${c.red_count || 0}</div></div>
			<div class="metric-card"><div class="m-label">Open Actions</div><div class="m-value">${c.open_actions || 0}</div></div>
			<div class="metric-card"><div class="m-label">Overdue Actions</div><div class="m-value" style="color:${(c.overdue_actions || 0) > 0 ? '#dc2626' : '#111827'};">${c.overdue_actions || 0}</div></div>
			<div class="metric-card">
				<div class="m-label">Overall RAG</div>
				<div class="overall-badge" style="background:${RAG_BG[c.overall_rag] || RAG_BG['']};color:${RAG_TEXT[c.overall_rag] || RAG_TEXT['']};">
					${c.overall_rag || "No Data"}
				</div>
			</div>
		`);
	},

	renderDonut: function (data) {
		const c = data.cards || {};
		this._destroyChart("donut");
		const ctx = this._resetCanvas("fh-rag-donut");
		if (!ctx) return;
		const values = [c.green_count || 0, c.amber_count || 0, c.red_count || 0];
		if (!values.some(v => v > 0)) {
			ctx.parentElement.innerHTML = `<div class="empty-state">No RAG data for this period</div>`;
			return;
		}
		this.charts.donut = new Chart(ctx, {
			type: "doughnut",
			data: {
				labels: ["Green", "Amber", "Red"],
				datasets: [{ data: values, backgroundColor: [RAG_COLORS.Green, RAG_COLORS.Amber, RAG_COLORS.Red], borderWidth: 2, borderColor: "#fff" }],
			},
			options: {
				responsive: true, maintainAspectRatio: false, cutout: "65%",
				plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
			},
		});
	},

	renderTrend: function (data) {
		this._destroyChart("trend");
		const ctx = this._resetCanvas("fh-rag-trend");
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

	renderPillarChart: function (data) {
		this._destroyChart("pillar");
		const ctx = this._resetCanvas("fh-pillar-chart");
		if (!ctx) return;
		const pb = data.pillar_breakdown || [];
		if (!pb.length) {
			ctx.parentElement.innerHTML = `<div class="empty-state">No KPI lines for this period</div>`;
			return;
		}
		this.charts.pillar = new Chart(ctx, {
			type: "bar",
			data: {
				labels: pb.map(p => p.pillar),
				datasets: [
					{ label: "Green", data: pb.map(p => p.green), backgroundColor: RAG_COLORS.Green, stack: "s" },
					{ label: "Amber", data: pb.map(p => p.amber), backgroundColor: RAG_COLORS.Amber, stack: "s" },
					{ label: "Red", data: pb.map(p => p.red), backgroundColor: RAG_COLORS.Red, stack: "s" },
					{ label: "Not Rated", data: pb.map(p => p.not_rated), backgroundColor: RAG_COLORS[""], stack: "s" },
				],
			},
			options: {
				indexAxis: "y",
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
				scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true, ticks: { font: { size: 10 } } } },
			},
		});
	},

	renderPriorityChart: function (data) {
		this._destroyChart("priority");
		const ctx = this._resetCanvas("fh-priority-chart");
		if (!ctx) return;
		const matrix = data.action_priority_matrix || [];
		if (!matrix.length || !matrix.some(m => (m["Not Started"] + m["In Progress"] + m["Completed"] + m["Overdue"]) > 0)) {
			ctx.parentElement.innerHTML = `<div class="empty-state">No open actions this period</div>`;
			return;
		}
		const statuses = [
			{ key: "Not Started", color: "#9ca3af" },
			{ key: "In Progress", color: "#3b82f6" },
			{ key: "Overdue", color: "#dc2626" },
			{ key: "Completed", color: "#16a34a" },
		];
		this.charts.priority = new Chart(ctx, {
			type: "bar",
			data: {
				labels: matrix.map(m => m.priority),
				datasets: statuses.map(s => ({
					label: s.key, data: matrix.map(m => m[s.key]), backgroundColor: s.color, stack: "s",
				})),
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
				scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
			},
		});
	},

	renderKpiTable: function (data) {
		const lines = data.kpi_lines || [];
		if (!data.has_entry) {
			this.kpi_table_wrap.html(`<div class="empty-state">No KPI Period Entry has been created for this review period yet.</div>`);
			return;
		}
		if (!lines.length) {
			this.kpi_table_wrap.html(`<div class="empty-state">No KPI lines recorded for this period.</div>`);
			return;
		}
		const rows = lines.map(l => {
			const rag = l.rag_status || "";
			const barPct = rag === "Green" ? 100 : rag === "Amber" ? 60 : rag === "Red" ? 25 : 0;
			return `
				<tr>
					<td>${frappe.utils.escape_html(l.pillar || "")}</td>
					<td style="width:25%;"><a href="/app/kpi/${encodeURIComponent(l.kpi)}" target="_blank">${frappe.utils.escape_html(l.kpi_description || "")}</a></td>
					<td style="width:25%;">${frappe.utils.escape_html(l.target || "")}</td>
					<td style="width:25%;">${frappe.utils.escape_html(l.actual_performance || "")}</td>
					<td>
						<div class="inline-bar-wrap">
							<span class="rag-badge" style="background:${RAG_BG[rag]};color:${RAG_TEXT[rag]};">${rag || "Not Rated"}</span>
							<div class="inline-bar-bg"><div class="inline-bar-fill" style="width:${barPct}%;background:${RAG_COLORS[rag]};"></div></div>
						</div>
					</td>
					<td>${l.escalation ? '<span class="pill overdue">Escalated</span>' : ""}</td>
				</tr>
			`;
		}).join("");

		this.kpi_table_wrap.html(`
			<div class="fh-table-wrap">
				<table class="fh-table">
					<thead><tr><th>Pillar</th><th>KPI</th><th>Target</th><th>Actual</th><th>Status</th><th></th></tr></thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		`);
	},

	renderActionsTable: function (data) {
		const actions = data.actions || [];
		const funnel = data.action_status_funnel || [];

		this.action_funnel_wrap.html(
			funnel.length
				? `<div class="funnel-mini">${funnel.map(f => `<span>${f.status}: <b>${f.count}</b></span>`).join("")}</div>`
				: ""
		);

		if (!data.has_entry) {
			this.actions_table_wrap.html(`<div class="empty-state">No KPI Period Entry has been created for this review period yet.</div>`);
			return;
		}

		if (!actions.length) {
			this.actions_table_wrap.html(`<div class="empty-state">No corrective actions for this period. 🎉</div>`);
			return;
		}

		const rows = actions.map(a => `
			<tr>
				<td style="width:25%;"><a href="/app/kpi-action/${encodeURIComponent(a.name)}" target="_blank">${frappe.utils.escape_html(a.kpi_description || a.name)}</a></td>
				<td style="width:25%;">${frappe.utils.escape_html(a.action_description || "")}</td>
				<td><span class="pill ${(a.priority || "").toLowerCase()}">${a.priority || ""}</span></td>
				<td><span class="rag-badge" style="background:${RAG_BG[a.rag_status]};color:${RAG_TEXT[a.rag_status]};">${a.rag_status || ""}</span></td>
				<td>${a.status || ""}${a.is_overdue ? ' <span class="pill overdue">Overdue</span>' : ""}</td>
				<td>${frappe.datetime.str_to_user(a.due_date) || ""}</td>
				<td>${a.escalated ? '<span class="pill overdue">Escalated</span>' : ""}</td>
			</tr>
		`).join("");

		this.actions_table_wrap.html(`
			<div class="fh-table-wrap">
				<table class="fh-table">
					<thead><tr><th>KPI</th><th>Action</th><th>Priority</th><th>RAG</th><th>Status</th><th>Due</th><th></th></tr></thead>
					<tbody>${rows}</tbody>
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

	// If a previous render replaced the chart-card-body with an "empty state"
	// message, the <canvas> no longer exists in the DOM. Recreate it before
	// every render so Chart.js always has a fresh canvas to attach to.
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
