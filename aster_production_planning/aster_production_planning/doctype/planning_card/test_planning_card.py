import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import cint, flt, get_datetime


class TestPlanningCard(FrappeTestCase):
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
