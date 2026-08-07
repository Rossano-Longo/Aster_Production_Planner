import json
from collections import defaultdict
from datetime import datetime, time, timedelta
from math import ceil

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, get_datetime_str, getdate
from aster_production_planning.aster_production_planning.doctype.planning_card.planning_card import (
	count_planning_days,
	EVENT_CARD_TYPE,
	get_last_planned_day,
	PRODUCTION_CARD_TYPE,
)
from aster_production_planning.aster_production_planning.doctype.planning_settings.planning_settings import (
	exclude_weekends_from_planning_duration,
	get_default_hours_per_day_without_employees,
	get_default_hours_per_employee_per_day,
	get_event_card_color,
	get_event_card_icon,
	serialize_planning_settings,
)

PLANNING_CARD_DOCTYPE = "Planning Card"
PLANNING_CARD_ASSIGNMENT_DOCTYPE = "Planning Card Assignment"
PLANNING_SETTINGS_DOCTYPE = "Planning Settings"
TIMESHEET_DOCTYPE = "Timesheet"
LEAVE_APPLICATION_DOCTYPE = "Leave Application"
OPERATION_DOCTYPE = "Operation"
PROJECT_DOCTYPE = "Project"
TASK_TYPE_DOCTYPE = "Task Type"
EVENT_TYPE_DOCTYPE = "Event Type"
DEFAULT_ABSENCE_HOURS_PER_DAY = 8.0
PLANNING_CARD_FIELDS = [
	"name",
	"card_type",
	"project",
	"event_type",
	"elementgruppe",
	"operation",
	"task_type",
	"start_date",
	"start_time",
	"end_date",
	"end_time",
	"required_hours",
	"duration_in_hours",
	"planned_employee_count",
	"hours_per_employee_per_day",
	"allocated_hours",
	"adjust_end_date_for_parallel_work",
	"color",
	"description",
	"note",
]


def _require_permission(doctype: str, ptype: str = "read") -> None:
	if not frappe.has_permission(doctype=doctype, ptype=ptype):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _parse_json_list(value) -> list:
	if not value:
		return []

	if isinstance(value, list):
		return value

	if isinstance(value, str):
		value = value.strip()
		if not value:
			return []

		try:
			parsed = json.loads(value)
		except json.JSONDecodeError:
			parsed = [item.strip() for item in value.split(",") if item.strip()]

		if isinstance(parsed, list):
			return parsed

	return [value]


def _parse_activity_types(activity_types) -> list[str]:
	parsed = _parse_json_list(activity_types)
	return [value for value in parsed if value]


def _parse_link_filter_values(values) -> list[str]:
	parsed = _parse_json_list(values)
	return [value for value in parsed if value]


def _normalize_optional_time_value(value):
	if value in (None, ""):
		return None

	if isinstance(value, time):
		return value.strftime("%H:%M:%S")

	text = str(value).strip()
	if not text:
		return None

	for fmt in ("%H:%M:%S", "%H:%M"):
		try:
			return datetime.strptime(text, fmt).strftime("%H:%M:%S")
		except ValueError:
			continue

	return text


def _unique_values(values) -> list[str]:
	unique = []
	seen = set()
	for value in values or []:
		if not value or value in seen:
			continue
		unique.append(value)
		seen.add(value)
	return unique


def _merge_filter_values(configured_values, selected_values):
	configured = _unique_values(configured_values)
	selected = _unique_values(selected_values)

	if configured and selected:
		configured_set = set(configured)
		return [value for value in selected if value in configured_set]

	if selected:
		return selected

	if configured:
		return configured

	return None


def _get_capacity_settings() -> dict:
	if not frappe.db.exists("DocType", PLANNING_SETTINGS_DOCTYPE):
		return {"employees": [], "departments": [], "activity_types": []}

	try:
		settings = frappe.get_single(PLANNING_SETTINGS_DOCTYPE)
	except frappe.DoesNotExistError:
		return {"employees": [], "departments": [], "activity_types": []}

	return {
		"employees": _unique_values([row.employee for row in getattr(settings, "capacity_employees", []) if row.employee]),
		"departments": _unique_values(
			[row.department for row in getattr(settings, "capacity_departments", []) if row.department]
		),
		"activity_types": _unique_values(
			[
				row.activity_type
				for row in getattr(settings, "capacity_activity_types", [])
				if row.activity_type
			]
		),
	}


def _parse_assigned_employees(assigned_employees) -> list[dict]:
	parsed = _parse_json_list(assigned_employees)
	employees = []
	for value in parsed:
		if isinstance(value, dict):
			employee = value.get("employee")
			from_date = value.get("from_date")
			to_date = value.get("to_date")
		else:
			employee = value
			from_date = None
			to_date = None

		if employee:
			employees.append(
				{
					"employee": employee,
					"from_date": str(from_date) if from_date else None,
					"to_date": str(to_date) if to_date else None,
				}
			)

	deduped = []
	seen = set()
	for row in employees:
		key = (row["employee"], row["from_date"], row["to_date"])
		if key in seen:
			continue
		seen.add(key)
		deduped.append(row)

	return deduped


def _get_planned_employee_count(planning_card, assigned_employees=None) -> int:
	stored_count = cint(getattr(planning_card, "planned_employee_count", 0) or 0)
	if stored_count > 0:
		return stored_count

	assigned_count_from_row = cint(getattr(planning_card, "assigned_employee_count", 0) or 0)
	if assigned_count_from_row > 0:
		return assigned_count_from_row

	rows = assigned_employees if assigned_employees is not None else getattr(planning_card, "assigned_employees", []) or []
	assigned_count = len([row for row in rows if (row.get("employee") if isinstance(row, dict) else getattr(row, "employee", None))])
	return max(assigned_count, 0)


def _get_total_daily_hours(planning_card, assigned_employees=None) -> float:
	daily_hours = flt(getattr(planning_card, "hours_per_employee_per_day", 0) or 0, 2)
	planned_employee_count = cint(getattr(planning_card, "planned_employee_count", 0) or 0)
	if planned_employee_count > 0:
		return daily_hours

	if cint(getattr(planning_card, "adjust_end_date_for_parallel_work", 0)):
		assigned_count_from_row = cint(getattr(planning_card, "assigned_employee_count", 0) or 0)
		if assigned_count_from_row > 0:
			return flt(daily_hours * assigned_count_from_row, 2)

		rows = assigned_employees if assigned_employees is not None else getattr(planning_card, "assigned_employees", []) or []
		assigned_count = len([row for row in rows if (row.get("employee") if isinstance(row, dict) else getattr(row, "employee", None))])
		return flt(daily_hours * max(assigned_count, 1), 2)

	return daily_hours


