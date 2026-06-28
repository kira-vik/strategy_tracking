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

               frappe.msgprint("KPIs loaded successfully");
          }
     });
}
