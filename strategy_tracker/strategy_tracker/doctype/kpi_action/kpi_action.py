# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class KPIAction(Document):
	
	def validate(self):
		self.log_update_time()

	def log_update_time(self):
		self.last_updated = now_datetime()
