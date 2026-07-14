import frappe
from frappe import _

from aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning import (
	create_planning_card as _create_planning_card,
	delete_planning_card as _delete_planning_card,
	get_planning_card_detail as _get_planning_card_detail,
	get_planning_dashboard_data as _get_planning_dashboard_data,
	update_planning_card as _update_planning_card,
	update_planning_card_schedule as _update_planning_card_schedule,
)


def _escape_like(value: str) -> str:
	return str(value).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@frappe.whitelist()
def search_project_filter_options(txt: str = "", limit: int = 20) -> list[dict]:
	if not frappe.has_permission("Project", "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	txt = (txt or "").strip()
	limit = min(max(int(limit or 20), 1), 50)
	params = {
		"status": "Open",
		"limit": limit,
	}
	search_condition = ""
	order_by = "coalesce(project_name, name), name"

	if txt:
		params["search"] = f"%{_escape_like(txt)}%"
		params["prefix"] = f"{_escape_like(txt)}%"
		search_condition = """
			and (
				name like %(search)s escape '\\\\'
				or project_name like %(search)s escape '\\\\'
			)
		"""
		order_by = """
			case
				when name like %(prefix)s escape '\\\\' then 0
				when project_name like %(prefix)s escape '\\\\' then 1
				else 2
			end,
			coalesce(project_name, name),
			name
		"""

	rows = frappe.db.sql(
		f"""
		select
			name,
			project_name
		from `tabProject`
		where status = %(status)s
			{search_condition}
		order by {order_by}
		limit %(limit)s
		""",
		params,
		as_dict=True,
	)

	return [
		{
			"value": row.name,
			"label": f"{row.project_name} ({row.name})" if row.project_name and row.project_name != row.name else row.name,
		}
		for row in rows
	]


@frappe.whitelist()
def get_planning_dashboard_data(
	start_date: str,
	end_date: str,
	activity_types=None,
	projects=None,
	task_types=None,
	operations=None,
) -> dict:
	return _get_planning_dashboard_data(
		start_date,
		end_date,
		activity_types,
		projects,
		task_types,
		operations,
	)


@frappe.whitelist()
def get_planning_card_detail(name: str, activity_types=None, range_start=None, range_end=None) -> dict:
	return _get_planning_card_detail(name, activity_types, range_start, range_end)


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
	return _create_planning_card(
		card_type=card_type,
		project=project,
		event_type=event_type,
		elementgruppe=elementgruppe,
		operation=operation,
		task_type=task_type,
		start_date=start_date,
		end_date=end_date,
		required_hours=required_hours,
		planned_employee_count=planned_employee_count,
		hours_per_employee_per_day=hours_per_employee_per_day,
		start_time=start_time,
		end_time=end_time,
		assigned_employees=assigned_employees,
		adjust_end_date_for_parallel_work=adjust_end_date_for_parallel_work,
		description=description,
		note=note,
	)


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
	return _update_planning_card(
		name=name,
		card_type=card_type,
		project=project,
		event_type=event_type,
		elementgruppe=elementgruppe,
		operation=operation,
		task_type=task_type,
		start_date=start_date,
		end_date=end_date,
		required_hours=required_hours,
		planned_employee_count=planned_employee_count,
		hours_per_employee_per_day=hours_per_employee_per_day,
		start_time=start_time,
		end_time=end_time,
		assigned_employees=assigned_employees,
		adjust_end_date_for_parallel_work=adjust_end_date_for_parallel_work,
		description=description,
		note=note,
	)


@frappe.whitelist()
def update_planning_card_schedule(name: str, start_date: str, end_date: str | None = None) -> dict:
	return _update_planning_card_schedule(name, start_date, end_date)


@frappe.whitelist()
def delete_planning_card(name: str) -> dict:
	return _delete_planning_card(name)
