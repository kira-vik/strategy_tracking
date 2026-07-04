# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime, getdate, today

class KPIAction(Document):
	
	def validate(self):
		self.set_overdue_status()
		self.log_update_time()
  
	def before_save(self):
		self.set_overdue_status()
  
	def set_overdue_status(self):
		"""
		Updates:
		- is_overdue
		- status = Overdue
		- escalated = 1
		"""

		if not self.due_date:
			return

		today_date = getdate(today())
		due_date = getdate(self.due_date)

		# Skip if already final states
		if self.status in ["Completed", "Cancelled"]:
			self.is_overdue = 0
			return

		if due_date < today_date:
			self.is_overdue = 1
			self.status = "Overdue"
			self.escalated = 1
		else:
			self.is_overdue = 0

	def log_update_time(self):
		self.last_updated = now_datetime()

@frappe.whitelist()
def bulk_update_overdue():
	docs = frappe.get_all(
		"KPI Action",
		filters={
			"status": ["not in", ["Completed", "Cancelled"]],
			"due_date": ["<", today()]
		},
		pluck="name"
	)

	for name in docs:
		doc = frappe.get_doc("KPI Action", name)
		doc.set_overdue_status()
		doc.save(ignore_permissions=True)
