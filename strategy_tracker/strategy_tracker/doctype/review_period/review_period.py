# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class ReviewPeriod(Document):
	pass


@frappe.whitelist()
def sync_review_periods():
	"""
	Master scheduler:
	Updates status + current_phase for all review periods.
	"""

	today = getdate()

	periods = frappe.get_all(
		"Review Period",
		fields=[
			"name",
			"review_window_start",
			"submission_deadline",
			"review_meeting_date",
			"status",
			"current_phase"
		]
	)

	for p in periods:
		start = getdate(p.review_window_start)
		end = getdate(p.submission_deadline)
		meeting = getdate(p.review_meeting_date)

		new_status = p.status
		new_phase = p.current_phase

		# -------------------------
		# 1. Upcoming / Planning
		# -------------------------
		if today < start:
			new_status = "Upcoming"
			new_phase = "Planning"

		# -------------------------
		# 2. Active / Open
		# -------------------------
		elif start <= today <= end:
			new_status = "Active"
			new_phase = "Open for KPI Submission"

			# soft state
			days_left = (end - today).days
			if days_left <= 2:
				new_phase = "Open for KPI Submission"

		# -------------------------
		# 3. Locked / Closed
		# -------------------------
		elif today <= meeting:
			new_status = "Locked"
			new_phase = "Submission Closed"

		# -------------------------
		# 4. Meeting Day
		# -------------------------
		elif today == meeting:
			new_status = "In Review"
			new_phase = "Meeting Due"

		# -------------------------
		# 5. Completed
		# -------------------------
		elif today > meeting:
			new_status = "Completed"
			new_phase = "Completed"

		# -------------------------
		# Apply only if changed
		# -------------------------
		if new_status != p.status or new_phase != p.current_phase:
			doc = frappe.get_doc("Review Period", p.name)
			doc.status = new_status
			doc.current_phase = new_phase
			doc.save(ignore_permissions=True)
