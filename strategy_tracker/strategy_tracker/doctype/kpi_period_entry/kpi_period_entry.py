# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class KPIPeriodEntry(Document):
	def validate(self):
		pass


	def before_submit(self):
		self.validate_review_period_status()


	def validate_review_period_status(self):
		period = frappe.get_doc("Review Period", self.review_period)
		today = getdate()

		# --- HARD BLOCK: Closed lifecycle states ---
		if period.status in ["Locked", "Completed"]:
			if not self.allow_hr_override:
				frappe.throw(
					"This review period is closed for KPI Period Entry submissions."
				)

		# --- DEADLINE BLOCK ---
		if today > getdate(period.submission_deadline):
			if not self.allow_hr_override:
				frappe.throw(
					"Submission deadline has passed for this review period."
				)
