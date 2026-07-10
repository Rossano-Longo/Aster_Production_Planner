import frappe


def execute():
	if not frappe.db.exists("DocType", "Planning Card"):
		return

	frappe.db.sql(
		"""
		update `tabPlanning Card`
		set card_type = 'Produktion'
		where ifnull(card_type, '') = ''
		"""
	)
