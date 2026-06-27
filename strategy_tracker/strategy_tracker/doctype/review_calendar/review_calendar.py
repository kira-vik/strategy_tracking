# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate, now, formatdate, now_datetime
from datetime import timedelta


class ReviewCalendar(Document):

	def validate(self):
		"""Validate Review Calendar before saving."""

		# --------------------------------------------------------
		# Prevent duplicate calendars for the same year
		# --------------------------------------------------------
		existing = frappe.db.exists(
			"Review Calendar",
			{
				"calendar_year": self.calendar_year,
				"name": ["!=", self.name],
			},
		)

		if existing:
			frappe.throw(
				f"A Review Calendar already exists for the year {self.calendar_year}. "
				"Please choose another calendar year.",
				title="Duplicate Calendar",
			)

		# --------------------------------------------------------
		# Ensure calendar dates are present
		# --------------------------------------------------------
		if self.calendar_start_date and self.calendar_end_date:
			if getdate(self.calendar_start_date) >= getdate(self.calendar_end_date):
				frappe.throw(
				"Calendar End Date must be after Calendar Start Date.",
				title="Invalid Calendar Dates",
				)

		# --------------------------------------------------------
		# Validate first review meeting date
		# --------------------------------------------------------
		if self.first_review_meeting_date:

			review_date = getdate(self.first_review_meeting_date)

			# Must belong to selected calendar year
			if review_date.year != int(self.calendar_year):
				frappe.throw(
				"The First Review Meeting Date must fall within the selected Calendar Year.",
				title="Invalid Review Date",
				)

			# Tuesday = weekday 1
			if review_date.weekday() != 1:
				frappe.throw(
				"The First Review Meeting Date must be a Tuesday.",
				title="Invalid Review Meeting Day",
				)


	def on_submit(self):
		"""
		Prevent submission unless review periods have been generated
		and published.
		"""

		# --------------------------------------------------------
		# Must have generated the calendar first
		# --------------------------------------------------------
		if not self.review_calendar_generated:
			frappe.throw(
				"You must generate the Review Calendar before submitting.",
				title="Review Calendar Not Generated",
			)

		# --------------------------------------------------------
		# Must have published review periods
		# --------------------------------------------------------
		if not self.review_periods_published:
			frappe.throw(
				"You must publish Review Periods before submitting the calendar.",
				title="Review Periods Not Published",
			)


	def on_cancel(self):
		"""
		Clean up all Review Periods when calendar is cancelled.
		"""

		self.clear_review_periods()


	@frappe.whitelist()
	def generate_review_calendar(self):
		"""
		Generate biweekly review schedule anchored on first_review_meeting_date.

		Rules:
		- Review meetings are every 14 days (Tuesday → Tuesday)
		- Submission deadline = Monday before review meeting
		- Review window starts = previous review meeting + 1 day
		- First window starts = calendar_start_date
		- Only 1 spillover review (first review meeting in next year)
		"""

		# --------------------------------------------------------
		# Safety checks
		# --------------------------------------------------------
		if self.is_new():
			frappe.throw("Please save the Review Calendar before generating.")

		if self.review_calendar_generated:
			frappe.throw("Review Calendar has already been generated.")

		if not self.first_review_meeting_date:
			frappe.throw("Please set First Review Meeting Date.")

		if not self.calendar_year:
			frappe.throw("Please set Calendar Year.")

		# --------------------------------------------------------
		# Clear existing rows
		# --------------------------------------------------------
		self.set("review_dates", [])

		first_review = getdate(self.first_review_meeting_date)
		calendar_start = getdate(self.calendar_start_date)

		current_review = first_review
		previous_review = None

		review_no = 1
		spillover_added = False

		last_review_in_year = None

		# --------------------------------------------------------
		# Generation loop
		# --------------------------------------------------------
		while True:

			# ----------------------------------------------------
			# Stop condition:
			# allow ONLY one spillover review into next year
			# ----------------------------------------------------
			if current_review.year > int(self.calendar_year):

				if spillover_added:
					break

				spillover = True
				spillover_added = True

			else:
				spillover = False

			# ----------------------------------------------------
			# Submission deadline = Monday before review meeting
			# ----------------------------------------------------
			submission_deadline = current_review - timedelta(days=1)

			# ----------------------------------------------------
			# Window start logic
			# ----------------------------------------------------
			if previous_review:
				window_start = previous_review + timedelta(days=1)
			else:
				window_start = calendar_start

			# ----------------------------------------------------
			# Label
			# ----------------------------------------------------
			review_label = f"Review {review_no} ({current_review.strftime('%d %b %Y')})"

			# ----------------------------------------------------
			# Quarter
			# ----------------------------------------------------
			month = current_review.month
			if month <= 3:
				quarter = "Q1"
			elif month <= 6:
				quarter = "Q2"
			elif month <= 9:
				quarter = "Q3"
			else:
				quarter = "Q4"

			# ----------------------------------------------------
			# Append row
			# ----------------------------------------------------
			self.append("review_dates", {
				"review_no": review_no,
				"review_label": review_label,
				"review_window_start": window_start,
				"submission_deadline": submission_deadline,
				"review_meeting_date": current_review,
				"quarter": quarter,
				"calendar_year": current_review.year,
				"spillover": 1 if spillover else 0
			})

			# Track last valid review in base year
			if current_review.year == int(self.calendar_year):
				last_review_in_year = current_review

			# ----------------------------------------------------
			# Move forward
			# ----------------------------------------------------
			previous_review = current_review
			current_review = current_review + timedelta(days=14)
			review_no += 1

		# --------------------------------------------------------
		# Metadata
		# --------------------------------------------------------
		self.last_review_meeting_date = last_review_in_year or first_review
		self.spillover_meeting = previous_review if spillover_added else None

		self.review_calendar_generated = 1
		self.generated_on = now()
		self.generated_by = frappe.session.user

		self.save()


	@frappe.whitelist()
	def publish_review_periods(self):
		"""
		Publishes the review calendar:
		- submits the calendar (locks structure)
		- creates Review Period records
		- prevents regeneration
		"""

		# -----------------------------------------------------
		# 1. Guard clauses
		# -----------------------------------------------------
		if self.docstatus != 0:
			frappe.throw("Only draft calendars can be published.")

		if not self.review_dates:
			frappe.throw("No review periods to publish.")

		if self.review_periods_published:
			frappe.throw("Review periods already published.")

		created = 0
		skipped = 0

		# -----------------------------------------------------
		# 2. Create Review Periods
		# -----------------------------------------------------
		for row in self.review_dates:

			exists = frappe.db.exists(
				"Review Period",
				{
				"calendar": self.name,
				"review_no": row.review_no
				}
			)

			if exists:
				skipped += 1
				continue

			period = frappe.get_doc({
				"doctype": "Review Period",
				"review_name": f"Review {row.review_no} ({row.review_meeting_date})",
				"review_no": row.review_no,
				"calendar": self.name,

				"review_window_start": row.review_window_start,
				"submission_deadline": row.submission_deadline,
				"review_meeting_date": row.review_meeting_date,

				"calendar_year": self.calendar_year,

				"status": "Upcoming"
			})

			period.insert(ignore_permissions=True)
			created += 1

		# -----------------------------------------------------
		# 3. Mark calendar as published
		# -----------------------------------------------------
		self.review_periods_published = 1
		self.published_on = now_datetime()
		self.published_by = frappe.session.user

		# -----------------------------------------------------
		# 4. Submit calendar (locks it permanently)
		# -----------------------------------------------------
		self.save()
		self.submit()

		frappe.db.commit()

		return {
			"created": created,
			"skipped": skipped
		}


	@frappe.whitelist()
	def get_calendar_summary(self):
		"""
		Returns a human-readable summary of the review calendar.
		Used for dashboards, banners, and UI hints.
		"""

		if not self.review_calendar_generated:
			return "Review Calendar has not been generated yet."

		if not self.review_dates:
			return "No review periods found in this calendar."

		total_reviews = len(self.review_dates)

		# Ensure we safely convert strings → date objects
		first_review = getdate(self.review_dates[0].review_meeting_date)
		last_review = getdate(self.review_dates[-1].review_meeting_date)

		spillovers = len([
			r for r in self.review_dates
			if r.spillover
		])

		summary = (
			f"This calendar contains {total_reviews} review periods. "
			f"It starts on {formatdate(first_review)} "
			f"and ends on {formatdate(last_review)}."
		)

		if spillovers:
			summary += f" Includes {spillovers} spillover review period(s) into the next year."

		return summary


	def clear_review_periods(self):
		"""
		Deletes all Review Periods linked to this Review Calendar.
		Used when cancelling or resetting the calendar.
		"""

		try:
			# --------------------------------------------------------
			# Fetch all linked Review Periods
			# --------------------------------------------------------
			periods = frappe.get_all(
				"Review Period",
				filters={"calendar": self.name},
				fields=["name"]
			)

			# --------------------------------------------------------
			# Delete each Review Period
			# --------------------------------------------------------
			deleted_count = 0

			for p in periods:
				doc = frappe.get_doc("Review Period", p.name)
				doc.delete(ignore_permissions=True)
				deleted_count += 1

			# --------------------------------------------------------
			# Optional user feedback
			# --------------------------------------------------------
			frappe.msgprint(
				f"Deleted {deleted_count} Review Period(s) linked to this calendar.",
				title="Cleanup Successful"
			)

		except Exception as e:
			frappe.msgprint(
				f"Error while deleting Review Periods: {str(e)}",
				title="Cleanup Failed"
			)
