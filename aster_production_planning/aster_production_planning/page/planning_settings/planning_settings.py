import json

import frappe
from frappe import _
from frappe.utils import cint

from aster_production_planning.aster_production_planning.doctype.planning_settings.planning_settings import (
	PLANNING_SETTINGS_DOCTYPE,
	get_planning_settings_doc,
	serialize_planning_settings,
)
ALLOWED_ROLES = {
	"System Manager",
	"Manufacturing Manager",
	"Manufacturing User",
	"Projects Manager",
	"Projects User",
}


def _require_access() -> None:
	if not ALLOWED_ROLES.intersection(set(frappe.get_roles())):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _parse_json_list(value) -> list[str]:
	if not value:
		return []

	if isinstance(value, list):
		values = value
	elif isinstance(value, str):
		value = value.strip()
		if not value:
			return []
		try:
			parsed = json.loads(value)
		except json.JSONDecodeError:
			parsed = [item.strip() for item in value.split(",") if item.strip()]
		values = parsed if isinstance(parsed, list) else [parsed]
	else:
		values = [value]

	normalized = []
	seen = set()
	for item in values:
		text = str(item).strip()
		if text and text not in seen:
			normalized.append(text)
			seen.add(text)
	return normalized


def _get_settings_doc():
	return get_planning_settings_doc()


def _serialize_settings(doc) -> dict:
	return serialize_planning_settings(doc)


@frappe.whitelist()
def get_planning_settings() -> dict:
	_require_access()
	return _serialize_settings(_get_settings_doc())


@frappe.whitelist()
def save_planning_settings(
	employees=None,
	departments=None,
	activity_types=None,
	exclude_weekends_from_planning_duration=0,
) -> dict:
	_require_access()
	doc = _get_settings_doc() or frappe.new_doc(PLANNING_SETTINGS_DOCTYPE)
	doc.update({"doctype": PLANNING_SETTINGS_DOCTYPE})
	doc.exclude_weekends_from_planning_duration = cint(exclude_weekends_from_planning_duration)
	doc.set("capacity_employees", [{"employee": employee} for employee in _parse_json_list(employees)])
	doc.set("capacity_departments", [{"department": department} for department in _parse_json_list(departments)])
	doc.set(
		"capacity_activity_types",
		[{"activity_type": activity_type} for activity_type in _parse_json_list(activity_types)],
	)
	doc.save(ignore_permissions=True)
	return _serialize_settings(doc)
