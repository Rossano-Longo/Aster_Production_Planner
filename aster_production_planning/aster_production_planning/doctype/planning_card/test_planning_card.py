import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint, flt, get_datetime

from aster_production_planning.aster_production_planning.doctype.planning_card.planning_card import (
	EVENT_CARD_TYPE,
	PRODUCTION_CARD_TYPE,
)


class TestPlanningCard(FrappeTestCase):
	def test_card_type_defaults_to_production(self):
		doc = frappe.new_doc("Planning Card")
		doc.project = "_Test Project"
		doc.start_date = "2026-04-16 08:00:00"
		doc.required_hours = 8
		doc.hours_per_employee_per_day = 8

		doc.run_method("validate")

		self.assertEqual(doc.card_type, PRODUCTION_CARD_TYPE)

	def test_event_card_keeps_manual_date_range_and_clears_production_fields(self):
		doc = frappe.new_doc("Planning Card")
		doc.card_type = EVENT_CARD_TYPE
		doc.project = "_Test Project"
		doc.description = "Townhall"
		doc.start_date = "2026-04-16 08:00:00"
		doc.end_date = "2026-04-18 12:00:00"
		doc.operation = "_Test Operation"
		doc.task_type = "Assembly"
		doc.required_hours = 16
		doc.hours_per_employee_per_day = 8
		doc.planned_employee_count = 2
		doc.append("assigned_employees", {"employee": "_Test Employee 1"})

		doc.run_method("validate")

		self.assertEqual(get_datetime(doc.start_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-16 00:00:00")
		self.assertEqual(get_datetime(doc.end_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-18 23:59:59")
		self.assertIsNone(doc.operation)
		self.assertIsNone(doc.task_type)
		self.assertEqual(flt(doc.required_hours), 0.0)
		self.assertEqual(flt(doc.hours_per_employee_per_day), 0.0)
		self.assertEqual(cint(doc.planned_employee_count), 0)
		self.assertEqual(len(doc.assigned_employees), 0)

	def test_optional_times_are_allowed_on_same_day_when_consistent(self):
		doc = frappe.new_doc("Planning Card")
		doc.project = "_Test Project"
		doc.start_date = "2026-04-16 08:00:00"
		doc.required_hours = 8
		doc.hours_per_employee_per_day = 8
		doc.start_time = "09:00:00"
		doc.end_time = "11:30:00"

		doc.run_method("validate")

		self.assertEqual(doc.start_time, "09:00:00")
		self.assertEqual(doc.end_time, "11:30:00")

	def test_end_time_cannot_be_before_start_time_on_same_day(self):
		doc = frappe.new_doc("Planning Card")
		doc.project = "_Test Project"
		doc.start_date = "2026-04-16 08:00:00"
		doc.end_date = "2026-04-16 18:00:00"
		doc.required_hours = 8
		doc.hours_per_employee_per_day = 8
		doc.start_time = "14:00:00"
		doc.end_time = "11:00:00"

		self.assertRaises(frappe.ValidationError, doc.run_method, "validate")

	def test_end_date_is_calculated_from_required_hours_and_daily_capacity(self):
		doc = frappe.new_doc("Planning Card")
		doc.project = "_Test Project"
		doc.operation = "_Test Operation"
		doc.start_date = "2026-04-16 08:00:00"
		doc.required_hours = 16
		doc.hours_per_employee_per_day = 8

		doc.run_method("validate")

		self.assertEqual(
			get_datetime(doc.end_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-17 23:59:59"
		)

	def test_end_date_can_shorten_for_parallel_assignments(self):
		doc = frappe.new_doc("Planning Card")
		doc.project = "_Test Project"
		doc.operation = "_Test Operation"
		doc.start_date = "2026-04-16 08:00:00"
		doc.required_hours = 24
		doc.hours_per_employee_per_day = 4
		doc.adjust_end_date_for_parallel_work = 1
		doc.append("assigned_employees", {"employee": "_Test Employee 1"})
		doc.append("assigned_employees", {"employee": "_Test Employee 2"})

		doc.run_method("validate")

		self.assertEqual(
			get_datetime(doc.end_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-18 23:59:59"
		)

	def test_end_date_and_allocated_hours_skip_weekends_when_setting_is_enabled(self):
		settings = frappe.get_single("Planning Settings")
		original_value = cint(settings.exclude_weekends_from_planning_duration or 0)

		try:
			settings.exclude_weekends_from_planning_duration = 1
			settings.save(ignore_permissions=True)

			doc = frappe.new_doc("Planning Card")
			doc.project = "_Test Project"
			doc.operation = "_Test Operation"
			doc.start_date = "2026-04-17 08:00:00"
			doc.required_hours = 24
			doc.hours_per_employee_per_day = 8
			doc.append("assigned_employees", {"employee": "_Test Employee 1"})

			doc.run_method("validate")

			self.assertEqual(
				get_datetime(doc.end_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-21 23:59:59"
			)
			self.assertEqual(flt(doc.assigned_employees[0].allocated_hours), 24.0)
		finally:
			settings.exclude_weekends_from_planning_duration = original_value
			settings.save(ignore_permissions=True)

	def test_required_hours_can_be_derived_from_manual_end_date_without_employees(self):
		settings = frappe.get_single("Planning Settings")
		original_without_employees = flt(settings.default_hours_per_day_without_employees or 8)

		try:
			settings.default_hours_per_day_without_employees = 6
			settings.save(ignore_permissions=True)

			doc = frappe.new_doc("Planning Card")
			doc.project = "_Test Project"
			doc.start_date = "2026-04-16 08:00:00"
			doc.end_date = "2026-04-18 12:00:00"
			doc.planned_employee_count = 0
			doc.flags.manual_end_date = True

			doc.run_method("validate")

			self.assertEqual(flt(doc.hours_per_employee_per_day), 6.0)
			self.assertEqual(flt(doc.required_hours), 18.0)
			self.assertEqual(get_datetime(doc.end_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-18 23:59:59")
		finally:
			settings.default_hours_per_day_without_employees = original_without_employees
			settings.save(ignore_permissions=True)

	def test_default_daily_hours_follow_employee_setting(self):
		settings = frappe.get_single("Planning Settings")
		original_per_employee = flt(settings.default_hours_per_employee_per_day or 8)

		try:
			settings.default_hours_per_employee_per_day = 7.5
			settings.save(ignore_permissions=True)

			doc = frappe.new_doc("Planning Card")
			doc.project = "_Test Project"
			doc.start_date = "2026-04-16 08:00:00"
			doc.required_hours = 15
			doc.planned_employee_count = 2

			doc.run_method("validate")

			self.assertEqual(flt(doc.hours_per_employee_per_day), 15.0)
			self.assertEqual(get_datetime(doc.end_date).strftime("%Y-%m-%d %H:%M:%S"), "2026-04-16 23:59:59")
		finally:
			settings.default_hours_per_employee_per_day = original_per_employee
			settings.save(ignore_permissions=True)