def _get_assignment_daily_hours(planning_card, assigned_employees=None) -> float:
	total_daily_hours = _get_total_daily_hours(planning_card, assigned_employees)
	planned_employee_count = _get_planned_employee_count(planning_card, assigned_employees)
	if planned_employee_count <= 0:
		return total_daily_hours

	return flt(total_daily_hours / planned_employee_count, 2)


def _get_default_total_daily_hours(planned_employee_count=None) -> float:
	planned_count = max(cint(planned_employee_count or 0), 0)
	if planned_count > 0:
		return flt(planned_count * get_default_hours_per_employee_per_day(), 2)

	return flt(get_default_hours_per_day_without_employees(), 2)


def _get_window(start_date, end_date):
	if not start_date or not end_date:
		frappe.throw(_("Start Date and End Date are required"))

	window_start = get_datetime(start_date)
	window_end = get_datetime(end_date)

	if window_start >= window_end:
		frappe.throw(_("End Date must be after Start Date"))

	return window_start, window_end


def get_overlap_hours(window_start, window_end, item_start, item_end=None, fallback_hours=0) -> float:
	if not item_start or not window_start or not window_end:
		return 0.0

	if not item_end:
		if item_start < window_start or item_start >= window_end:
			return 0.0
		return flt(fallback_hours, 2)

	overlap_start = max(window_start, item_start)
	overlap_end = min(window_end, item_end)
	if overlap_start >= overlap_end:
		return 0.0

	if fallback_hours and item_end > item_start:
		total_seconds = (item_end - item_start).total_seconds()
		overlap_seconds = (overlap_end - overlap_start).total_seconds()
		return flt(fallback_hours * overlap_seconds / total_seconds, 2)

	return flt((overlap_end - overlap_start).total_seconds() / 3600, 2)


def _iter_planning_day_hours(planning_card):
	if _is_event_card(planning_card):
		return

	card_start = get_datetime(planning_card.start_date) if planning_card.start_date else None
	card_end = get_datetime(planning_card.end_date) if planning_card.end_date else None
	required_hours = flt(planning_card.required_hours or planning_card.duration_in_hours, 2)
	if not card_start or not card_end or required_hours <= 0:
		return

	exclude_weekends = exclude_weekends_from_planning_duration()
	planned_days = count_planning_days(card_start.date(), card_end.date(), exclude_weekends)
	if planned_days <= 0:
		return

	total_daily_hours = flt(getattr(planning_card, "hours_per_employee_per_day", 0) or 0, 2)
	if total_daily_hours <= 0:
		total_daily_hours = flt(required_hours / planned_days, 2)

	current_day = card_start.date()
	last_day = card_end.date()
	remaining_hours = required_hours
	emitted_days = 0
	while current_day <= last_day and remaining_hours > 0:
		if not exclude_weekends or current_day.weekday() < 5:
			day_hours = flt(remaining_hours if emitted_days >= planned_days - 1 else min(total_daily_hours, remaining_hours), 2)
			if day_hours > 0:
				yield current_day, day_hours
			remaining_hours = flt(remaining_hours - day_hours, 2)
			emitted_days += 1
		current_day += timedelta(days=1)


def _get_planned_hours_in_window(window_start, window_end, planning_card) -> float:
	if not window_start or not window_end or _is_event_card(planning_card):
		return 0.0

	range_start = window_start.date()
	range_end = (window_end - timedelta(seconds=1)).date()
	if range_end < range_start:
		return 0.0

	planned_hours = 0.0
	for planning_day, day_hours in _iter_planning_day_hours(planning_card) or []:
		if range_start <= planning_day <= range_end:
			planned_hours += flt(day_hours, 2)

	return flt(planned_hours, 2)


def _get_operation_required_hours(operation: str) -> float:
	if not operation:
		return 0.0

	total_operation_time = frappe.db.get_value(OPERATION_DOCTYPE, operation, "total_operation_time") or 0
	return flt(total_operation_time) / 60


def _get_operation_task_type(operation: str | None) -> str | None:
	if not operation:
		return None

	task_type = frappe.db.get_value(OPERATION_DOCTYPE, operation, "custom_task_type")
	return task_type or None


def _get_card_type(planning_card) -> str:
	return (getattr(planning_card, "card_type", None) or PRODUCTION_CARD_TYPE).strip() or PRODUCTION_CARD_TYPE


def _is_event_card(planning_card) -> bool:
	return _get_card_type(planning_card) == EVENT_CARD_TYPE


def _get_task_type_meta_map(task_type_names) -> dict[str, dict[str, str | None]]:
	task_type_names = _unique_values([(task_type or "").strip() for task_type in task_type_names or [] if task_type])
	if not task_type_names:
		return {}

	fields = ["name"]
	if frappe.db.has_column(TASK_TYPE_DOCTYPE, "custom_color"):
		fields.append("custom_color")
	if frappe.db.has_column(TASK_TYPE_DOCTYPE, "custom_icon"):
		fields.append("custom_icon")

	return {
		row.name: {
			"color": row.get("custom_color"),
			"icon": row.get("custom_icon"),
		}
		for row in frappe.get_all(
			TASK_TYPE_DOCTYPE,
			fields=fields,
			filters={"name": ["in", task_type_names]},
			limit_page_length=0,
		)
	}


def _apply_live_task_type_colors(planning_cards, task_type_colors: dict[str, str | None] | None = None):
	if not planning_cards:
		return planning_cards

	if task_type_colors is None:
		task_type_colors = _get_task_type_meta_map(
			[getattr(planning_card, "task_type", None) for planning_card in planning_cards]
		)

	event_type_meta = _get_event_type_meta_map(
		[
			getattr(planning_card, "event_type", None)
			for planning_card in planning_cards
			if _is_event_card(planning_card)
		]
	)

	for planning_card in planning_cards:
		if _is_event_card(planning_card):
			event_type = (getattr(planning_card, "event_type", None) or "").strip()
			event_meta = event_type_meta.get(event_type, {})
			planning_card.color = event_meta.get("color") or get_event_card_color()
			planning_card.icon = event_meta.get("icon") or get_event_card_icon()
			planning_card.event_type_title = event_meta.get("title") or event_type or None
			continue

		task_type = (getattr(planning_card, "task_type", None) or "").strip()
		task_type_meta = task_type_colors.get(task_type, {}) if task_type else {}
		planning_card.color = task_type_meta.get("color") if task_type else None
		planning_card.icon = task_type_meta.get("icon") if task_type else None
		planning_card.event_type_title = None

	return planning_cards


def _get_event_type_meta_map(event_type_names: list[str] | None) -> dict[str, dict[str, str | None]]:
	names = [(name or "").strip() for name in (event_type_names or []) if (name or "").strip()]
	if not names:
		return {}

	return {
		row.name: {
			"title": row.title or row.name,
			"color": row.color,
			"icon": row.icon,
		}
		for row in frappe.get_all(
			EVENT_TYPE_DOCTYPE,
			fields=["name", "title", "color", "icon"],
			filters={"name": ["in", list(dict.fromkeys(names))]},
			limit_page_length=0,
		)
	}


