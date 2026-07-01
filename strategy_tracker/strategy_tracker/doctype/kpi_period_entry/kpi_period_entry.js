// Copyright (c) 2026, V W and contributors
// For license information, please see license.txt


frappe.ui.form.on("KPI Period Entry", {
     validate(frm) {
          if (frm.doc.function_head && !frm.doc.function) {
               return resolve_function_for_head(frm).then((department) => {
                    if (department) {
                         frm.set_value("function", department);
                    } else {
                         frappe.throw({
                         title: __("Function Not Found"),
                         message: __(
                              "No Department is configured with {0} as its Head. Please contact IT Support for resolution.",
                              [frm.doc.function_head]
                         )
                         });
                    }
               });
          }
     },

     refresh(frm) {
          // Prevent duplicate custom buttons from stacking up on repeated refreshes
          frm.clear_custom_buttons();

          display_kpi_message(frm);
          set_default_function_head(frm);
          setup_fetch_kpi_button(frm);
          setup_hr_override_button(frm);
          set_kpi_dashboard_headline(frm);
     },

     setup(frm) {
          frm.set_query("review_period", () => {
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

     onload(frm) {
          apply_rag_colors(frm);
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

          populate_function(frm);
          fetch_reporting_details(frm);
     },

     before_workflow_action(frm) {
          const action = frm.selected_workflow_action;

          const invalid_rows = (frm.doc.kpi_reviews || []).filter(row => {
               return !row.actual_performance || !row.rag_status;
          });

          if (invalid_rows.length > 0) {
               frappe.throw({
                    title: __("Incomplete KPI Reviews"),
                    message: __(
                         "All KPI review lines must have Actual Performance and Status (RAG) filled before proceeding."
                    )
               });
          }

          // Case 1: Send for Review
          if (action === "Send for Review") {
               if (frappe.session.user !== frm.doc.function_head) {
                    frappe.throw({
                    title: __("Permission Denied"),
                    message: __(
                         "Only the Function Head, {0}, can perform this action.",
                         [frm.doc.head_of_function_name]
                    )
                    });
               }

               if (!frm.doc.general_comments) {
                    frappe.throw({
                    title: __("Review Reflection Required"),
                    message: __(
                         "Kindly update your review period reflection comments before sending for review."
                    )
                    });
               }
          }

          // Case 2: Mark as Reviewed
          else if (action === "Mark as Reviewed") {
               if (frappe.session.user !== frm.doc.reports_to && frappe.session.user !== "Administrator") {
                    frappe.throw({
                    title: __("Permission Denied"),
                    message: __(
                         "Only the performance reviewer, {0}, can perform this action.",
                         [frm.doc.reports_to_name]
                    )
                    });
               }

               if (!frm.doc.general_manager_comments) {
                    frappe.throw({
                    title: __("Performance Reviewer Feedback Required"),
                    message: __(
                         "Kindly update the Performance Reviewer Comments section before submitting the record."
                    )
                    });
               }
          }
     },

     after_workflow_action(frm) {
          frm.reload_doc().then(() => {
               set_kpi_dashboard_headline(frm);
          });
     }
});

frappe.ui.form.on("KPI Entry Line", {
     rag_status(frm) {
          update_kpi_summary(frm);
          apply_rag_colors(frm);
     },

     escalation(frm) {
          update_kpi_summary(frm);
     }
});

/**
 * Default the Function Head to the current user on a brand-new record.
 */
function set_default_function_head(frm) {
     if (frm.is_new() && !frm.doc.function_head) {
          frm.set_value("function_head", frappe.session.user);
     }
}

function resolve_function_for_head(frm) {
     return frappe.call({
          method: "get_function_by_head",
          doc: frm.doc,
          args: {
               function_head: frm.doc.function_head
          }
     }).then((r) => r.message || null);
}

function populate_function(frm) {
     resolve_function_for_head(frm)
          .then((department) => {
               frm.set_value("function", department);
          })
          .catch(() => {
               frappe.msgprint({
                    title: __("Error"),
                    indicator: "red",
                    message: __("Could not look up the Function for this Function Head.")
               });
          });
}

function clear_headline_alert(frm) {
     if (typeof frm.dashboard.clear_headline_alert === "function") {
          frm.dashboard.clear_headline_alert();
     } else {
          frm.dashboard.set_headline_alert("");
     }
}

/**
 * Show a banner prompting the user to save the record / fetch KPIs.
 */
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
          // KPIs already fetched -> show nothing.
          clear_headline_alert(frm);
          frm.__last_headline = null;
          return;
     }

     if (frm.__last_headline === message) return;

     frm.dashboard.set_headline_alert(message);
     frm.__last_headline = message;
}

/**
 * Add the "Fetch KPIs" button when KPIs have not yet been pulled in.
 */
function setup_fetch_kpi_button(frm) {
     if (frm.is_new()) return;

     if (!frm.doc.kpis_fetched) {
          frm.add_custom_button(__("Fetch KPIs"), () => fetch_kpis(frm));
     }
}

/**
 * Add the HR override button for HR Managers / Administrators on
 * not-yet-approved, non-new, draft (docstatus 0) records.
 */
function setup_hr_override_button(frm) {
     const can_show_hr_override =
          !frm.is_new() &&
          frm.doc.docstatus === 0 &&
          !frm.doc.hr_override_approved &&
          (frappe.user.has_role("HR Manager") || frappe.session.user === "Administrator");

     if (can_show_hr_override) {
          add_hr_override_button(frm);
     }
}

function add_hr_override_button(frm) {
     frm.add_custom_button(
          __("Approve HR Override"),
          () => {
               const dialog = new frappe.ui.Dialog({
                    title: __("HR Override Approval"),
                    fields: [
                    {
                         fieldname: "reason",
                         fieldtype: "Small Text",
                         label: __("Override Reason"),
                         reqd: 1
                    }
                    ],
                    primary_action_label: __("Override"),
                    primary_action(values) {
                    frappe.call({
                         method: "approve_hr_override",
                         doc: frm.doc,
                         args: {
                              reason: values.reason
                         },
                         freeze: true,
                         freeze_message: __("Applying override..."),
                         callback: () => {
                              dialog.hide();
                              frappe.show_alert({
                                   message: __("Override approved"),
                                   indicator: "green"
                              });
                              frm.reload_doc();
                         },
                         error: () => {
                              frappe.show_alert({
                                   message: __("Failed to approve override"),
                                   indicator: "red"
                              });
                         }
                    });
                    }
               });

               dialog.show();
          },
          __("Actions")
     );
}

/**
 * Pull the configured KPIs for the selected Function into the child table.
 */
function fetch_kpis(frm) {
     if (!frm.doc.function) {
          frappe.msgprint(__("Please select Function first"));
          return;
     }

     frappe.call({
          method: "fetch_kpis",
          doc: frm.doc,
          args: {
               function: frm.doc.function
          },
          freeze: true,
          freeze_message: __("Loading KPIs..."),
          callback(r) {
               if (!r.message || !r.message.length) {
                    frappe.msgprint(__("No KPIs found for this function"));
                    return;
               }

               frm.clear_table("kpi_reviews");

               r.message.forEach((row) => {
                    const child = frm.add_child("kpi_reviews");

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
                    message: __("KPIs loaded successfully"),
                    indicator: "green"
                    });
               });
          },
          error() {
               frappe.msgprint({
                    title: __("Error"),
                    message: __("Could not fetch KPIs. Please try again."),
                    indicator: "red"
               });
          }
     });
}

