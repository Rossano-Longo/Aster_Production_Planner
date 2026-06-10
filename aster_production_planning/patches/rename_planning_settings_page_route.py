import frappe
from frappe.model.rename_doc import rename_doc

OLD_PAGE_NAME = "planning-settings"
NEW_PAGE_NAME = "planning-setup"


def execute():
	if not frappe.db.exists("Page", OLD_PAGE_NAME):
		_sync_new_page_name()
		return

	if not frappe.db.exists("Page", NEW_PAGE_NAME):
		rename_doc("Page", OLD_PAGE_NAME, NEW_PAGE_NAME, force=True, ignore_permissions=True, show_alert=False)
	else:
		frappe.delete_doc("Page", OLD_PAGE_NAME, force=1, ignore_permissions=True)

	_sync_new_page_name()


def _sync_new_page_name():
	if not frappe.db.exists("Page", NEW_PAGE_NAME):
		return

	frappe.db.set_value("Page", NEW_PAGE_NAME, "page_name", NEW_PAGE_NAME, update_modified=False)
	frappe.clear_cache()