def _get_planning_cards(
	window_start,
	window_end,
	projects=None,
	task_types=None,
	operations=None,
	event_types=None,
) -> list[dict]:
	card_filters = [
		[PLANNING_CARD_DOCTYPE, "start_date", "<", get_datetime_str(window_end)],
		[PLANNING_CARD_DOCTYPE, "end_date", ">", get_datetime_str(window_start)],
	]
	if projects:
		card_filters.append([PLANNING_CARD_DOCTYPE, "project", "in", projects])
	if task_types:
		card_filters.append([PLANNING_CARD_DOCTYPE, "task_type", "in", task_types])
	if operations:
		card_filters.append([PLANNING_CARD_DOCTYPE, "operation", "in", operations])
	if event_types:
		card_filters.append([PLANNING_CARD_DOCTYPE, "event_type", "in", event_types])

	planning_cards = frappe.get_list(
		PLANNING_CARD_DOCTYPE,
		fields=[
			"name",
			"card_type",
			"project",
			"event_type",
			"elementgruppe",
			"operation",
			"task_type",
			"start_date",
			"start_time",
			"end_date",
			"end_time",
			"required_hours",
			"duration_in_hours",
			"planned_employee_count",
			"hours_per_employee_per_day",
			"adjust_end_date_for_parallel_work",
			"color",
			"description",
			"note",
		],
		filters=card_filters,
		limit_page_length=0,
		order_by="start_date asc",
	)

	if not planning_cards:
		return []

	project_names = {
		row.name: row.project_name or row.name
		for row in frappe.get_all(
			PROJECT_DOCTYPE,
			fields=["name", "project_name"],
			filters={"name": ["in", [card.project for card in planning_cards if card.project]]},
			limit_page_length=0,
		)
	}

	assignments = frappe.get_all(
		PLANNING_CARD_ASSIGNMENT_DOCTYPE,
		fields=["parent", "employee", "employee_name", "from_date", "to_date", "allocated_hours"],
		filters={"parenttype": PLANNING_CARD_DOCTYPE, "parent": ["in", [card.name for card in planning_cards]]},
		order_by="idx asc",
	)

	cards_by_name = {card.name: card for card in planning_cards}
	assignments_by_parent = defaultdict(list)
	for assignment in assignments:
		planning_card = cards_by_name.get(assignment.parent)
		normalized_assignment = _normalize_assignment_row(
			planning_card,
			assignment.employee,
			assignment.employee_name,
			assignment.from_date,
			assignment.to_date,
			assignment.allocated_hours,
		)
		assignments_by_parent[assignment.parent].append(
			normalized_assignment
		)

	for planning_card in planning_cards:
		planning_card.assigned_employees = assignments_by_parent.get(planning_card.name, [])
		planning_card.project_display = project_names.get(planning_card.project, planning_card.project)

	return _apply_live_task_type_colors(planning_cards)


def _get_timesheet_capacity(window_start, window_end, capacity_filters: dict | None = None) -> list[dict]:
	capacity_filters = capacity_filters or {}
	employees = capacity_filters.get("employees")
	departments = capacity_filters.get("departments")
	activity_types = capacity_filters.get("activity_types")

	if (employees == [] and departments in (None, [])) or (departments == [] and employees in (None, [])) or activity_types == []:
		return []

	params = {
		"window_start": get_datetime_str(window_start),
		"window_end": get_datetime_str(window_end),
	}

	employee_department_condition = ""
	employee_department_parts = []
	if employees:
		placeholders = []
		for index, employee in enumerate(employees):
			key = f"employee_{index}"
			params[key] = employee
			placeholders.append(f"%({key})s")
		employee_department_parts.append(f"ts.employee in ({', '.join(placeholders)})")

	if departments:
		placeholders = []
		for index, department in enumerate(departments):
			key = f"department_{index}"
			params[key] = department
			placeholders.append(f"%({key})s")
		employee_department_parts.append(f"ts.department in ({', '.join(placeholders)})")

	if employee_department_parts:
		employee_department_condition = f" and ({' or '.join(employee_department_parts)})"

	activity_condition = ""
	if activity_types:
		placeholders = []
		for index, activity_type in enumerate(activity_types):
			key = f"activity_type_{index}"
			params[key] = activity_type
			placeholders.append(f"%({key})s")
		activity_condition = f" and tsd.activity_type in ({', '.join(placeholders)})"

	return frappe.db.sql(
		f"""
		select
			ts.name as timesheet,
			ts.employee,
			coalesce(ts.employee_name, ts.employee) as employee_name,
			ts.department,
			tsd.activity_type,
			tsd.from_time,
			tsd.to_time,
			tsd.hours
		from `tabTimesheet` ts
		inner join `tabTimesheet Detail` tsd
			on tsd.parent = ts.name
			and tsd.parenttype = 'Timesheet'
		where ts.docstatus in (0, 1)
			and tsd.from_time < %(window_end)s
			and coalesce(tsd.to_time, tsd.from_time) > %(window_start)s
			{employee_department_condition}
			{activity_condition}
		order by coalesce(ts.employee_name, ts.employee), tsd.from_time
		""",
		params,
		as_dict=True,
	)


def _get_absence_days_in_window(row, window_start, window_end) -> float:
	leave_start = getdate(row.from_date)
	leave_end = getdate(row.to_date)
	overlap_start = max(leave_start, window_start.date())
	overlap_end = min(leave_end, window_end.date())
	if overlap_start > overlap_end:
		return 0.0

	overlap_days = float((overlap_end - overlap_start).days + 1)
	if cint(getattr(row, "half_day", 0)):
		half_day_date = getdate(row.half_day_date) if getattr(row, "half_day_date", None) else leave_start
		if overlap_start <= half_day_date <= overlap_end:
			overlap_days -= 0.5

	return flt(max(overlap_days, 0.0), 1)


