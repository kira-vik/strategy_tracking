"""
Function Head Strategy Execution Dashboard — backend.

Page: fh---strategy-dash (role: Function Head)

Data model recap:
    KPI                -> registry, tied to Function + Pillar
    Review Calendar     -> generates/publishes Review Periods
    Review Period        -> one review cycle (window, deadline, meeting date)
    KPI Period Entry    -> one per Function per Review Period.
                            Carries its own rolled-up total_kpis / red_count /
                            amber_count / green_count / overall_rag fields
                            (maintained by the doctype's own controller), so
                            we read those directly instead of recomputing.
    KPI Entry Line       -> child table on KPI Period Entry (one row per KPI)
    KPI Action           -> auto-generated for Amber/Red lines on submit

NOTE ON WEIGHTING: per current scope, KPI `weight` is NOT used anywhere in
this dashboard yet — all RAG aggregation is a simple count of KPI Entry
Lines / KPI Period Entries. This can be swapped for a weighted score later
without changing the frontend contract (same field names, different values).
"""

import frappe
from frappe.utils import getdate, nowdate

ACTION_CLOSED_STATUSES = ("Completed", "Cancelled")
TREND_PERIOD_LIMIT = 6


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_session_function(function=None):
	"""
	Resolve which Department (Function) this dashboard should show.

	Normal Function Heads: derived from Department.custom_department_head.
	System Manager / HR Manager: may pass `function` explicitly to preview
	any department's dashboard.
	"""
	user = frappe.session.user

	if function and frappe.has_permission("Department", "read") and (
		"System Manager" in frappe.get_roles(user) or "HR Manager" in frappe.get_roles(user)
	):
		if frappe.db.exists("Department", function):
			return function
		frappe.throw(f"Department {function} not found")

	dept = frappe.db.get_value(
		"Department", {"custom_department_head": user}, "name"
	)
	if not dept:
		frappe.throw(
			"You are not set up as the Head of any Function/Department. "
			"Please contact HR/System Administrator.",
			frappe.PermissionError,
		)
	return dept


def _latest_entries_by_period(function, review_period_names):
	"""
	Return {review_period: entry_dict} using only the most recently created
	KPI Period Entry per period (handles amended/resubmitted entries).
	"""
	if not review_period_names:
		return {}

	rows = frappe.get_all(
		"KPI Period Entry",
		filters={"function": function, "review_period": ["in", review_period_names]},
		fields=[
			"name", "review_period", "docstatus", "creation",
			"total_kpis", "green_count", "amber_count", "red_count",
			"overall_rag", "escalation", "submission_date",
		],
		order_by="creation desc",
	)

	latest = {}
	for row in rows:
		if row.review_period not in latest:
			latest[row.review_period] = row
	return latest


# ---------------------------------------------------------------------------
# Whitelisted endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_filter_options(function=None):
	"""Bootstrap data for the page: which function, and the review period picker."""
	func = _get_session_function(function)

	review_periods = frappe.get_all(
		"Review Period",
		filters={},
		fields=[
			"name", "review_name", "review_no", "calendar_year",
			"review_window_start", "submission_deadline",
			"review_meeting_date", "status", "current_phase",
		],
		order_by="review_window_start asc",
	)

	# Default: most recent period whose window has started, else the first
	# upcoming one, else nothing.
	today = getdate(nowdate())
	started = [p for p in review_periods if p.review_window_start and getdate(p.review_window_start) <= today]
	default_period = (started[-1].name if started else (review_periods[0].name if review_periods else None))

	return {
		"function": func,
		"function_label": func,
		"review_periods": review_periods,
		"default_review_period": default_period,
	}


