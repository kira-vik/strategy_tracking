# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class StrategyTrackingSettings(Document):
	def validate(self):
		self.validate_meeting_day_of_month()

	def validate_meeting_day_of_month(self):
		if self.meeting_day_of_month < 1 or self.meeting_day_of_month > 31:
			frappe.throw("Meeting Day of Month must be between 1 and 31.",
               	title="Invalid Meeting Day"
               )