def _get_absences(window_start, window_end, capacity_filters: dict | None = None) -> list[dict]:
	if not frappe.db.exists("DocType", LEAVE_APPLICATION_DOCTYPE):
		return []

	capacity_filters = capacity_filters or {}
	employees = capacity_filters.get("employees")
	departments = capacity_filters.get("departments")
	leave_allocation_field = (
		"lt.allocation_base" if frappe.db.has_column("Leave Type", "allocation_base") else "'Daily'"
	)
	leave_hours_without_pause_field = (
		"la.leave_hours_without_pause"
		if frappe.db.has_column(LEAVE_APPLICATION_DOCTYPE, "leave_hours_without_pause")
		else "0"
	)

	params = {
		"window_start": str(window_start.date()),
		"window_end": str(window_end.date()),
	}

	filter_parts = []
	if employees:
		placeholders = []
		for index, employee in enumerate(employees):
			key = f"absence_employee_{index}"
			params[key] = employee
			placeholders.append(f"%({key})s")
		filter_parts.append(f"la.employee in ({', '.join(placeholders)})")

	if departments:
		placeholders = []
		for index, department in enumerate(departments):
			key = f"absence_department_{index}"
			params[key] = department
			placeholders.append(f"%({key})s")
		filter_parts.append(f"la.department in ({', '.join(placeholders)})")

	filter_condition = f" and ({' or '.join(filter_parts)})" if filter_parts else ""

	rows = frappe.db.sql(
		f"""
		select
			la.name,
			la.employee,
			coalesce(la.employee_name, la.employee) as employee_name,
			la.department,
			la.leave_type,
			{leave_allocation_field} as allocation_type,
			la.from_date,
			la.to_date,
			la.half_day,
			la.half_day_date,
			la.total_leave_days,
			{leave_hours_without_pause_field} as leave_hours_without_pause
		from `tab{LEAVE_APPLICATION_DOCTYPE}` la
		left join `tabLeave Type` lt
			on lt.name = la.leave_type
		where la.docstatus = 1
			and la.status = 'Approved'
			and la.from_date <= %(window_end)s
			and la.to_date >= %(window_start)s
			{filter_condition}
		order by la.from_date asc, coalesce(la.employee_name, la.employee) asc
		""",
		params,
		as_dict=True,
	)

	absences = []
	for row in rows:
		overlap_days = _get_absence_days_in_window(row, window_start, window_end)
		if not overlap_days:
			continue
		absences.append(
			{
				"name": row.name,
				"employee": row.employee,
				"employee_name": row.employee_name,
				"department": row.department,
				"leave_type": row.leave_type,
				"allocation_type": row.allocation_type or "Daily",
				"from_date": str(row.from_date),
				"to_date": str(row.to_date),
				"overlap_days": overlap_days,
				"total_leave_days": flt(row.total_leave_days),
				"leave_hours_without_pause": flt(row.leave_hours_without_pause),
				"half_day": cint(row.half_day),
				"half_day_date": str(row.half_day_date) if row.half_day_date else None,
			}
		)

	return absences


def _get_daily_absence_summary(
	window_start, window_end, absences: list[dict], hours_per_day: float = DEFAULT_ABSENCE_HOURS_PER_DAY
) -> list[dict]:
	daily_absences = defaultdict(lambda: {"absence_count": 0, "absence_hours": 0.0})
	last_inclusive = (window_end - timedelta(seconds=1)).date()

	for absence in absences:
		absence_start = max(getdate(absence.get("from_date")), window_start.date())
		absence_end = min(getdate(absence.get("to_date")), last_inclusive)
		if absence_start > absence_end:
			continue

		half_day_date = (
			getdate(absence.get("half_day_date"))
			if cint(absence.get("half_day")) and absence.get("half_day_date")
			else None
		)
		current_day = absence_start
		while current_day <= absence_end:
			daily_absences[str(current_day)]["absence_count"] += 1
			daily_absences[str(current_day)]["absence_hours"] += (
				hours_per_day / 2 if half_day_date and current_day == half_day_date else hours_per_day
			)
			current_day += timedelta(days=1)

	return [
		{
			"date": date_key,
			"absence_count": data["absence_count"],
			"absence_hours": round(float(data["absence_hours"]), 2),
		}
		for date_key, data in sorted(daily_absences.items())
	]


def _get_daily_capacity(window_start, window_end, capacity_rows: list[dict]) -> list[dict]:
	daily_capacity = defaultdict(float)
	last_inclusive = (window_end - timedelta(seconds=1)).date()

	for row in capacity_rows:
		row_start = get_datetime(row.from_time)
		row_end = get_datetime(row.to_time) if row.to_time else row_start
		current_day = max(row_start.date(), window_start.date())
		final_day = min(row_end.date(), last_inclusive)

		while current_day <= final_day:
			day_start = datetime.combine(current_day, time.min)
			day_end = day_start + timedelta(days=1)
			daily_capacity[str(current_day)] += get_overlap_hours(
				window_start=max(window_start, day_start),
				window_end=min(window_end, day_end),
				item_start=row_start,
				item_end=row_end,
				fallback_hours=row.hours,
			)
			current_day += timedelta(days=1)

	return [
		{"date": date_key, "capacity_hours": flt(hours, 2)}
		for date_key, hours in sorted(daily_capacity.items())
	]


def _serialize_planning_card(planning_card) -> dict:
	card_type = _get_card_type(planning_card)
	required_hours = flt(planning_card.required_hours or planning_card.duration_in_hours, 2)
	assigned_employees = planning_card.assigned_employees or []
	end_datetime = (
		get_datetime(planning_card.end_date)
		if _is_event_card(planning_card)
		else _get_computed_end_datetime(planning_card, required_hours, assigned_employees)
	)
	total_daily_hours = _get_total_daily_hours(planning_card, assigned_employees)
	project_display = getattr(planning_card, "project_display", None)
	if not project_display and planning_card.project:
		project_display = frappe.db.get_value(PROJECT_DOCTYPE, planning_card.project, "project_name")
	project_display = project_display or planning_card.project
	title_parts = (
		[project_display, planning_card.operation, planning_card.task_type]
		if card_type == PRODUCTION_CARD_TYPE
		else [getattr(planning_card, "event_type_title", None), planning_card.description, project_display]
	)
	return {
		"name": planning_card.name,
		"title": " · ".join(filter(None, title_parts)),
		"card_type": card_type,
		"project": planning_card.project,
		"project_display": project_display,
		"event_type": getattr(planning_card, "event_type", None),
		"event_type_display": getattr(planning_card, "event_type_title", None),
		"elementgruppe": planning_card.elementgruppe,
		"operation": planning_card.operation,
		"task_type": planning_card.task_type,
		"start_date": get_datetime_str(planning_card.start_date),
		"start_time": getattr(planning_card, "start_time", None),
		"end_date": get_datetime_str(end_datetime),
		"end_time": getattr(planning_card, "end_time", None),
		"required_hours": required_hours,
		"duration_in_hours": required_hours,
		"planned_employee_count": _get_planned_employee_count(planning_card, assigned_employees),
		"hours_per_employee_per_day": total_daily_hours,
		"allocated_hours": flt(getattr(planning_card, "allocated_hours", 0), 2),
		"adjust_end_date_for_parallel_work": cint(planning_card.adjust_end_date_for_parallel_work),
		"assigned_employees": assigned_employees,
		"assigned_employee_count": len(assigned_employees),
		"assigned_employee_names": [row["employee_name"] for row in assigned_employees if row.get("employee_name")],
		"color": getattr(planning_card, "color", None),
		"icon": getattr(planning_card, "icon", None),
		"description": getattr(planning_card, "description", None),
		"note": planning_card.note,
	}


