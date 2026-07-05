import frappe
from collections import defaultdict

# Worst-status-wins ordering, used both for the org-level indicator and for
# picking a dominant status per heatmap cell (mirrors the same convention
# already used per-KPI on the Function Head dashboard).
RAG_SEVERITY = {"Red": 3, "Amber": 2, "Green": 1, "": 0, None: 0}


def _scoped_departments():
	"""Departments recognised as tracked functions for TMC purposes: those
	with an assigned department head. Everything downstream (grid rows,
	heatmap columns, summary totals) is scoped to this list."""
	return frappe.get_all(
		"Department",
		filters={"custom_department_head": ["is", "set"]},
		fields=["name", "custom_department_head", "custom_department_head_name"],
		order_by="name asc",
	)


def _submitted_entries(review_period, dept_names):
	"""Only submitted (docstatus=1) KPI Period Entries count as officially
	reported for a period — a draft in progress shouldn't move the org
	numbers TMC is making decisions from."""
	if not review_period or not dept_names:
		return []
	return frappe.get_all(
		"KPI Period Entry",
		filters={
			"review_period": review_period,
			"function": ["in", dept_names],
			"docstatus": 1,
		},
		fields=[
			"name", "function", "total_kpis", "green_count", "amber_count",
			"red_count", "overall_rag", "escalation",
		],
	)


def _action_counts(review_period, dept_names):
	"""Open / overdue / escalated KPI Action counts, grouped by function."""
	counts = defaultdict(lambda: {"open": 0, "overdue": 0, "escalated": 0})
	if not review_period or not dept_names:
		return counts
	actions = frappe.get_all(
		"KPI Action",
		filters={"review_period": review_period, "function": ["in", dept_names]},
		fields=["function", "status", "is_overdue", "escalated"],
	)
	for a in actions:
		bucket = counts[a.function]
		if a.status not in ("Completed", "Cancelled"):
			bucket["open"] += 1
		if a.is_overdue:
			bucket["overdue"] += 1
		if a.escalated:
			bucket["escalated"] += 1
	return counts


def _org_overall_rag(entries):
	worst = ""
	for e in entries:
		if RAG_SEVERITY.get(e.overall_rag, 0) > RAG_SEVERITY.get(worst, 0):
			worst = e.overall_rag
	return worst


@frappe.whitelist()
def get_filter_options():
	review_periods = frappe.get_all(
		"Review Period",
		fields=["name", "review_name", "calendar_year", "review_window_start", "review_meeting_date"],
		order_by="review_window_start asc",
	)

	today = str(frappe.utils.today())
	started = [p for p in review_periods if p.review_window_start and str(p.review_window_start) <= today]
	default_review_period = started[-1].name if started else (review_periods[0].name if review_periods else None)

	scope = _scoped_departments()

	return {
		"review_periods": review_periods,
		"default_review_period": default_review_period,
		"scope_label": f"{len(scope)} Function{'s' if len(scope) != 1 else ''} in Scope",
	}


