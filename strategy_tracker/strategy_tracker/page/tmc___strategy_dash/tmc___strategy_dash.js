frappe.pages['tmc---strategy-dash'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Strategy Execution Dashboard - TMC',
		single_column: true
	});
}