def _normalize_assignment_row(planning_card, employee, employee_name=None, from_date=None, to_date=None, allocated_hours=None):
	card_start = get_datetime(planning_card.start_date).date() if planning_card and planning_card.start_date else None
	card_end = get_datetime(planning_card.end_date).date() if planning_card and planning_card.end_date else card_start
	skip_weekends = exclude_weekends_from_planning_duration()

	normalized_from = getdate(from_date) if from_date else card_start
	normalized_to = getdate(to_date) if to_date else card_end
	if card_start:
		normalized_from = max(normalized_from, card_start)
	if card_end:
		normalized_to = min(normalized_to, card_end)

	if normalized_from and normalized_to and normalized_from > normalized_to:
		normalized_from = normalized_to

	if (allocated_hours in (None, "") or flt(allocated_hours) <= 0) and normalized_from and normalized_to:
		planned_days = count_planning_days(normalized_from, normalized_to, skip_weekends)
		allocated_hours = flt(planned_days * _get_assignment_daily_hours(planning_card), 2)

	return {
		"employee": employee,
		"employee_name": employee_name or employee,
		"from_date": str(normalized_from) if normalized_from else None,
		"to_date": str(normalized_to) if normalized_to else None,
		"allocated_hours": flt(allocated_hours, 2),
	}


def _apply_assignments(doc, assigned_employees) -> None:
	doc.set("assigned_employees", [])
	for row in _parse_assigned_employees(assigned_employees):
		doc.append(
			"assigned_employees",
			{
				"employee": row["employee"],
				"from_date": row["from_date"],
				"to_date": row["to_date"],
			},
		)


def _get_computed_end_datetime(planning_card, required_hours: float, assigned_employees: list[dict]):
	start_datetime = get_datetime(planning_card.start_date)
	effective_daily_hours = max(_get_total_daily_hours(planning_card, assigned_employees), 0.01)
	planned_days = max(int(ceil(max(required_hours, 0.01) / effective_daily_hours)), 1)
	last_planned_day = get_last_planned_day(
		start_datetime.date(), planned_days, exclude_weekends_from_planning_duration()
	)
	return datetime.combine(last_planned_day, time(23, 59, 59))


def _get_planning_card_with_assignments(name: str):
	doc_rows = frappe.get_all(
		PLANNING_CARD_DOCTYPE,
		filters={"name": name},
		fields=PLANNING_CARD_FIELDS,
		limit_page_length=1,
	)
	if not doc_rows:
		frappe.throw(_("Planning Card {0} not found").format(name), frappe.DoesNotExistError)

	doc = doc_rows[0]
	assignments = frappe.get_all(
		PLANNING_CARD_ASSIGNMENT_DOCTYPE,
		fields=["employee", "employee_name", "from_date", "to_date", "allocated_hours"],
		filters={"parenttype": PLANNING_CARD_DOCTYPE, "parent": name},
		order_by="idx asc",
	)
	doc.assigned_employees = [
		_normalize_assignment_row(doc, row.employee, row.employee_name, row.from_date, row.to_date, row.allocated_hours)
		for row in assignments
	]
	doc.project_display = frappe.db.get_value(PROJECT_DOCTYPE, doc.project, "project_name") or doc.project
	_apply_live_task_type_colors([doc])
	return doc


def _planning_card_is_accessible(name: str) -> bool:
	if not name:
		return False

	return bool(
		frappe.get_list(
			PLANNING_CARD_DOCTYPE,
			filters={"name": name},
			pluck="name",
			limit_page_length=1,
		)
	)


def _get_employee_planning_load(window_start, window_end) -> list[dict]:
	return frappe.db.sql(
		f"""
		select
			pca.employee,
			coalesce(pca.employee_name, pca.employee) as employee_name,
			pc.name as planning_card,
			pc.project,
			pc.operation,
			pc.start_date,
			pc.end_date,
			pc.required_hours,
			pc.duration_in_hours,
			pc.planned_employee_count,
			pc.hours_per_employee_per_day,
			pc.adjust_end_date_for_parallel_work,
			pca.from_date,
			pca.to_date,
			pca.allocated_hours,
			(
				select count(*)
				from `tab{PLANNING_CARD_ASSIGNMENT_DOCTYPE}` pca_count
				where pca_count.parent = pc.name
					and pca_count.parenttype = %(planning_card_doctype)s
			) as assigned_employee_count
		from `tab{PLANNING_CARD_ASSIGNMENT_DOCTYPE}` pca
		inner join `tab{PLANNING_CARD_DOCTYPE}` pc
			on pc.name = pca.parent
			and pca.parenttype = %(planning_card_doctype)s
		where pc.start_date < %(window_end)s
			and pc.end_date > %(window_start)s
		order by employee_name, pc.start_date
		""",
		{
			"planning_card_doctype": PLANNING_CARD_DOCTYPE,
			"window_start": get_datetime_str(window_start),
			"window_end": get_datetime_str(window_end),
		},
		as_dict=True,
	)


def _get_range_window(card: dict, range_start=None, range_end=None):
	default_start = get_datetime(card["start_date"])
	default_end = get_datetime(card["end_date"])
	if not range_start or not range_end:
		return default_start, default_end

	range_window_start = get_datetime(range_start)
	range_window_end = get_datetime(range_end)
	if range_window_start > range_window_end:
		return default_start, default_end
	return range_window_start, range_window_end


def _assignment_hours_in_window(row, window_start, window_end, card_hours_per_day: float) -> float:
	assignment_start = getdate(row.from_date) if getattr(row, "from_date", None) else window_start.date()
	assignment_end = getdate(row.to_date) if getattr(row, "to_date", None) else window_end.date()
	overlap_start = max(assignment_start, window_start.date())
	overlap_end = min(assignment_end, window_end.date())
	if overlap_start > overlap_end:
		return 0.0

	planned_days = count_planning_days(
		overlap_start, overlap_end, exclude_weekends_from_planning_duration()
	)
	return flt(planned_days * flt(card_hours_per_day or 0), 2)


def _get_task_type_breakdown(window_start, window_end, planning_cards) -> list[dict]:
	task_type_totals = defaultdict(
		lambda: {
			"task_type": None,
			"label": _("Without Task Type"),
			"planned_hours": 0.0,
			"assigned_hours": 0.0,
			"color": None,
		}
	)

	for planning_card in planning_cards:
		if _is_event_card(planning_card):
			continue

		task_type = (planning_card.task_type or "").strip() if planning_card.task_type else None
		bucket_key = task_type or "__without_task_type__"
		bucket = task_type_totals[bucket_key]
		bucket["task_type"] = task_type
		bucket["label"] = task_type or _("Without Task Type")

		bucket["planned_hours"] += _get_planned_hours_in_window(window_start, window_end, planning_card)

		for row in planning_card.assigned_employees or []:
			bucket["assigned_hours"] += _assignment_hours_in_window(
				frappe._dict(row), window_start, window_end, _get_assignment_daily_hours(planning_card)
			)

	task_type_names = [item["task_type"] for item in task_type_totals.values() if item["task_type"]]
	task_type_meta = _get_task_type_meta_map(task_type_names)

	return sorted(
		[
			{
				**item,
				"planned_hours": flt(item["planned_hours"], 2),
				"assigned_hours": flt(item["assigned_hours"], 2),
				"color": (task_type_meta.get(item["task_type"]) or {}).get("color"),
			}
			for item in task_type_totals.values()
			if flt(item["planned_hours"]) > 0 or flt(item["assigned_hours"]) > 0
		],
		key=lambda item: (-(flt(item["planned_hours"]) + flt(item["assigned_hours"])), item["label"]),
	)


