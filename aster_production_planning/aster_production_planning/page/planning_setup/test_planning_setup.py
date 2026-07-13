import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint

from aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning import (
	_merge_filter_values,
)
from aster_production_planning.aster_production_planning.doctype.planning_settings.planning_settings import (
	exclude_weekends_from_planning_duration,
	get_event_card_color,
	get_event_card_icon,
	get_show_absences_in_planning_card_calendar,
)
from aster_production_planning.aster_production_planning.page.planning_setup.planning_setup import (
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

	def test_event_card_color_setting_can_be_changed(self):
		settings = frappe.get_single("Planning Settings")
		original_value = settings.event_card_color

		try:
			settings.event_card_color = "#112233"
			settings.save(ignore_permissions=True)
			self.assertEqual(get_event_card_color(), "#112233")
		finally:
			settings.event_card_color = original_value
			settings.save(ignore_permissions=True)

	def test_event_card_icon_setting_can_be_changed(self):
		settings = frappe.get_single("Planning Settings")
		original_value = settings.event_card_icon

		try:
			settings.event_card_icon = "star"
			settings.save(ignore_permissions=True)
			self.assertEqual(get_event_card_icon(), "star")
		finally:
			settings.event_card_icon = original_value
			settings.save(ignore_permissions=True)

	def test_show_leave_type_setting_can_be_disabled(self):
		settings = frappe.get_single("Planning Settings")
		original_value = cint(settings.show_leave_type_in_planning_studio or 0)

		try:
			settings.show_leave_type_in_planning_studio = 0
			settings.save(ignore_permissions=True)
			settings.reload()
			self.assertEqual(cint(settings.show_leave_type_in_planning_studio or 0), 0)
		finally:
			settings.show_leave_type_in_planning_studio = original_value
			settings.save(ignore_permissions=True)

	def test_show_absences_in_calendar_setting_can_be_disabled(self):
		settings = frappe.get_single("Planning Settings")
		original_value = cint(settings.show_absences_in_planning_card_calendar or 0)

		try:
			settings.show_absences_in_planning_card_calendar = 0
			settings.save(ignore_permissions=True)
			settings.reload()
			self.assertEqual(cint(settings.show_absences_in_planning_card_calendar or 0), 0)
			self.assertEqual(get_show_absences_in_planning_card_calendar(), 0)
		finally:
			settings.show_absences_in_planning_card_calendar = original_value
			settings.save(ignore_permissions=True)
