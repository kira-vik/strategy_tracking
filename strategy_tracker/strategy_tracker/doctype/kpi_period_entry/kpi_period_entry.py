# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


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

		return "HR override approved"
