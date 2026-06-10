import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint, get_datetime

from aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning import (
	_assignment_hours_in_window,
	_get_daily_absence_summary,
	_get_task_type_breakdown,
	get_overlap_hours,
)


class TestCapacityPlanning(FrappeTestCase):
	def test_overlap_hours_for_partial_overlap(self):
		window_start = get_datetime("2026-04-21 08:00:00")
		window_end = get_datetime("2026-04-21 12:00:00")
		item_start = get_datetime("2026-04-21 10:00:00")
		item_end = get_datetime("2026-04-21 14:00:00")

		self.assertEqual(get_overlap_hours(window_start, window_end, item_start, item_end), 2.0)

	def test_overlap_hours_are_prorated_from_fallback_hours(self):
		window_start = get_datetime("2026-04-21 08:00:00")
		window_end = get_datetime("2026-04-21 10:00:00")
		item_start = get_datetime("2026-04-21 08:00:00")
		item_end = get_datetime("2026-04-21 12:00:00")

		self.assertEqual(get_overlap_hours(window_start, window_end, item_start, item_end, 8), 4.0)

	def test_assignment_hours_in_window_skip_weekends_when_setting_is_enabled(self):
		settings = frappe.get_single("Planning Settings")
		original_value = cint(settings.exclude_weekends_from_planning_duration or 0)

		try:
			settings.exclude_weekends_from_planning_duration = 1
			settings.save(ignore_permissions=True)

			row = frappe._dict({"from_date": "2026-04-17", "to_date": "2026-04-21"})
			window_start = get_datetime("2026-04-17 00:00:00")
			window_end = get_datetime("2026-04-21 23:59:59")

			self.assertEqual(_assignment_hours_in_window(row, window_start, window_end, 8), 24.0)
		finally:
			settings.exclude_weekends_from_planning_duration = original_value
			settings.save(ignore_permissions=True)

	def test_daily_absence_summary_splits_half_day_hours(self):
		window_start = get_datetime("2026-04-21 00:00:00")
		window_end = get_datetime("2026-04-24 00:00:00")
		absences = [
			{
				"from_date": "2026-04-21",
				"to_date": "2026-04-22",
				"half_day": 0,
				"half_day_date": None,
			},
			{
				"from_date": "2026-04-22",
				"to_date": "2026-04-23",
				"half_day": 1,
				"half_day_date": "2026-04-23",
			},
		]

		self.assertEqual(
			_get_daily_absence_summary(window_start, window_end, absences),
			[
				{"date": "2026-04-21", "absence_count": 1, "absence_hours": 8.0},
				{"date": "2026-04-22", "absence_count": 2, "absence_hours": 16.0},
				{"date": "2026-04-23", "absence_count": 1, "absence_hours": 4.0},
			],
		)

	def test_task_type_breakdown_groups_planned_and_assigned_hours(self):
		window_start = get_datetime("2026-04-21 00:00:00")
		window_end = get_datetime("2026-04-24 00:00:00")
		planning_cards = [
			frappe._dict(
				{
					"task_type": "Assembly",
					"start_date": "2026-04-21 08:00:00",
					"end_date": "2026-04-22 23:59:59",
					"required_hours": 16,
					"duration_in_hours": 16,
					"hours_per_employee_per_day": 8,
					"assigned_employees": [
						{
							"from_date": "2026-04-21",
							"to_date": "2026-04-22",
							"allocated_hours": 16,
						}
					],
					"adjust_end_date_for_parallel_work": 0,
				}
			),
			frappe._dict(
				{
					"task_type": None,
					"start_date": "2026-04-22 08:00:00",
					"end_date": "2026-04-22 23:59:59",
					"required_hours": 8,
					"duration_in_hours": 8,
					"hours_per_employee_per_day": 8,
					"assigned_employees": [
						{
							"from_date": "2026-04-22",
							"to_date": "2026-04-22",
							"allocated_hours": 8,
						}
					],
					"adjust_end_date_for_parallel_work": 0,
				}
			),
		]

		self.assertEqual(
			_get_task_type_breakdown(window_start, window_end, planning_cards),
			[
				{
					"task_type": "Assembly",
					"label": "Assembly",
					"planned_hours": 16.0,
					"assigned_hours": 16.0,
					"color": None,
				},
				{
					"task_type": None,
					"label": "Without Task Type",
					"planned_hours": 8.0,
					"assigned_hours": 8.0,
					"color": None,
				},
			],
		)
