// Copyright (c) 2026, V W and contributors
// For license information, please see license.txt


frappe.ui.form.on("KPI Period Entry", {
     refresh(frm) {
          display_kpi_message(frm);
          set_default_function_head(frm);
          setup_fetch_kpi_button(frm);
          setup_hr_override_button(frm);
          apply_rag_colors(frm);
     },

     setup: function (frm) {
          frm.set_query("review_period", function () {

               const current_year = new Date().getFullYear();

               return {
                    filters: {
                         status: ["!=", "Completed"],
                         calendar_year: current_year
                    },
                    order_by: "review_meeting_date asc"
               };
          });
     },

     review_period(frm) {
		check_duplicate(frm);
	},

	function(frm) {
		check_duplicate(frm);
	},

     function_head(frm) {
        if (!frm.doc.function_head) {
            frm.set_value("function", null);
            return;
        }

     //    populate_function(frm);
        fetch_reporting_details(frm);
    }
});

frappe.ui.form.on('KPI Entry Line', {

     rag_status: function(frm) {
          update_kpi_summary(frm);
     },

     escalation: function(frm) {
          update_kpi_summary(frm);
     }
});

function set_default_function_head(frm) {
     if (frm.is_new() && !frm.doc.function_head) {
          frm.set_value("function_head", frappe.session.user);
     }
}

function display_kpi_message(frm) {

     let message = "";

     if (frm.is_new()) {

          message = `
               <span class="indicator blue">
                    Please save the record before retrieving your configured KPIs.
               </span>
          `;

     } else if (!frm.doc.kpis_fetched) {

          message = `
               <span class="indicator blue">
                    Please click the <strong>Fetch KPIs</strong> button to retrieve your configured KPIs.
               </span>
          `;

     } else {

          // KPIs already fetched → show nothing
          frm.dashboard.clear_headline_alert();
          return;
     }

     if (frm.__last_headline === message) return;

     frm.dashboard.set_headline_alert(message);
     frm.__last_headline = message;
}

function setup_fetch_kpi_button(frm) {

     frm.clear_custom_buttons();

     if (frm.is_new()) return;

     if (!frm.doc.kpis_fetched) {
          frm.add_custom_button(__('Fetch KPIs'), function () {
               fetch_kpis(frm);
          });
     }
}

function setup_hr_override_button(frm) {

     const can_show_hr_override =
          !frm.is_new() &&
          frm.doc.docstatus === 0 &&
          !frm.doc.hr_override_approved &&
          frappe.user.has_role("HR Manager");

     if (can_show_hr_override) {
          add_hr_override_button(frm);
     }
}

function add_hr_override_button(frm) {

     frm.add_custom_button("Approve HR Override", () => {

          let d = new frappe.ui.Dialog({
               title: "HR Override Approval",
               fields: [
                    {
                    fieldname: "reason",
                    fieldtype: "Small Text",
                    label: "Override Reason",
                    reqd: 1
                    }
               ],

               primary_action_label: "Override",

               primary_action(values) {
                    frappe.call({
                    method: "approve_hr_override",
                    doc: frm.doc,
                    args: {
                         reason: values.reason
                    },
                    callback: () => {
                         d.hide();
                         frappe.show_alert({
                              message: "Override approved",
                              indicator: "green"
                         });
                         frm.reload_doc();
                    }
                    });
               }
          });

          d.show();
    }, "Actions");
}


function fetch_kpis(frm) {

     if (!frm.doc.function) {
          frappe.msgprint("Please select Function first");
          return;
     }

     frappe.call({
          method: "fetch_kpis",
          doc: frm.doc,
          args: {
               function: frm.doc.function
          },
          freeze: true,
          freeze_message: "Loading KPIs...",
          callback: function (r) {

               if (!r.message) {
                    frappe.msgprint("No KPIs found for this function");
                    return;
               }

               frm.clear_table("kpi_reviews");

               r.message.forEach(row => {
                    let child = frm.add_child("kpi_reviews");

                    child.kpi = row.kpi;
                    child.pillar = row.pillar;
                    child.weight = row.weight;
                    child.target = row.target;
                    child.baseline = row.baseline;

                    child.actual_performance = "";
                    child.actual_numeric = null;
                    child.variance = "";
                    child.rag_status = "";
                    child.corrective_action_summary = "";
                    child.escalation = 0;
               });

               frm.refresh_field("kpi_reviews");
               update_kpi_summary(frm);

               frm.save().then(() => {
                    frappe.show_alert({
                         message: "KPIs loaded successfully",
                         indicator: "green"
                    });
               });
          }
     });
}