@frappe.whitelist()
def get_planning_dashboard_data(
	start_date: str,
	end_date: str,
	activity_types=None,
	projects=None,
	task_types=None,
	operations=None,
	event_types=None,
) -> dict:
	_require_permission(PLANNING_CARD_DOCTYPE, "read")
	_require_permission(TIMESHEET_DOCTYPE, "read")
	if frappe.db.exists("DocType", LEAVE_APPLICATION_DOCTYPE):
		_require_permission(LEAVE_APPLICATION_DOCTYPE, "read")

	window_start, window_end = _get_window(start_date, end_date)
	selected_activity_types = _parse_activity_types(activity_types)
	selected_projects = _parse_link_filter_values(projects)
	selected_task_types = _parse_link_filter_values(task_types)
	selected_operations = _parse_link_filter_values(operations)
	selected_event_types = _parse_link_filter_values(event_types)
	settings = _get_capacity_settings()
	capacity_filters = {
		"employees": settings["employees"] or None,
		"departments": settings["departments"] or None,
		"activity_types": _merge_filter_values(settings["activity_types"], selected_activity_types),
	}
	planning_cards = _get_planning_cards(
		window_start,
		window_end,
		projects=selected_projects,
		task_types=selected_task_types,
		operations=selected_operations,
		event_types=selected_event_types,
	)
	capacity_rows = _get_timesheet_capacity(window_start, window_end, capacity_filters)
	assignment_rows = _get_employee_planning_load(window_start, window_end)
	absences = _get_absences(window_start, window_end, capacity_filters)
	daily_capacity = _get_daily_capacity(window_start, window_end, capacity_rows)
	daily_absences = _get_daily_absence_summary(window_start, window_end, absences)
	task_type_breakdown = _get_task_type_breakdown(window_start, window_end, planning_cards)

	total_planned_hours = 0.0
	for planning_card in planning_cards:
		if _is_event_card(planning_card):
			continue

		total_planned_hours += _get_planned_hours_in_window(window_start, window_end, planning_card)

	employee_capacity = defaultdict(
		lambda: {
			"employee": None,
			"employee_name": _("Unassigned"),
			"department": None,
			"capacity_hours": 0.0,
			"planned_hours": 0.0,
			"timesheet_rows": 0,
			"activity_types": set(),
		}
	)
	for row in capacity_rows:
		row_start = get_datetime(row.from_time)
		row_end = get_datetime(row.to_time) if row.to_time else None
		capacity_hours = get_overlap_hours(window_start, window_end, row_start, row_end, row.hours)

		if not capacity_hours:
			continue

		employee_key = row.employee or _("Unassigned")
		employee_data = employee_capacity[employee_key]
		employee_data["employee"] = row.employee
		employee_data["employee_name"] = row.employee_name or row.employee or _("Unassigned")
		employee_data["department"] = row.department
		employee_data["capacity_hours"] += capacity_hours
		employee_data["timesheet_rows"] += 1
		if row.activity_type:
			employee_data["activity_types"].add(row.activity_type)

	for row in assignment_rows:
		planned_hours = _assignment_hours_in_window(row, window_start, window_end, _get_assignment_daily_hours(row))
		if not planned_hours:
			continue

		employee_key = row.employee or row.employee_name or _("Unassigned")
		employee_data = employee_capacity[employee_key]
		employee_data["employee"] = row.employee
		employee_data["employee_name"] = row.employee_name or row.employee or _("Unassigned")
		employee_data["planned_hours"] += planned_hours

	total_capacity_hours = sum(item["capacity_hours"] for item in employee_capacity.values())
	total_available_hours = flt(total_capacity_hours - total_planned_hours, 2)
	utilization = flt((total_planned_hours / total_capacity_hours) * 100, 1) if total_capacity_hours else 0.0

	capacity_by_employee = sorted(
		[
			{
				**data,
				"capacity_hours": flt(data["capacity_hours"], 2),
				"planned_hours": flt(data["planned_hours"], 2),
				"open_capacity_hours": flt(data["capacity_hours"] - data["planned_hours"], 2),
				"activity_types": sorted(data["activity_types"]),
				"share_percent": flt((data["capacity_hours"] / total_capacity_hours) * 100, 1)
				if total_capacity_hours
				else 0.0,
			}
			for data in employee_capacity.values()
		],
		key=lambda item: (-item["capacity_hours"], -item["planned_hours"], item["employee_name"]),
	)

	return {
		"planning_cards": [_serialize_planning_card(planning_card) for planning_card in planning_cards],
		"summary": {
			"planning_cards_count": len(planning_cards),
			"planned_hours": flt(total_planned_hours, 2),
			"capacity_hours": flt(total_capacity_hours, 2),
			"available_hours": total_available_hours,
			"utilization_percent": utilization,
			"task_type_breakdown": task_type_breakdown,
		},
		"capacity_by_employee": capacity_by_employee,
		"daily_capacity": daily_capacity,
		"daily_absences": daily_absences,
		"absences": absences,
		"selected_activity_types": selected_activity_types,
		"selected_projects": selected_projects,
		"selected_task_types": selected_task_types,
		"selected_operations": selected_operations,
		"selected_event_types": selected_event_types,
		"applied_capacity_filters": capacity_filters,
		"exclude_weekends_from_planning_duration": cint(exclude_weekends_from_planning_duration()),
		"planning_settings": serialize_planning_settings(),
	}