/**
 * Recalculate RAG counters, escalation flag and overall RAG status from the
 * KPI child table.
 */
function update_kpi_summary(frm) {
     const rows = frm.doc.kpi_reviews || [];

     let red = 0;
     let amber = 0;
     let green = 0;
     let escalation = false;

     rows.forEach((row) => {
          if (row.rag_status === "Red") {
               red++;
               escalation = true;
          } else if (row.rag_status === "Amber") {
               amber++;
          } else if (row.rag_status === "Green") {
               green++;
          }

          if (row.escalation) escalation = true;
     });

     frm.set_value("total_kpis", rows.length);
     frm.set_value("red_count", red);
     frm.set_value("amber_count", amber);
     frm.set_value("green_count", green);
     frm.set_value("escalation", escalation ? 1 : 0);

     let overall = "Green";
     if (red > 0) overall = "Red";
     else if (amber > 0) overall = "Amber";

     frm.set_value("overall_rag", overall);
}

/**
 * Warn the user if a KPI Period Entry already exists for this
 * Function + Review Period combination.
 */
function check_duplicate(frm) {
     if (!frm.doc.review_period || !frm.doc.function) return;

     frappe.call({
          method: "frappe.client.get_list",
          args: {
               doctype: "KPI Period Entry",
               filters: {
                    review_period: frm.doc.review_period,
                    function: frm.doc.function,
                    name: ["!=", frm.doc.name || ""]
               },
               limit_page_length: 1
          },
          callback(r) {
               if (r.message && r.message.length) {
                    frappe.msgprint({
                    title: __("Duplicate Warning"),
                    message: __("A KPI Period Entry already exists for this Function and Review Period."),
                    indicator: "red"
                    });
               }
          }
     });
}

