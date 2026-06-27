// Copyright (c) 2026, V W and contributors
// For license information, please see license.txt


frappe.ui.form.on("KPI Period Entry", {
     refresh(frm) {

          if (frm.doc.docstatus !== 0) return;

          if (frm.doc.hr_override_approved) return;

          if (!frappe.user.has_role("HR Manager")) return;

          add_hr_override_button(frm);
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
