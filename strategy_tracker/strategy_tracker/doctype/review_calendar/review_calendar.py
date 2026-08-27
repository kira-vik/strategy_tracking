# Copyright (c) 2026, V W and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now, formatdate, now_datetime, cint
from datetime import date, timedelta
import calendar
from calendar import monthrange


class ReviewCalendar(Document):

	def validate(self):
		"""Validate Review Calendar before saving."""

		# --------------------------------------------------------
		# Prevent overlapping review calendars
		# --------------------------------------------------------
		overlapping = frappe.db.sql(
			"""
			SELECT name
			FROM `tabReview Calendar`
			WHERE name != %s
				AND calendar_start_date <= %s
				AND calendar_end_date >= %s
			LIMIT 1
			""",
			(
				self.name,
				self.calendar_end_date,
				self.calendar_start_date,
			),
		)

		if overlapping:
			frappe.throw(
				f"This review calendar overlaps with {overlapping[0][0]}. "
				"Review calendar periods cannot overlap.",
				title="Overlapping Calendar",
			)

		# --------------------------------------------------------
		# Ensure calendar dates are valid
		# --------------------------------------------------------
		if self.calendar_start_date and self.calendar_end_date:
			if getdate(self.calendar_start_date) >= getdate(self.calendar_end_date):
				frappe.throw(
					"Calendar End Date must be after Calendar Start Date.",
					title="Invalid Calendar Dates",
				)

		# --------------------------------------------------------
		# Ensure all key dates fall on weekdays
		# --------------------------------------------------------
		for fieldname, label in [
			("calendar_start_date", "Review Calendar Start"),
			("calendar_end_date", "Review Calendar End"),
			("first_scheduled_review_meeting", "First Scheduled Review Meeting"),
		]:

			value = self.get(fieldname)

			if value and self._is_weekend(value):
				frappe.throw(
					_("{0} must fall on a weekday (Monday to Friday).").format(label),
					title=_("Weekend Date"),
				)

		# --------------------------------------------------------
		# Validate first scheduled review meeting
		# --------------------------------------------------------
		if self.first_scheduled_review_meeting:

			review_date = getdate(self.first_scheduled_review_meeting)

			# Must belong to selected calendar year
			if review_date.year != cint(self.calendar_year):
				frappe.throw(
					"The First Scheduled Review Meeting must fall within the selected Calendar Year.",
					title="Invalid Review Date",
				)

			settings = frappe.get_cached_doc("Strategy Tracking Settings")

			if settings.review_frequency in ["Weekly", "Biweekly"]:

				if review_date.strftime("%A") != settings.meeting_weekday:
					frappe.throw(
						_("The First Scheduled Review Meeting must be a {0}.")
						.format(settings.meeting_weekday),
						title="Invalid Review Meeting Day",
					)

			# elif settings.review_frequency == "Monthly":

			# 	if review_date.day != cint(settings.meeting_day_of_month):
			# 		frappe.throw(
			# 			_("The First Scheduled Review Meeting must fall on day {0} of the month.")
			# 			.format(settings.meeting_day_of_month),
			# 			title="Invalid Review Meeting Day",
			# 		)

	def on_submit(self):
		if not self.review_calendar_generated:
			frappe.throw("You must generate the Review Calendar before submitting.")

		if not self.review_periods_published:
			frappe.throw("You must publish Review Periods before submitting the calendar.")

	def on_cancel(self):
		self.clear_review_periods()

	@frappe.whitelist()
	def check_spillover_meeting_exists(self, meeting_date, current_doc=None):
		return frappe.db.exists(
			"Review Calendar",
			{
				"spillover_meeting": meeting_date,
				"name": ["!=", current_doc] if current_doc else None
			}
		)

	@frappe.whitelist()
	def generate_review_calendar(self):
		# --------------------------------------------------------
		# Safety checks
		# --------------------------------------------------------
		if self.is_new():
			frappe.throw(_("Please save the Review Calendar before generating."))

		if self.review_calendar_generated:
			frappe.throw(_("Review Calendar has already been generated."))

		if not self.first_scheduled_review_meeting:
			frappe.throw(_("Please set the First Scheduled Review Meeting."))

		if not self.calendar_year:
			frappe.throw(_("Please set the Calendar Year."))

		if not self.calendar_start_date:
			frappe.throw(_("Please set the Calendar Start Date."))

		if not self.calendar_end_date:
			frappe.throw(_("Please set the Calendar End Date."))
   
		if getdate(self.calendar_end_date) < getdate(self.calendar_start_date):
			frappe.throw(_("Review Calendar End Date cannot be earlier than the Review Calendar Start Date."))

		if getdate(self.first_scheduled_review_meeting) > getdate(self.calendar_end_date):
			frappe.throw(_("First Scheduled Review Meeting Date cannot be after the Review Calendar End Date."))

		self.set("review_dates", [])

		# --------------------------------------------------------
		# Load schedule
		# --------------------------------------------------------
		schedule = self._get_schedule_settings()
		self.review_frequency = schedule["frequency"]

		first_review = getdate(self.first_scheduled_review_meeting)
		calendar_start = getdate(self.calendar_start_date)
		calendar_end = getdate(self.calendar_end_date)

		self._validate_first_review_meeting(first_review, schedule)

		current_review = first_review
		previous_review = None

		review_no = 1
		spillover_added = False
		last_review_in_year = None

		# --------------------------------------------------------
		# Generation loop
		# --------------------------------------------------------
		while True:

			if current_review > calendar_end:

				if spillover_added:
					break

				spillover = True
				spillover_added = True

			else:
				spillover = False

			# ----------------------------------------------------
			# Submission deadline
			# ----------------------------------------------------
			# submission_deadline = current_review - timedelta(days=1)
			submission_deadline = self._calculate_submission_deadline(
				current_review,
				schedule["submission_deadline_days_before"]
			)

			# ----------------------------------------------------
			# Window start
			# ----------------------------------------------------
			if previous_review:
				window_start = previous_review + timedelta(days=1)
			else:
				window_start = calendar_start
    
			if submission_deadline < window_start:
				frappe.throw(
					_(
						"Submission deadline for Review {0} cannot fall before the review period start date.<br><br>"
						"Review Period Start: {1}<br>"
						"Submission Deadline: {2}"
					).format(
						review_no,
						formatdate(window_start),
						formatdate(submission_deadline)
					),
					title=_("Invalid Submission Deadline")
				)

			review_label = f"Review {review_no} ({current_review.strftime('%d %b %Y')})"

			month = current_review.month
			if month <= 3:
				quarter = "Q1"
			elif month <= 6:
				quarter = "Q2"
			elif month <= 9:
				quarter = "Q3"
			else:
				quarter = "Q4"

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

			if current_review <= calendar_end:
				last_review_in_year = current_review

			previous_review = current_review

			current_review = self._calculate_next_review_meeting(
				current_review,
				schedule
			)

			review_no += 1

		self.last_review_meeting_date = last_review_in_year or first_review
		self.spillover_meeting = previous_review if spillover_added else None

		self.review_calendar_generated = 1
		self.generated_on = now()
		self.generated_by = frappe.session.user

		self.save()

	@frappe.whitelist()
	def publish_review_periods(self):

		if self.docstatus != 0:
			frappe.throw("Only draft calendars can be published.")

		if not self.review_dates:
			frappe.throw("No review periods to publish.")

		if self.review_periods_published:
			frappe.throw("Review periods already published.")

		created = 0
		skipped = 0

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

			doc = frappe.get_doc({
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

			doc.insert(ignore_permissions=True)
			created += 1

		self.review_periods_published = 1
		self.published_on = now_datetime()
		self.published_by = frappe.session.user

		self.save()
		self.submit()

		frappe.db.commit()

		return {"created": created, "skipped": skipped}

	def clear_review_periods(self):

		periods = frappe.get_all(
			"Review Period",
			filters={"calendar": self.name},
			fields=["name"]
		)

		for p in periods:
			frappe.delete_doc("Review Period", p.name, ignore_permissions=True)

	# --------------------------------------------------------
	# HELPERS
	# --------------------------------------------------------
	def _is_weekend(self, value):
		"""Return True if the supplied date falls on a weekend."""
		return getdate(value).weekday() >= 5

	def _get_next_weekday(self, value):
		"""Return the next weekday (Monday-Friday)."""
		d = getdate(value)

		while d.weekday() >= 5:
			d += timedelta(days=1)

		return d

	def _get_previous_weekday(self, value):
		"""Return the previous weekday (Monday-Friday)."""
		d = getdate(value)

		while d.weekday() >= 5:
			d -= timedelta(days=1)

		return d

	def _calculate_submission_deadline(self, review_date, days_before):
		"""
		Calculate submission deadline based on configured offset.
		If the deadline falls on a weekend, move it back to the nearest Friday.
		"""

		deadline = getdate(review_date) - timedelta(days=days_before)

		while deadline.weekday() >= 5:
			deadline -= timedelta(days=1)

		return deadline

	def _get_schedule_settings(self):

		settings = frappe.get_cached_doc("Strategy Tracking Settings")

		return {
			"frequency": settings.review_frequency,
			"meeting_weekday": settings.meeting_weekday,
			"meeting_day": settings.meeting_day_of_month,
			"submission_deadline_days_before": cint(
				settings.submission_deadline_days_before or 1
			),
		}

	def _validate_first_review_meeting(self, first_review, schedule):

		if self._is_weekend(first_review):
			frappe.throw(
				_("The First Scheduled Review Meeting must fall on a weekday (Monday to Friday).")
			)

		frequency = schedule["frequency"]

		if frequency == "Monthly":
       
			expected_date = self._get_monthly_review_date(
				first_review.year,
				first_review.month,
				schedule["meeting_day"],
			)

			# if first_review.day != schedule["meeting_day"]:
			# 	frappe.throw(
			# 		f"The First Scheduled Review Meeting must fall on day {schedule['meeting_day']} of the month."
			# 	)
			if first_review != expected_date:
				frappe.throw(
					_(
					"The First Scheduled Review Meeting should be {0} "
					"based on the configured monthly meeting day."
					).format(formatdate(expected_date)),
					title=_("Invalid Review Meeting Date"),
				)

		else:

			if first_review.strftime("%A") != schedule["meeting_weekday"]:
				frappe.throw(
					f"The First Scheduled Review Meeting must be a {schedule['meeting_weekday']}."
				)

	def _calculate_next_review_meeting(self, current_review, schedule):

		frequency = schedule["frequency"]

		if frequency == "Weekly":
			return current_review + timedelta(days=7)

		elif frequency == "Biweekly":
			return current_review + timedelta(days=14)

		elif frequency == "Monthly":

			year = current_review.year
			month = current_review.month + 1

			if month > 12:
				month = 1
				year += 1
    
			return self._get_monthly_review_date(
					year,
					month,
					schedule["meeting_day"],
				)

			# day = schedule["meeting_day"]
			# last_day = monthrange(year, month)[1]

			# meeting = date(year, month, min(day, last_day))
			# return self._get_next_weekday(meeting)

		frappe.throw(_("Unsupported review frequency: {0}").format(frequency))
  
	@frappe.whitelist()
	def get_initial_review_meeting(self, calendar_start_date):
		"""
		Return first valid review meeting after calendar start date.
		"""

		if not calendar_start_date:
			return None

		start_date = getdate(calendar_start_date)

		settings = frappe.get_cached_doc("Strategy Tracking Settings")

		frequency = settings.review_frequency

		if frequency == "Monthly":
			return self._get_monthly_review_date(
				start_date.year,
				start_date.month + 1,
				settings.meeting_day_of_month,
			)

			# day = cint(settings.meeting_day_of_month)

			# year = start_date.year
			# month = start_date.month

			# # if start_date.day >= day:
			# if start_date:
			# 	month += 1
			# 	if month > 12:
			# 		month = 1
			# 		year += 1

			# last_day = calendar.monthrange(year, month)[1]

			# meeting = date(year, month, min(day, last_day))
   
			# return self._get_next_weekday(meeting)

		else:

			weekday_map = {
				"Monday": 0,
				"Tuesday": 1,
				"Wednesday": 2,
				"Thursday": 3,
				"Friday": 4,
				"Saturday": 5,
				"Sunday": 6,
			}

			target = weekday_map.get(settings.meeting_weekday)

			days_until = (target - start_date.weekday()) % 7

			if days_until == 0:
				days_until = 7

			return start_date + timedelta(days=days_until)

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

		first_review = getdate(self.review_dates[0].review_meeting_date)
		last_review = getdate(self.review_dates[-1].review_meeting_date)

		spillovers = len([
			r for r in self.review_dates
			if r.spillover
		])

		summary = (
			f"This calendar contains {total_reviews} review periods. "
			f"The first review meeting is on {formatdate(first_review)}, "
			f"and the last one is on {formatdate(last_review)}."
		)

		if spillovers:
			summary += f" It includes {spillovers} spillover review period(s)."

		return summary

	def _get_monthly_review_date(self, year, month, meeting_day):
		last_day = monthrange(year, month)[1]
		meeting = date(year, month, min(cint(meeting_day), last_day))

		return self._get_next_weekday(meeting)
