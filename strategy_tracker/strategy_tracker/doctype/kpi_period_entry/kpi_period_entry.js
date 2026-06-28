// Copyright (c) 2026, V W and contributors
// For license information, please see license.txt


frappe.ui.form.on("KPI Period Entry", {
     refresh(frm) {

          if (frm.is_new()) {
               frm.add_custom_button(__('Fetch KPIs'), function () {
                    fetch_kpis(frm);
               });
          }

          const can_show_hr_override =
               frm.doc.docstatus === 0 &&
               !frm.doc.hr_override_approved &&
               frappe.user.has_role("HR Manager");

          if (can_show_hr_override) {
               add_hr_override_button(frm);
          }

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

               frappe.msgprint("KPIs loaded successfully");
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
