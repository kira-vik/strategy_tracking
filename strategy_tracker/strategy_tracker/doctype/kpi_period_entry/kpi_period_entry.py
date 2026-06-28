# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime, getdate


class KPIPeriodEntry(Document):
	def validate(self):
		self.prevent_duplicates()
		self.calculate_summary()

	def before_submit(self):
		self.validate_review_period_status()
		self.calculate_summary()
		self.validate_kpi_rows()
		self.set_submission_metadata()
		self.create_kpi_actions()
  
	# def on_submit(self):
	# 	self.db_update()
  
	def prevent_duplicates(self):
		if not (self.review_period and self.function):
			return

		exists = frappe.db.exists(
			"KPI Period Entry",
			{
				"review_period": self.review_period,
				"function": self.function,
				"name": ["!=", self.name]
			}
		)

		if exists:
			frappe.throw(
				f"A KPI Period Entry already exists for this Function in this Review Period.",
				title="Duplicate Entry Blocked"
			)


	def validate_review_period_status(self):
		period = frappe.get_doc("Review Period", self.review_period)
		today = getdate()

		# --- HARD BLOCK: Closed lifecycle states ---
		if period.status in ["Locked", "Completed"]:
			if not self.hr_override_approved:
				frappe.throw(
					"This review period is closed for KPI Period Entry submissions. Kindly contact HR for assistance.",
					title="Submission Blocked"
				)

		# --- DEADLINE BLOCK ---
		if today > getdate(period.submission_deadline):
			if not self.hr_override_approved:
				frappe.throw(
					"Submission deadline has passed for this review period. Kindly contact HR for assistance.",
					title="Submission Blocked"
				)

	@frappe.whitelist()
	def approve_hr_override(self, reason):

		user_roles = frappe.get_roles(frappe.session.user)

		# allow HR Manager, System Manager, or Administrator
		allowed_roles = {"HR Manager", "System Manager"}

		if not (allowed_roles.intersection(user_roles) or frappe.session.user == "Administrator"):
			frappe.throw("Not authorized")

		# prevent duplicate override
		if self.hr_override_approved:
			frappe.throw("Override already approved")

		self.hr_override_approved = 1
		self.override_reason = reason
		self.override_by = frappe.session.user
		self.override_timestamp = now_datetime()

		self.save(ignore_permissions=True)
  
		# audit log
		frappe.get_doc({
			"doctype": "KPI Entry Submission Override Log",
			"kpi_period_entry_record": self.name,
			"reason": reason,
			"approved_by": frappe.session.user,
			"timestamp": now_datetime()
		}).insert(ignore_permissions=True)

		return "HR override approved"

	@frappe.whitelist()
	def fetch_kpis(self, function):
		"""
		Fetch active KPIs for a given function (Department)
		"""

		if not function:
			frappe.throw("Function is required to fetch KPIs")

		kpis = frappe.get_all(
		"KPI",
		filters={
			"function": function,
			"active": 1
		},
		fields=[
			"name",
			"kpi_name",
			"pillar",
			"target",
			"baseline",
			"weight"
		]
		)

		rows = []

		for kpi in kpis:
			rows.append({
				"kpi": kpi.name,
				"pillar": kpi.pillar,
				"weight": kpi.weight,
				"target": kpi.target,
				"baseline": kpi.baseline,
				"actual_performance": "",
				"actual_numeric": None,
				"variance": "",
				"rag_status": None,
				"corrective_action_summary": "",
				"escalation": 0
			})

		return rows

	def validate_kpi_rows(self):
		"""
		Ensure all Red/Amber KPIs have corrective actions
		"""

		for row in self.kpi_reviews:

			if row.rag_status in ["Red", "Amber"]:

				if not row.corrective_action_summary:
					frappe.throw(
					f"KPI '{row.kpi}' requires a corrective action summary because it is {row.rag_status}"
					)
     
	def set_submission_metadata(self):
		self.submitted_by = frappe.session.user
		self.submitted_by_name = frappe.db.get_value(
			"User", self.submitted_by, "full_name"
		)
		self.submission_date = now_datetime()
  
	def create_kpi_actions(self):

		for row in self.kpi_reviews:

			# Only Red/Amber require actions
			if row.rag_status not in ["Red", "Amber"]:
				continue

			if not row.corrective_action_summary:
				continue

			# --------------------------------------------------
			# 1. Check if action already exists - idempotency key
			# --------------------------------------------------
			existing_action = frappe.db.get_value(
				"KPI Action",
				{
					"kpi_period_entry": self.name,
					"kpi_entry_line_id": row.name
				},
				"name"
			)

			# --------------------------------------------------
			# 2. UPDATE existing action (NOT duplicate)
			# --------------------------------------------------
			if existing_action:

				action = frappe.get_doc("KPI Action", existing_action)

				action.action_description = row.corrective_action_summary
				action.rag_status = row.rag_status
				action.escalated = row.escalation or 0

				# Optional: keep status fresh
				action.status = "In Progress"

				action.save(ignore_permissions=True)

				row.kpi_action = action.name
				row.action_created = 1

				continue

			# --------------------------------------------------
			# 3. CREATE new action if none exists
			# --------------------------------------------------
			action = frappe.get_doc({
				"doctype": "KPI Action",

				"review_period": self.review_period,
				"kpi_period_entry": self.name,
				"kpi_entry_line_id": row.name,

				"kpi_reference": row.kpi,
				"kpi_name": getattr(row, "kpi_name", row.kpi),

				"function": self.function,

				"action_description": row.corrective_action_summary,

				"priority": "High" if row.rag_status == "Red" else "Medium",

				"rag_status": row.rag_status,

				"status": "Not Started",

				"escalated": row.escalation or 0
			})

			action.insert(ignore_permissions=True)

			row.kpi_action = action.name
			row.action_created = 1

		# persist child updates safely
		self.db_update()

	def calculate_summary(self):
		red = 0
		amber = 0
		green = 0
		escalation = False

		for row in self.kpi_reviews:

			if row.rag_status == "Red":
				red += 1
			elif row.rag_status == "Amber":
				amber += 1
			elif row.rag_status == "Green":
				green += 1

			if row.escalation or row.rag_status == "Red":
				escalation = True

		self.total_kpis = len(self.kpi_reviews)
		self.red_count = red
		self.amber_count = amber
		self.green_count = green
		self.escalation = 1 if escalation else 0

		if red > 0:
			self.overall_rag = "Red"
		elif amber > 0:
			self.overall_rag = "Amber"
		else:
			self.overall_rag = "Green"