/**
 * Colour the KPI grid rows based on RAG status.
 * Uses a short delay since the grid rows are re-rendered asynchronously
 * after refresh_field / onload.
 */
function apply_rag_colors(frm) {
     setTimeout(() => {
          const grid = frm.fields_dict["kpi_reviews"] && frm.fields_dict["kpi_reviews"].grid;
          if (!grid || !grid.grid_rows) return;

          grid.grid_rows.forEach((row) => {
               if (!row || !row.doc || !row.row) return;

               let bg = "";
               let text = "#fff";

               if (row.doc.rag_status === "Green") {
                    bg = "#28a745";
               } else if (row.doc.rag_status === "Amber") {
                    bg = "#ffc107";
                    text = "#000";
               } else if (row.doc.rag_status === "Red") {
                    bg = "#dc3545";
               }

               $(row.row).css({
                    "background-color": bg,
                    color: text,
                    "font-weight": "500"
               });
          });
     }, 300);
}

/**
 * Sync Reports-To details from the selected Function Head.
 */
function fetch_reporting_details(frm) {
     if (!frm.doc.function_head) return;

     frappe.call({
          method: "get_reporting_details",
          doc: frm.doc,
          args: {
               function_head: frm.doc.function_head
          },
          callback(r) {
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
                    message: __("No reporting manager is configured for this Function Head.")
                    });
               }
          },
          error() {
               frappe.msgprint({
                    title: __("Error"),
                    indicator: "red",
                    message: __("Could not fetch reporting details for this Function Head.")
               });
          }
     });
}

/**
 * Show a contextual dashboard headline based on workflow state and the
 * current user's role relative to the record (Function Head vs reviewer).
 */
function set_kpi_dashboard_headline(frm) {
     const state = frm.doc.workflow_state;
     const user = frappe.session.user;

     const is_function_head = user === frm.doc.function_head;
     const is_performance_reviewer = user === frm.doc.reports_to;

     frm.dashboard.clear_headline();

     if (state === "Draft") {
          if (is_function_head) {
               if (frm.is_new()) {
                    frm.dashboard.set_headline(
                         __("Please save the record before fetching configured KPIs.")
                    );
               }

               else if (!frm.is_new() && !frm.doc.kpis_fetched) {
                    frm.dashboard.set_headline(
                         __("Click the 'Fetch KPIs' button to retrieve configured KPIs before proceeding.")
                    );
               }

               else {
                    frm.dashboard.set_headline(
                         __("Kindly complete the required fields in the KPI Period Entry before sending it for review.")
                    );
               }
          }

          if (is_performance_reviewer) {
               frm.dashboard.set_headline(
                    __("Waiting for {0} to complete their self-review.", [`<b>${frappe.utils.escape_html(frm.doc.head_of_function_name || "")}</b>`])
               );
          }
     }

     if (state === "Pending Review") {
          if (is_function_head) {
               frm.dashboard.set_headline(
                    __("Waiting for your reviewer, {0}, to complete the review.", [`<b>${frappe.utils.escape_html(frm.doc.reports_to_name || "")}</b>`])
               );
          }

          if (is_performance_reviewer) {
               frm.dashboard.set_headline(
                    __("Kindly review the KPI Period Entry submitted by {0} and complete your assessment.", [`<b>${frappe.utils.escape_html(frm.doc.head_of_function_name || "")}</b>`])
               );
          }
     }
}
