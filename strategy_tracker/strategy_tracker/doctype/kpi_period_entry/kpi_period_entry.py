# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime, getdate


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
