// Copyright (c) 2026, V W and contributors
// For license information, please see license.txt

frappe.ui.form.on("Review Calendar", {
     // --------------------------------------------------------
     // Auto-fill calendar start/end dates
     // --------------------------------------------------------
     calendar_year: function (frm) {
          if (frm.doc.calendar_year) {
               frm.set_value("calendar_start_date", `${frm.doc.calendar_year}-01-01`);
               frm.set_value("calendar_end_date", `${frm.doc.calendar_year}-12-31`);
          } else {
               frm.set_value("calendar_start_date", null);
               frm.set_value("calendar_end_date", null);
          }
     },

     // --------------------------------------------------------
     // Client-side validation for first review date
     // --------------------------------------------------------
     first_review_meeting_date: function (frm) {
          const date = frm.doc.first_review_meeting_date;

          if (!date) return;

          const d = new Date(date);

          // JS weekday: Sunday=0, Monday=1, Tuesday=2
          if (d.getDay() !== 2) {
               frappe.msgprint({
                    title: "Invalid Date",
                    message: "First Review Meeting Date must be a Tuesday.",
                    indicator: "red"
               });
               frm.set_value("first_review_meeting_date", null);
               return;
          }

          if (frm.doc.calendar_year && d.getFullYear() !== frm.doc.calendar_year) {
               frappe.msgprint({
                    title: "Invalid Date",
                    message: "Review Meeting Date must fall within the selected Calendar Year.",
                    indicator: "red"
               });
               frm.set_value("first_review_meeting_date", null);
          }
     },

     // --------------------------------------------------------
     // Refresh handler (main UI logic)
     // --------------------------------------------------------
     refresh: function (frm) {

          const is_new = frm.is_new();
          const generated = frm.doc.review_calendar_generated;
          const published = frm.doc.review_periods_published;

          const is_system_manager = frappe.user.has_role("System Manager");

          // ----------------------------------------------------
          // New document state
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
          // Generate Review Calendar button
          // ----------------------------------------------------
          if (!generated && frm.doc.docstatus === 0) {
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
          // Publish Review Periods button
          // ----------------------------------------------------
          if (generated && !published) {
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

          // ----------------------------------------------------
          // Dashboard summary
          // ----------------------------------------------------
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