@frappe.whitelist()
def get_planning_card_detail(name: str, activity_types=None, range_start=None, range_end=None) -> dict:
	_require_permission(PLANNING_CARD_DOCTYPE, "read")
	_require_permission(TIMESHEET_DOCTYPE, "read")

	if not _planning_card_is_accessible(name):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	doc = _get_planning_card_with_assignments(name)

	selected_activity_types = _parse_activity_types(activity_types)
	settings = _get_capacity_settings()
	capacity_filters = {
		"employees": settings["employees"] or None,
		"departments": settings["departments"] or None,
		"activity_types": _merge_filter_values(settings["activity_types"], selected_activity_types),
	}
	card = _serialize_planning_card(doc)
	window_start, window_end = _get_range_window(card, range_start, range_end)

	capacity_rows = _get_timesheet_capacity(window_start, window_end, capacity_filters)
	assignment_rows = _get_employee_planning_load(window_start, window_end)

	employees = defaultdict(
		lambda: {
			"employee": None,
			"employee_name": _("Unknown Employee"),
			"department": None,
			"capacity_hours": 0.0,
			"assigned_hours": 0.0,
			"assigned_card_hours": 0.0,
			"assigned_other_hours": 0.0,
			"assigned_project_cards": set(),
			"is_assigned_to_card": 0,
			"activity_types": set(),
			"card_assignment_windows": [],
		}
	)

	for row in capacity_rows:
		row_start = get_datetime(row.from_time)
		row_end = get_datetime(row.to_time) if row.to_time else None
		capacity_hours = get_overlap_hours(window_start, window_end, row_start, row_end, row.hours)
		if not capacity_hours:
			continue

		key = row.employee or row.employee_name or _("Unknown Employee")
		employee = employees[key]
		employee["employee"] = row.employee
		employee["employee_name"] = row.employee_name or row.employee or _("Unknown Employee")
		employee["department"] = row.department
		employee["capacity_hours"] += capacity_hours
		if row.activity_type:
			employee["activity_types"].add(row.activity_type)

	for row in assignment_rows:
		assigned_hours = _assignment_hours_in_window(row, window_start, window_end, _get_assignment_daily_hours(row))
		if not assigned_hours:
			continue

		key = row.employee or row.employee_name or _("Unknown Employee")
		employee = employees[key]
		employee["employee"] = row.employee
		employee["employee_name"] = row.employee_name or row.employee or _("Unknown Employee")
		employee["assigned_hours"] += assigned_hours
		if row.planning_card == doc.name:
			employee["assigned_card_hours"] += assigned_hours
			employee["is_assigned_to_card"] = 1
		else:
			employee["assigned_other_hours"] += assigned_hours
			employee["assigned_project_cards"].add(row.planning_card)

	for assignment in doc.assigned_employees:
		assignment_start = getdate(assignment.get("from_date")) if assignment.get("from_date") else window_start.date()
		assignment_end = getdate(assignment.get("to_date")) if assignment.get("to_date") else window_end.date()
		if assignment_start > window_end.date() or assignment_end < window_start.date():
			continue
		key = assignment["employee"] or assignment["employee_name"]
		employee = employees[key]
		employee["employee"] = assignment["employee"]
		employee["employee_name"] = assignment["employee_name"] or assignment["employee"]
		employee["is_assigned_to_card"] = 1
		employee["card_assignment_windows"].append(
			{
				"from_date": str(assignment.get("from_date")) if assignment.get("from_date") else None,
				"to_date": str(assignment.get("to_date")) if assignment.get("to_date") else None,
				"allocated_hours": flt(assignment.get("allocated_hours"), 2),
				"window_hours": _assignment_hours_in_window(
					frappe._dict(assignment), window_start, window_end, _get_assignment_daily_hours(doc)
				),
			}
		)

	employee_rows = sorted(
		[
			{
				"employee": employee["employee"],
				"employee_name": employee["employee_name"],
				"department": employee["department"],
				"capacity_hours": flt(employee["capacity_hours"], 2),
				"assigned_hours": flt(employee["assigned_hours"], 2),
				"assigned_card_hours": flt(employee["assigned_card_hours"], 2),
				"assigned_other_hours": flt(employee["assigned_other_hours"], 2),
				"assigned_project_count": len(employee["assigned_project_cards"]),
				"remaining_hours": flt(employee["capacity_hours"] - employee["assigned_other_hours"], 2),
				"activity_types": sorted(employee["activity_types"]),
				"is_assigned_to_card": employee["is_assigned_to_card"],
				"card_assignment_windows": sorted(
					employee["card_assignment_windows"],
					key=lambda row: (row.get("from_date") or "", row.get("to_date") or ""),
				),
			}
			for employee in employees.values()
			if employee["employee"] or employee["employee_name"]
		],
		key=lambda item: (
			-item["is_assigned_to_card"],
			-(item["remaining_hours"]),
			-item["capacity_hours"],
			item["employee_name"],
		),
	)

	return {
		"card": card,
		"employees": employee_rows,
		"range_start": get_datetime_str(window_start),
		"range_end": get_datetime_str(window_end),
		"selected_activity_types": selected_activity_types,
		"applied_capacity_filters": capacity_filters,
	}


@frappe.whitelist()
def create_planning_card(
	card_type: str | None = None,
	project: str | None = None,
	event_type: str | None = None,
	start_date: str | None = None,
	end_date: str | None = None,
	operation: str | None = None,
	elementgruppe: str | None = None,
	task_type: str | None = None,
	required_hours=None,
	planned_employee_count=None,
	hours_per_employee_per_day=None,
	start_time: str | None = None,
	end_time: str | None = None,
	assigned_employees=None,
	adjust_end_date_for_parallel_work=0,
	description: str | None = None,
	note: str | None = None,
) -> dict:
	_require_permission(PLANNING_CARD_DOCTYPE, "create")
	card_type = (card_type or PRODUCTION_CARD_TYPE).strip() or PRODUCTION_CARD_TYPE

	doc = frappe.get_doc(
		{
			"doctype": PLANNING_CARD_DOCTYPE,
			"card_type": card_type,
			"project": project or None,
			"event_type": (event_type or None) if card_type == EVENT_CARD_TYPE else None,
			"elementgruppe": elementgruppe if card_type == PRODUCTION_CARD_TYPE else None,
			"operation": operation or None if card_type == PRODUCTION_CARD_TYPE else None,
			"task_type": (task_type or _get_operation_task_type(operation)) if card_type == PRODUCTION_CARD_TYPE else None,
			"start_date": get_datetime_str(get_datetime(start_date)),
			"start_time": _normalize_optional_time_value(start_time),
			"end_date": get_datetime_str(get_datetime(end_date)) if end_date else get_datetime_str(get_datetime(start_date)),
			"end_time": _normalize_optional_time_value(end_time),
			"required_hours": flt(required_hours) or (_get_operation_required_hours(operation) if card_type == PRODUCTION_CARD_TYPE else 0),
			"planned_employee_count": max(cint(planned_employee_count or 0), 0) if card_type == PRODUCTION_CARD_TYPE else 0,
			"hours_per_employee_per_day": (
				flt(hours_per_employee_per_day) or _get_default_total_daily_hours(planned_employee_count)
				if card_type == PRODUCTION_CARD_TYPE
				else 0
			),
			"adjust_end_date_for_parallel_work": cint(adjust_end_date_for_parallel_work) if card_type == PRODUCTION_CARD_TYPE else 0,
			"description": description,
			"note": note,
		}
	)
	if end_date:
		doc.flags.manual_end_date = True
	if card_type == PRODUCTION_CARD_TYPE:
		_apply_assignments(doc, assigned_employees)
	doc.insert()

	doc.assigned_employees = [
		{
			"employee": row.employee,
			"employee_name": row.employee_name or row.employee,
			"from_date": str(row.from_date) if row.from_date else None,
			"to_date": str(row.to_date) if row.to_date else None,
			"allocated_hours": flt(row.allocated_hours, 2),
		}
		for row in doc.assigned_employees
	]
	_apply_live_task_type_colors([doc])
	return _serialize_planning_card(doc)