@frappe.whitelist()
def get_dashboard_data(review_period=None, function=None):
	"""Full data bundle for the selected review period."""
	func = _get_session_function(function)

	if not review_period:
		opts = get_filter_options(function=func)
		review_period = opts["default_review_period"]

	result = {
		"function": func,
		"review_period": review_period,
		"has_entry": False,
		"entry": None,
		"cards": {
			"total_kpis": 0, "green_count": 0, "amber_count": 0, "red_count": 0,
			"overall_rag": "", "open_actions": 0, "overdue_actions": 0,
			"escalated_actions": 0,
		},
		"kpi_lines": [],
		"pillar_breakdown": [],
		"actions": [],
		"action_status_funnel": [],
		"action_priority_matrix": [],
		"trend": [],
	}

	if not review_period:
		return result

	entry_name = frappe.db.get_value(
		"KPI Period Entry",
		{"function": func, "review_period": review_period},
		"name",
		order_by="creation desc",
	)

	if entry_name:
		entry = frappe.get_doc("KPI Period Entry", entry_name)
		result["has_entry"] = True
		result["entry"] = {
			"name": entry.name,
			"docstatus": entry.docstatus,
			"submitted_by_name": entry.submitted_by_name,
			"submission_date": entry.submission_date,
			"review_meeting_date": entry.review_meeting_date,
			"submission_deadline": entry.submission_deadline,
			"general_comments": entry.general_comments,
			"general_manager_comments": entry.general_manager_comments,
		}

		# ---- top cards: trust the doctype's own rolled-up fields ----
		result["cards"]["total_kpis"] = entry.total_kpis or 0
		result["cards"]["green_count"] = entry.green_count or 0
		result["cards"]["amber_count"] = entry.amber_count or 0
		result["cards"]["red_count"] = entry.red_count or 0
		result["cards"]["overall_rag"] = entry.overall_rag or _derive_overall_rag(
			entry.red_count, entry.amber_count, entry.green_count
		)

		# ---- KPI lines (for list + pillar breakdown) ----
		lines = frappe.get_all(
			"KPI Entry Line",
			filters={"parent": entry.name},
			fields=[
				"kpi", "kpi_description", "pillar", "target", "baseline", "weight",
				"rag_status", "actual_performance", "actual_numeric", "variance",
				"corrective_action_summary", "kpi_action", "action_created", "escalation",
			],
			order_by="pillar asc, idx asc",
		)
		result["kpi_lines"] = lines
		result["pillar_breakdown"] = _pillar_breakdown(lines)

		# ---- KPI Actions tied to this entry ----
		actions = frappe.get_all(
			"KPI Action",
			filters={"kpi_period_entry": entry.name},
			fields=[
				"name", "kpi_name", "kpi_description", "kpi_reference", "action_description",
				"action_owner", "priority", "status", "rag_status",
				"start_date", "due_date", "escalated", "last_updated",
			],
			order_by="priority asc, due_date asc",
		)
		today = getdate(nowdate())
		for a in actions:
			a["is_overdue"] = bool(
				a.due_date and getdate(a.due_date) < today
				and a.status not in ACTION_CLOSED_STATUSES
			)
		result["actions"] = actions

		result["cards"]["open_actions"] = sum(
			1 for a in actions if a.status not in ACTION_CLOSED_STATUSES
		)
		result["cards"]["overdue_actions"] = sum(1 for a in actions if a["is_overdue"])
		result["cards"]["escalated_actions"] = sum(1 for a in actions if a.escalated)

		result["action_status_funnel"] = _status_funnel(actions)
		result["action_priority_matrix"] = _priority_matrix(actions)

	# ---- trend across periods (independent of whether current entry exists) ----
	result["trend"] = _build_trend(func, review_period)

	return result


# ---------------------------------------------------------------------------
# Aggregation helpers
# ---------------------------------------------------------------------------

def _derive_overall_rag(red, amber, green):
	if red:
		return "Red"
	if amber:
		return "Amber"
	if green:
		return "Green"
	return ""


def _pillar_breakdown(lines):
	buckets = {}
	for line in lines:
		pillar = line.pillar or "Unassigned"
		b = buckets.setdefault(pillar, {"pillar": pillar, "green": 0, "amber": 0, "red": 0, "not_rated": 0})
		status = (line.rag_status or "").lower()
		if status == "green":
			b["green"] += 1
		elif status == "amber":
			b["amber"] += 1
		elif status == "red":
			b["red"] += 1
		else:
			b["not_rated"] += 1
	return list(buckets.values())


def _status_funnel(actions):
	order = ["Not Started", "In Progress", "Completed", "Overdue", "Cancelled"]
	counts = {s: 0 for s in order}
	for a in actions:
		st = a.status or "Not Started"
		if st not in counts:
			counts[st] = 0
		counts[st] += 1
	return [{"status": s, "count": counts[s]} for s in order if counts[s]]


def _priority_matrix(actions):
	priorities = ["High", "Medium", "Low"]
	statuses = ["Not Started", "In Progress", "Completed", "Overdue"]
	matrix = {p: {s: 0 for s in statuses} for p in priorities}
	for a in actions:
		p = a.priority if a.priority in priorities else "Medium"
		s = a.status if a.status in statuses else "Not Started"
		matrix[p][s] += 1
	return [{"priority": p, **matrix[p]} for p in priorities]


def _build_trend(function, current_review_period):
	"""
	Last N review periods up to and including the selected one, chronological,
	using each period's rolled-up KPI Period Entry totals (no child-table scan).
	"""
	periods = frappe.get_all(
		"Review Period",
		fields=["name", "review_name", "review_window_start", "review_meeting_date"],
		order_by="review_window_start asc",
	)

	names_in_order = [p.name for p in periods]
	if current_review_period in names_in_order:
		cutoff = names_in_order.index(current_review_period) + 1
		window = periods[max(0, cutoff - TREND_PERIOD_LIMIT):cutoff]
	else:
		window = periods[-TREND_PERIOD_LIMIT:]

	window_names = [p.name for p in window]
	entries_by_period = _latest_entries_by_period(function, window_names)

	trend = []
	for p in window:
		e = entries_by_period.get(p.name)
		trend.append({
			"review_period": p.name,
			"review_name": p.review_name,
			"has_entry": bool(e),
			"total_kpis": (e.total_kpis if e else 0) or 0,
			"green_count": (e.green_count if e else 0) or 0,
			"amber_count": (e.amber_count if e else 0) or 0,
			"red_count": (e.red_count if e else 0) or 0,
		})
	return trend