@frappe.whitelist()
def get_dashboard_data(review_period=None):
	scope = _scoped_departments()
	dept_names = [d.name for d in scope]

	entries = _submitted_entries(review_period, dept_names)
	entries_by_dept = {e.function: e for e in entries}
	action_counts = _action_counts(review_period, dept_names)

	# ---- Comparison grid: one row per scoped department ----
	grid = []
	for d in scope:
		entry = entries_by_dept.get(d.name)
		ac = action_counts.get(d.name, {"open": 0, "overdue": 0, "escalated": 0})
		grid.append({
			"function": d.name,
			"department_head_name": d.custom_department_head_name,
			"submitted": bool(entry),
			"entry_name": entry.name if entry else None,
			"total_kpis": entry.total_kpis if entry else 0,
			"green_count": entry.green_count if entry else 0,
			"amber_count": entry.amber_count if entry else 0,
			"red_count": entry.red_count if entry else 0,
			"overall_rag": entry.overall_rag if entry else "",
			"escalation": bool(entry.escalation) if entry else False,
			"open_actions": ac["open"],
			"overdue_actions": ac["overdue"],
			"escalated_actions": ac["escalated"],
		})

	# ---- Org-wide summary cards ----
	cards = {
		"total_kpis": sum(e.total_kpis or 0 for e in entries),
		"green_count": sum(e.green_count or 0 for e in entries),
		"amber_count": sum(e.amber_count or 0 for e in entries),
		"red_count": sum(e.red_count or 0 for e in entries),
		"open_actions": sum(v["open"] for v in action_counts.values()),
		"overdue_actions": sum(v["overdue"] for v in action_counts.values()),
		"overall_rag": _org_overall_rag(entries),
		"functions_reported": len(entries),
		"functions_in_scope": len(scope),
	}

	# ---- Pillar x Function heatmap ----
	pillars = frappe.get_all("Pillar", fields=["pillar"], order_by="pillar asc")
	pillar_names = [p.pillar for p in pillars]
	cell_counts = defaultdict(lambda: {"green": 0, "amber": 0, "red": 0, "not_rated": 0})

	if review_period and dept_names:
		lines = frappe.db.sql(
			"""
			select kel.pillar as pillar, kpe.function as function, kel.rag_status as rag_status
			from `tabKPI Entry Line` kel
			inner join `tabKPI Period Entry` kpe on kel.parent = kpe.name
			where kpe.review_period = %(review_period)s
				and kpe.docstatus = 1
				and kpe.function in %(dept_names)s
			""",
			{"review_period": review_period, "dept_names": dept_names},
			as_dict=True,
		)
		for l in lines:
			cell = cell_counts[(l.pillar, l.function)]
			if l.rag_status == "Green":
				cell["green"] += 1
			elif l.rag_status == "Amber":
				cell["amber"] += 1
			elif l.rag_status == "Red":
				cell["red"] += 1
			else:
				cell["not_rated"] += 1

	heatmap_rows = []
	for pillar in pillar_names:
		row_cells = []
		for d in scope:
			c = cell_counts.get((pillar, d.name))
			if not c or not any(c.values()):
				status = None  # no KPIs under this pillar for this function
			elif c["red"] > 0:
				status = "Red"
			elif c["amber"] > 0:
				status = "Amber"
			elif c["green"] > 0:
				status = "Green"
			else:
				status = ""  # KPIs exist, none rated yet
			row_cells.append({
				"function": d.name,
				"status": status,
				"counts": c or {"green": 0, "amber": 0, "red": 0, "not_rated": 0},
			})
		heatmap_rows.append({"pillar": pillar, "cells": row_cells})

	# ---- Trend over time: last 6 review periods, chronological ----
	all_periods = frappe.get_all(
		"Review Period",
		fields=["name", "review_name", "review_window_start"],
		order_by="review_window_start asc",
	)
	if review_period:
		names_in_order = [p.name for p in all_periods]
		if review_period in names_in_order:
			cutoff = names_in_order.index(review_period)
			window_periods = all_periods[max(0, cutoff - 5): cutoff + 1]
		else:
			window_periods = all_periods[-6:]
	else:
		window_periods = all_periods[-6:]

	trend = []
	for p in window_periods:
		p_entries = _submitted_entries(p.name, dept_names)
		trend.append({
			"review_period": p.name,
			"review_name": p.review_name,
			"green_count": sum(e.green_count or 0 for e in p_entries),
			"amber_count": sum(e.amber_count or 0 for e in p_entries),
			"red_count": sum(e.red_count or 0 for e in p_entries),
		})

	return {
		"cards": cards,
		"grid": grid,
		"heatmap": {
			"pillars": pillar_names,
			"functions": [{"name": d.name, "head": d.custom_department_head_name} for d in scope],
			"rows": heatmap_rows,
		},
		"trend": trend,
	}
