import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint, get_datetime

from aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning import (
	_assignment_hours_in_window,
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