function update_kpi_summary(frm) {

     let total = frm.doc.kpi_reviews.length;

     let red = 0;
     let amber = 0;
     let green = 0;
     let escalation = false;

     frm.doc.kpi_reviews.forEach(row => {

          if (row.rag_status === "Red") red++;
          else if (row.rag_status === "Amber") amber++;
          else if (row.rag_status === "Green") green++;

          if (row.escalation) escalation = true;
          if (row.rag_status === "Red") escalation = true;
     });

     frm.set_value("total_kpis", total);
     frm.set_value("red_count", red);
     frm.set_value("amber_count", amber);
     frm.set_value("green_count", green);
     frm.set_value("escalation", escalation ? 1 : 0);

     // Overall RAG logic
     let overall = "Green";

     if (red > 0) overall = "Red";
     else if (amber > 0) overall = "Amber";

     frm.set_value("overall_rag", overall);
}

function check_duplicate(frm) {
	if (!frm.doc.review_period || !frm.doc.function) return;

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "KPI Period Entry",
			filters: {
				review_period: frm.doc.review_period,
				function: frm.doc.function
			},
			limit_page_length: 1
		},
		callback: function (r) {
			if (r.message && r.message.length) {
				frappe.msgprint({
					title: "Duplicate Warning",
					message: "A KPI Period Entry already exists for this Function and Review Period.",
					indicator: "red"
				});
			}
		}
	});
}

function apply_rag_colors(frm) {
	setTimeout(() => {
		const grid = frm.fields_dict["kpi_reviews"]?.grid;
		if (!grid) return;

		grid.grid_rows.forEach((row) => {
			if (!row || !row.doc || !row.row) return;

			let bg = "";
			let text = "#fff";

			if (row.doc.rag_status === "Green") {
				bg = "#28a745";
			} 
			else if (row.doc.rag_status === "Amber") {
				bg = "#ffc107";
				text = "#000";
			} 
			else if (row.doc.rag_status === "Red") {
				bg = "#dc3545";
			}

			$(row.row).css({
				"background-color": bg,
				"color": text,
				"font-weight": "500"
			});
		});
	}, 100);
}

// function populate_function(frm) {
//      frappe.call({
//           method: "get_function_by_head",
//           doc: frm.doc,
//           args: {
//                function_head: frm.doc.function_head
//           },
//           callback(r) {
//                frm.set_value("function", r.message || null);
//           }
//      });
// }

function fetch_reporting_details(frm) {
     if (!frm.doc.function_head) return;

     frappe.call({
          method: "get_reporting_details",
          doc: frm.doc,
          args: {
               function_head: frm.doc.function_head
          },
          callback: function (r) {
               if (!r.message) return;

               let changed = false;

               if (frm.doc.reports_to !== r.message.reports_to) {
                    frm.set_value("reports_to", r.message.reports_to || "");
                    changed = true;
               }

               if (frm.doc.reports_to_name !== r.message.reports_to_name) {
                    frm.set_value("reports_to_name", r.message.reports_to_name || "");
                    changed = true;
               }

               if (!frm.is_new() && changed) {
                    frm.save();
               }

               if (
                    (!r.message.reports_to || !r.message.reports_to_name) &&
                    !frm.__missing_reporting_manager_shown
               ) {
                    frm.__missing_reporting_manager_shown = true;

                    frappe.msgprint({
                    title: __("Missing Reporting Manager"),
                    indicator: "orange",
                    message: __("No reporting manager is configured for this Function Head."),
                    });
               }
          }
     });
}

