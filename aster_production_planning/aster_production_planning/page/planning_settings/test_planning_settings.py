import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint

from aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning import (
	_merge_filter_values,
)
from aster_production_planning.aster_production_planning.doctype.planning_settings.planning_settings import (
	exclude_weekends_from_planning_duration,
)
from aster_production_planning.aster_production_planning.page.planning_settings.planning_settings import (
	_parse_json_list,
)


class TestPlanningSettings(FrappeTestCase):
	def test_parse_json_list_deduplicates_values(self):
		self.assertEqual(_parse_json_list('["EMP-001", "EMP-001", "EMP-002"]'), ["EMP-001", "EMP-002"])

	def test_parse_json_list_accepts_departments(self):
		self.assertEqual(_parse_json_list('["Produktion", "Montage"]'), ["Produktion", "Montage"])

	def test_merge_filter_values_intersects_configured_and_selected_values(self):
		self.assertEqual(
			_merge_filter_values(["Arbeitszeit", "Montage"], ["Arbeitszeit", "Puffer"]),
			["Arbeitszeit"],
		)

	def test_merge_filter_values_returns_none_without_filters(self):
		self.assertIsNone(_merge_filter_values([], []))

	def test_exclude_weekends_setting_can_be_enabled(self):
		settings = frappe.get_single("Planning Settings")
		original_value = cint(settings.exclude_weekends_from_planning_duration or 0)

		try:
			settings.exclude_weekends_from_planning_duration = 1
			settings.save(ignore_permissions=True)
			self.assertTrue(exclude_weekends_from_planning_duration())
		finally:
			settings.exclude_weekends_from_planning_duration = original_value
			settings.save(ignore_permissions=True)
