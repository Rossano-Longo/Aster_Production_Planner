import frappe
from frappe.model.document import Document
from frappe.utils import cint

PLANNING_SETTINGS_DOCTYPE = "Planning Settings"


def _unique_values(values) -> list[str]:
	unique = []
	seen = set()
	for value in values or []:
		if not value or value in seen:
			continue
		unique.append(value)
		seen.add(value)
	return unique


def get_planning_settings_doc():
	if not frappe.db.exists("DocType", PLANNING_SETTINGS_DOCTYPE):
		return None

	try:
		return frappe.get_cached_doc(PLANNING_SETTINGS_DOCTYPE, PLANNING_SETTINGS_DOCTYPE)
	except frappe.DoesNotExistError:
		return None


def serialize_planning_settings(doc=None) -> dict:
	doc = doc or get_planning_settings_doc()
	if not doc:
		return {
			"employees": [],
			"departments": [],
			"activity_types": [],
			"exclude_weekends_from_planning_duration": 0,
		}

	return {
		"employees": _unique_values([row.employee for row in getattr(doc, "capacity_employees", []) if row.employee]),
		"departments": _unique_values(
			[row.department for row in getattr(doc, "capacity_departments", []) if row.department]
		),
		"activity_types": _unique_values(
			[row.activity_type for row in getattr(doc, "capacity_activity_types", []) if row.activity_type]
		),
		"exclude_weekends_from_planning_duration": cint(
			getattr(doc, "exclude_weekends_from_planning_duration", 0)
		),
	}


def exclude_weekends_from_planning_duration(doc=None) -> bool:
	settings_doc = doc or get_planning_settings_doc()
	if not settings_doc:
		return False
	return bool(cint(getattr(settings_doc, "exclude_weekends_from_planning_duration", 0)))


class PlanningSettings(Document):
	pass
