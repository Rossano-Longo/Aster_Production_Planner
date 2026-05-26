import frappe

from aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning import (
	create_planning_card as _create_planning_card,
	get_planning_card_detail as _get_planning_card_detail,
	get_planning_dashboard_data as _get_planning_dashboard_data,
	update_planning_card as _update_planning_card,
	update_planning_card_schedule as _update_planning_card_schedule,
)


@frappe.whitelist()
def get_planning_dashboard_data(start_date: str, end_date: str, activity_types=None) -> dict:
	return _get_planning_dashboard_data(start_date, end_date, activity_types)


@frappe.whitelist()
def get_planning_card_detail(name: str, activity_types=None, range_start=None, range_end=None) -> dict:
	return _get_planning_card_detail(name, activity_types, range_start, range_end)


@frappe.whitelist()
def create_planning_card(
	project: str,
	operation: str,
	start_date: str,
	elementgruppe: str | None = None,
	required_hours=None,
	hours_per_employee_per_day=None,
	assigned_employees=None,
	adjust_end_date_for_parallel_work=0,
	note: str | None = None,
) -> dict:
	return _create_planning_card(
		project=project,
		elementgruppe=elementgruppe,
		operation=operation,
		start_date=start_date,
		required_hours=required_hours,
		hours_per_employee_per_day=hours_per_employee_per_day,
		assigned_employees=assigned_employees,
		adjust_end_date_for_parallel_work=adjust_end_date_for_parallel_work,
		note=note,
	)


@frappe.whitelist()
def update_planning_card(
	name: str,
	project: str | None = None,
	elementgruppe: str | None = None,
	operation: str | None = None,
	start_date: str | None = None,
	required_hours=None,
	hours_per_employee_per_day=None,
	assigned_employees=None,
	adjust_end_date_for_parallel_work=None,
	note: str | None = None,
) -> dict:
	return _update_planning_card(
		name=name,
		project=project,
		elementgruppe=elementgruppe,
		operation=operation,
		start_date=start_date,
		required_hours=required_hours,
		hours_per_employee_per_day=hours_per_employee_per_day,
		assigned_employees=assigned_employees,
		adjust_end_date_for_parallel_work=adjust_end_date_for_parallel_work,
		note=note,
	)


@frappe.whitelist()
def update_planning_card_schedule(name: str, start_date: str, end_date: str | None = None) -> dict:
	return _update_planning_card_schedule(name, start_date, end_date)
