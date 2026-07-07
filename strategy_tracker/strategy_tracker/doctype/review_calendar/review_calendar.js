// Copyright (c) 2026, V W and contributors
// For license information, please see license.txt

// --------------------------------------------------------
// Date helpers
// --------------------------------------------------------
function isWeekend(date) {
	const d = new Date(date);
	return d.getDay() === 0 || d.getDay() === 6;
}

function getNextWeekday(date) {
	const d = new Date(date);

	while (d.getDay() === 0 || d.getDay() === 6) {
		d.setDate(d.getDate() + 1);
	}

	return frappe.datetime.obj_to_str(d);
}

function getPreviousWeekday(date) {
	const d = new Date(date);

	while (d.getDay() === 0 || d.getDay() === 6) {
		d.setDate(d.getDate() - 1);
	}

	return frappe.datetime.obj_to_str(d);
}

function validateWeekday(frm, fieldname, label) {

	const value = frm.doc[fieldname];

	if (!value || !isWeekend(value)) {
		return true;
	}

	const suggested = getNextWeekday(value);

	frappe.confirm(
		`${label} cannot fall on a weekend.<br><br>
		The next available weekday is:<br>
		<b>${frappe.datetime.str_to_user(suggested)}</b><br><br>
		Would you like to use this date?`,

		() => frm.set_value(fieldname, suggested),

		() => frm.set_value(fieldname, null)
	);

	return false;
}
frappe.ui.form.on("Review Calendar", {

	// --------------------------------------------------------
	// Auto-fill calendar start/end dates
	// --------------------------------------------------------
	calendar_year: function (frm) {

		if (!frm.doc.calendar_year) {
			frm.set_value("calendar_start_date", null);
			frm.set_value("calendar_end_date", null);
			return;
		}

		const year = frm.doc.calendar_year;

		frm.set_value(
			"calendar_start_date",
			getNextWeekday(`${year}-01-01`)
		);

		frm.set_value(
			"calendar_end_date",
			getPreviousWeekday(`${year}-12-31`)
		);
	},

	// --------------------------------------------------------
	// First scheduled review meeting
	// --------------------------------------------------------
	first_scheduled_review_meeting: function (frm) {

		const date = frm.doc.first_scheduled_review_meeting;
		if (!date) return;

		if (
			!validateWeekday(
				frm,
				"first_scheduled_review_meeting",
				"First Scheduled Review Meeting"
			)
		) {
			return;
		}

		// ----------------------------------------------------
		// Basic calendar year validation (client-side only hint)
		// ----------------------------------------------------
		const d = new Date(date);

		if (
			frm.doc.calendar_year &&
			d.getFullYear() !== cint(frm.doc.calendar_year)
		) {
			frappe.msgprint({
				title: "Invalid Date",
				message: "The First Scheduled Review Meeting must fall within the selected Calendar Year.",
				indicator: "red"
			});

			frm.set_value("first_scheduled_review_meeting", null);
			return;
		}

		// ----------------------------------------------------
		// Spillover check (unchanged)
		// ----------------------------------------------------
		frappe.call({
			method: "check_spillover_meeting_exists",
			doc: frm.doc,
			args: {
				meeting_date: date,
				current_doc: frm.doc.name || ""
			},
			callback: function (r) {

				if (!r.message) return;

				// const suggested = frappe.datetime.add_days(date, 7);
				let suggested = frappe.datetime.add_days(date, 7);

				while (isWeekend(suggested)) {
					suggested = frappe.datetime.add_days(suggested, 1);
				}

				frappe.confirm(
					`This date is already used as a spillover meeting in another Review Calendar.<br><br>
					Suggested alternative: <b>${suggested}</b><br><br>
					Use the suggested date?`,
					() => frm.set_value("first_scheduled_review_meeting", suggested),
					() => frm.set_value("first_scheduled_review_meeting", null)
				);
			}
		});
	},

	// --------------------------------------------------------
	// Calendar start date → AUTO SUGGEST FIRST MEETING (NEW)
	// --------------------------------------------------------
	calendar_start_date: function (frm) {

		if (!frm.doc.calendar_start_date) return;

		if (
			!validateWeekday(
				frm,
				"calendar_start_date",
				"Review Calendar Start"
			)
		) {
			return;
		}

		frappe.call({
			method: "get_initial_review_meeting",
			doc: frm.doc,
			args: {
				calendar_start_date: frm.doc.calendar_start_date
			},
			callback: function (r) {
				if (r.message) {
					frm.set_value(
						"first_scheduled_review_meeting",
						r.message
					);
				}
			}
		});
	},

	// --------------------------------------------------------
	// Calendar end date
	// --------------------------------------------------------
	calendar_end_date: function (frm) {

		if (!frm.doc.calendar_end_date) return;

		validateWeekday(
			frm,
			"calendar_end_date",
			"Review Calendar End"
		);
	},

	// --------------------------------------------------------
	// Refresh handler
	// --------------------------------------------------------
	refresh: function (frm) {

		const is_new = frm.is_new();
		const generated = frm.doc.review_calendar_generated;
		const published = frm.doc.review_periods_published;

		// ----------------------------------------------------
		// Load default settings (only if missing)
		// ----------------------------------------------------
		if (is_new && !frm.doc.review_frequency) {

			frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "Strategy Tracking Settings"
				},
				callback: function (r) {
					if (r.message && r.message.review_frequency) {
						frm.set_value("review_frequency", r.message.review_frequency);
					}
				}
			});
		}

		// ----------------------------------------------------
		// New document UI state
		// ----------------------------------------------------
		if (is_new) {
			frm.dashboard.set_headline_alert(
				`<span class="indicator blue">
					Please save the Review Calendar before generating review periods.
				</span>`
			);
			return;
		}

		// ----------------------------------------------------
		// Lock child table after generation
		// ----------------------------------------------------
		if (generated) {

			const grid = frm.fields_dict.review_dates.grid;

			const fields = [
				"review_no",
				"review_label",
				"review_window_start",
				"submission_deadline",
				"review_meeting_date",
				"quarter",
				"calendar_year",
				"spillover"
			];

			fields.forEach(field => {
				grid.update_docfield_property(field, "read_only", 1);
			});

			grid.cannot_add_rows = true;
			grid.cannot_delete_rows = true;
			grid.refresh();
		}

		// ----------------------------------------------------
		// Generate button
		// ----------------------------------------------------
		if (frm.doc.docstatus === 0 && !generated) {

			frm.add_custom_button("Generate Review Calendar", function () {

				const startTime = Date.now();
				frappe.dom.freeze("Generating Review Calendar...");

				frm.call({
					method: "generate_review_calendar",
					doc: frm.doc,
					callback: function () {

						const elapsed = Date.now() - startTime;
						const remaining = Math.max(0, 1200 - elapsed);

						setTimeout(() => {
							frappe.dom.unfreeze();
							frm.reload_doc();

							frappe.show_alert({
								message: "Review Calendar generated successfully.",
								indicator: "green"
							}, 5);

						}, remaining);
					},
					error: function () {
						frappe.dom.unfreeze();
					}
				});
			}, "Actions");
		}

		// ----------------------------------------------------
		// Publish button
		// ----------------------------------------------------
		if (frm.doc.docstatus === 0 && generated && !published) {

			frm.add_custom_button("Publish Review Periods", function () {

				const startTime = Date.now();
				frappe.dom.freeze("Publishing Review Periods...");

				frm.call({
					method: "publish_review_periods",
					doc: frm.doc,
					callback: function (r) {

						const elapsed = Date.now() - startTime;
						const remaining = Math.max(0, 1200 - elapsed);

						setTimeout(() => {
							frappe.dom.unfreeze();
							frm.reload_doc();

							frappe.show_alert({
								message: `Published successfully (${r.message?.created || 0} created)`,
								indicator: "green"
							}, 5);

						}, remaining);
					},
					error: function () {
						frappe.dom.unfreeze();
					}
				});
			}, "Actions");
		}

		// --------------------------------------------------------
		// Dashboard summary
		// --------------------------------------------------------
		if (generated) {
			frappe.call({
				method: "get_calendar_summary",
				doc: frm.doc,
				callback: function (r) {
					if (r.message) {
						frm.dashboard.set_headline(r.message);
					}
				}
			});
		}
	}
});