@frappe.whitelist()
def update_planning_card(
	name: str,
	card_type: str | None = None,
	project: str | None = None,
	event_type: str | None = None,
	elementgruppe: str | None = None,
	operation: str | None = None,
	task_type: str | None = None,
	start_date: str | None = None,
	end_date: str | None = None,
	required_hours=None,
	planned_employee_count=None,
	hours_per_employee_per_day=None,
	start_time: str | None = None,
	end_time: str | None = None,
	assigned_employees=None,
	adjust_end_date_for_parallel_work=None,
	description: str | None = None,
	note: str | None = None,
) -> dict:
	_require_permission(PLANNING_CARD_DOCTYPE, "write")

	doc = frappe.get_doc(PLANNING_CARD_DOCTYPE, name)
	if not doc.has_permission("write"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	next_card_type = (card_type or doc.card_type or PRODUCTION_CARD_TYPE).strip() or PRODUCTION_CARD_TYPE
	doc.card_type = next_card_type
	if project is not None or "project" in frappe.form_dict:
		doc.project = project or None
	if next_card_type == EVENT_CARD_TYPE:
		if event_type is not None or "event_type" in frappe.form_dict:
			doc.event_type = event_type or None
	else:
		doc.event_type = None
	if (elementgruppe is not None or "elementgruppe" in frappe.form_dict) and next_card_type == PRODUCTION_CARD_TYPE:
		doc.elementgruppe = elementgruppe or None
	if (operation is not None or "operation" in frappe.form_dict) and next_card_type == PRODUCTION_CARD_TYPE:
		doc.operation = operation or None
		if task_type is None and doc.operation:
			task_type = _get_operation_task_type(doc.operation)
	if (task_type is not None or "task_type" in frappe.form_dict) and next_card_type == PRODUCTION_CARD_TYPE:
		doc.task_type = task_type or None
	if start_date:
		doc.start_date = get_datetime_str(get_datetime(start_date))
	if start_time is not None or "start_time" in frappe.form_dict:
		doc.start_time = _normalize_optional_time_value(start_time)
	if end_date is not None or "end_date" in frappe.form_dict:
		doc.end_date = get_datetime_str(get_datetime(end_date)) if end_date else None
		if end_date:
			doc.flags.manual_end_date = True
	if end_time is not None or "end_time" in frappe.form_dict:
		doc.end_time = _normalize_optional_time_value(end_time)
	if required_hours not in (None, "") and next_card_type == PRODUCTION_CARD_TYPE:
		doc.required_hours = flt(required_hours)
	if planned_employee_count not in (None, "") and next_card_type == PRODUCTION_CARD_TYPE:
		doc.planned_employee_count = max(cint(planned_employee_count), 0)
	if hours_per_employee_per_day not in (None, "") and next_card_type == PRODUCTION_CARD_TYPE:
		doc.hours_per_employee_per_day = flt(hours_per_employee_per_day)
	if adjust_end_date_for_parallel_work is not None and next_card_type == PRODUCTION_CARD_TYPE:
		doc.adjust_end_date_for_parallel_work = cint(adjust_end_date_for_parallel_work)
	if description is not None or "description" in frappe.form_dict:
		doc.description = description or None
	if note is not None:
		doc.note = note
	if assigned_employees is not None and next_card_type == PRODUCTION_CARD_TYPE:
		_apply_assignments(doc, assigned_employees)

	doc.save()
	doc.assigned_employees = [
		{
			"employee": row.employee,
			"employee_name": row.employee_name or row.employee,
			"from_date": str(row.from_date) if row.from_date else None,
			"to_date": str(row.to_date) if row.to_date else None,
			"allocated_hours": flt(row.allocated_hours, 2),
		}
		for row in doc.assigned_employees
	]
	_apply_live_task_type_colors([doc])
	return _serialize_planning_card(doc)


@frappe.whitelist()
def update_planning_card_schedule(name: str, start_date: str, end_date: str | None = None) -> dict:
	_require_permission(PLANNING_CARD_DOCTYPE, "write")

	doc = frappe.get_doc(PLANNING_CARD_DOCTYPE, name)
	if not doc.has_permission("write"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	original_start = get_datetime(doc.start_date)
	original_end = get_datetime(doc.end_date) if doc.end_date else original_start
	doc.start_date = get_datetime_str(get_datetime(start_date))
	if _is_event_card(doc):
		if end_date:
			next_end = get_datetime(end_date)
			if next_end < get_datetime(doc.start_date):
				next_end = get_datetime(doc.start_date)
			doc.end_date = get_datetime_str(next_end)
		else:
			day_shift = get_datetime(doc.start_date).date() - original_start.date()
			doc.end_date = get_datetime_str(original_end + timedelta(days=day_shift.days))
		doc.save()
		doc.assigned_employees = []
		_apply_live_task_type_colors([doc])
		return _serialize_planning_card(doc)

	if end_date:
		start_dt = get_datetime(doc.start_date)
		end_dt = get_datetime(end_date)
		if end_dt < start_dt:
			end_dt = start_dt

		planned_days = count_planning_days(
			start_dt.date(),
			end_dt.date(),
			doc.should_exclude_weekends(),
		)
		effective_daily_hours = max(_get_total_daily_hours(doc, doc.assigned_employees or []), 0.01)
		if effective_daily_hours <= 0:
			frappe.throw(_("Calculated Hours per Day must be greater than zero"))

		doc.required_hours = flt(max(planned_days, 1) * effective_daily_hours, 2)
		doc.duration_in_hours = doc.required_hours
	doc.save()

	doc.assigned_employees = [
		{
			"employee": row.employee,
			"employee_name": row.employee_name or row.employee,
			"from_date": str(row.from_date) if row.from_date else None,
			"to_date": str(row.to_date) if row.to_date else None,
			"allocated_hours": flt(row.allocated_hours, 2),
		}
		for row in doc.assigned_employees
	]
	_apply_live_task_type_colors([doc])
	return _serialize_planning_card(doc)


@frappe.whitelist()
def delete_planning_card(name: str) -> dict:
	_require_permission(PLANNING_CARD_DOCTYPE, "delete")

	doc = frappe.get_doc(PLANNING_CARD_DOCTYPE, name)
	if not doc.has_permission("delete"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	frappe.delete_doc(PLANNING_CARD_DOCTYPE, name)
	return {"name": name, "deleted": True}
