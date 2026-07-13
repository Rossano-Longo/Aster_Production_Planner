import frappe
from frappe.model.document import Document
from frappe.utils import cint, flt

PLANNING_SETTINGS_DOCTYPE = "Planning Settings"
DEFAULT_EVENT_CARD_COLOR = "#c35f24"
DEFAULT_EVENT_CARD_ICON = "calendar"
SHOW_ABSENCES_IN_PLANNING_CARD_CALENDAR_FIELD = "show_absences_in_planning_card_calendar"


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


def get_show_absences_in_planning_card_calendar(doc=None) -> int:
	doc = doc or get_planning_settings_doc()
	if not frappe.db.exists("DocType", PLANNING_SETTINGS_DOCTYPE):
		return 1

	value = frappe.db.sql(
		"""
		select value
		from tabSingles
		where doctype = %s and field = %s
		limit 1
		""",
		(PLANNING_SETTINGS_DOCTYPE, SHOW_ABSENCES_IN_PLANNING_CARD_CALENDAR_FIELD),
		as_list=True,
	)
	if value and value[0]:
		return cint(value[0][0])

	return cint(getattr(doc, SHOW_ABSENCES_IN_PLANNING_CARD_CALENDAR_FIELD, 1)) if doc else 1


def serialize_planning_settings(doc=None) -> dict:
	doc = doc or get_planning_settings_doc()
	if not doc:
		return {
			"employees": [],
			"departments": [],
			"activity_types": [],
			"exclude_weekends_from_planning_duration": 0,
			"default_hours_per_employee_per_day": 8.0,
			"default_hours_per_day_without_employees": 8.0,
			"event_card_color": DEFAULT_EVENT_CARD_COLOR,
			"event_card_icon": DEFAULT_EVENT_CARD_ICON,
			"show_task_type_icon_in_production_cards": 1,
			"show_leave_type_in_planning_studio": 1,
			"show_absences_in_planning_card_calendar": 1,
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
		"default_hours_per_employee_per_day": flt(
			getattr(doc, "default_hours_per_employee_per_day", 8) or 8,
			2,
		),
		"default_hours_per_day_without_employees": flt(
			getattr(doc, "default_hours_per_day_without_employees", 8) or 8,
			2,
		),
		"event_card_color": getattr(doc, "event_card_color", None) or DEFAULT_EVENT_CARD_COLOR,
		"event_card_icon": getattr(doc, "event_card_icon", None) or DEFAULT_EVENT_CARD_ICON,
		"show_task_type_icon_in_production_cards": cint(
			getattr(doc, "show_task_type_icon_in_production_cards", 1)
		),
		"show_leave_type_in_planning_studio": cint(getattr(doc, "show_leave_type_in_planning_studio", 1)),
		"show_absences_in_planning_card_calendar": get_show_absences_in_planning_card_calendar(doc),
	}


def exclude_weekends_from_planning_duration(doc=None) -> bool:
	settings_doc = doc or get_planning_settings_doc()
	if not settings_doc:
		return False
	return bool(cint(getattr(settings_doc, "exclude_weekends_from_planning_duration", 0)))


def get_default_hours_per_employee_per_day(doc=None) -> float:
	settings_doc = doc or get_planning_settings_doc()
	if not settings_doc:
		return 8.0
	return flt(getattr(settings_doc, "default_hours_per_employee_per_day", 8) or 8, 2)


def get_default_hours_per_day_without_employees(doc=None) -> float:
	settings_doc = doc or get_planning_settings_doc()
	if not settings_doc:
		return 8.0
	return flt(getattr(settings_doc, "default_hours_per_day_without_employees", 8) or 8, 2)


def get_event_card_color(doc=None) -> str:
	settings_doc = doc or get_planning_settings_doc()
	if not settings_doc:
		return DEFAULT_EVENT_CARD_COLOR
	return getattr(settings_doc, "event_card_color", None) or DEFAULT_EVENT_CARD_COLOR


def get_event_card_icon(doc=None) -> str:
	settings_doc = doc or get_planning_settings_doc()
	if not settings_doc:
		return DEFAULT_EVENT_CARD_ICON
	return getattr(settings_doc, "event_card_icon", None) or DEFAULT_EVENT_CARD_ICON


class PlanningSettings(Document):
	pass
