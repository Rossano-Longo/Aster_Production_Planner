from datetime import datetime, time, timedelta
from math import ceil

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, get_datetime, get_datetime_str, getdate

from aster_production_planning.aster_production_planning.doctype.planning_settings.planning_settings import (
	exclude_weekends_from_planning_duration,
	get_default_hours_per_day_without_employees,
	get_default_hours_per_employee_per_day,
)

OPERATION_DOCTYPE = "Operation"


def is_weekend(day) -> bool:
	return getdate(day).weekday() >= 5


def count_planning_days(start_date, end_date, exclude_weekends: bool = False) -> int:
	range_start = getdate(start_date)
	range_end = getdate(end_date)
	if not range_start or not range_end or range_start > range_end:
		return 0

	if not exclude_weekends:
		return (range_end - range_start).days + 1

	current_day = range_start
	planned_days = 0
	while current_day <= range_end:
		if not is_weekend(current_day):
			planned_days += 1
		current_day += timedelta(days=1)

	return planned_days


def get_last_planned_day(start_date, planned_days: int, exclude_weekends: bool = False):
	current_day = getdate(start_date)
	remaining_days = max(int(planned_days), 1)

	while True:
		if not exclude_weekends or not is_weekend(current_day):
			remaining_days -= 1
			if remaining_days <= 0:
				return current_day
		current_day += timedelta(days=1)


class PlanningCard(Document):
	def validate(self):
		self.set_task_type_from_operation()
		self.validate_planning_inputs()
		self.normalize_planning_dates()
		if getattr(getattr(self, "flags", None), "manual_end_date", False) and self.end_date:
			self.set_required_hours_from_end_date()
		else:
			self.set_required_hours()
			self.set_end_date()
		self.set_assignment_defaults()
		self.set_allocated_hours()

	def set_required_hours(self):
		if self.required_hours in (None, "") or flt(self.required_hours) <= 0:
			if self.duration_in_hours not in (None, ""):
				self.required_hours = flt(self.duration_in_hours)
			else:
				self.required_hours = self.get_operation_hours()

		self.required_hours = flt(self.required_hours, 2)
		self.duration_in_hours = self.required_hours

	def validate_planning_inputs(self):
		if not self.start_date:
			return

		assigned_count = self.get_assigned_employee_count()
		if self.planned_employee_count in (None, ""):
			self.planned_employee_count = assigned_count if assigned_count > 0 else 0

		self.planned_employee_count = max(cint(self.planned_employee_count), 0)
		if assigned_count > 0 and self.planned_employee_count <= 0:
			self.planned_employee_count = assigned_count

		if self.hours_per_employee_per_day in (None, ""):
			self.hours_per_employee_per_day = self.get_default_total_daily_hours()

		# Convert legacy cards that stored daily hours per employee while parallel work
		# was enabled into a total daily card capacity.
		if (
			not getattr(self, "flags", None) or not getattr(self.flags, "ignore_parallel_hours_migration", False)
		) and cint(self.adjust_end_date_for_parallel_work) and assigned_count > 1:
			current_daily_hours = flt(self.hours_per_employee_per_day or 0, 2)
			expected_team_hours = flt(assigned_count * self.get_default_employee_hours_per_day(), 2)
			legacy_employee_hours = flt(current_daily_hours * assigned_count, 2)
			if current_daily_hours > 0 and current_daily_hours < expected_team_hours:
				self.hours_per_employee_per_day = legacy_employee_hours

		self.hours_per_employee_per_day = flt(self.hours_per_employee_per_day, 2)
		if self.hours_per_employee_per_day <= 0:
			frappe.throw(_("Calculated Hours per Day must be greater than zero"))

		if (
			not getattr(getattr(self, "flags", None), "manual_end_date", False)
			and flt(self.required_hours or 0) <= 0
		):
			frappe.throw(_("Required Hours must be greater than zero"))

	def get_assigned_employee_count(self) -> int:
		return len([row for row in self.assigned_employees if row.employee])

	def get_planned_employee_count(self) -> int:
		return max(cint(getattr(self, "planned_employee_count", 0) or 0), 0)

	def get_assignment_daily_hours(self) -> float:
		planned_count = self.get_planned_employee_count()
		if planned_count <= 0:
			return flt(self.hours_per_employee_per_day or 0, 2)
		return flt(self.hours_per_employee_per_day or 0, 2) / planned_count

	def get_default_employee_hours_per_day(self) -> float:
		return get_default_hours_per_employee_per_day()

	def get_default_unassigned_hours_per_day(self) -> float:
		return get_default_hours_per_day_without_employees()

	def get_default_total_daily_hours(self) -> float:
		planned_count = self.get_planned_employee_count()
		if planned_count > 0:
			return flt(planned_count * self.get_default_employee_hours_per_day(), 2)
		return flt(self.get_default_unassigned_hours_per_day(), 2)

	def get_operation_hours(self) -> float:
		if not self.operation:
			return 0.0

		total_operation_time = frappe.db.get_value(OPERATION_DOCTYPE, self.operation, "total_operation_time") or 0
		return flt(total_operation_time) / 60

	def set_task_type_from_operation(self):
		if not self.operation:
			return

		if self.task_type:
			return

		task_type = frappe.db.get_value(OPERATION_DOCTYPE, self.operation, "custom_task_type")
		self.task_type = task_type or None

	def get_effective_employee_count(self) -> int:
		return self.get_planned_employee_count()

	def get_assignment_window(self, row) -> tuple:
		card_start = get_datetime(self.start_date)
		card_end = get_datetime(self.end_date) if self.end_date else get_datetime(self.start_date)
		row_start = getdate(row.from_date) if row.from_date else card_start.date()
		row_end = getdate(row.to_date) if row.to_date else card_end.date()
		clamped_start = max(row_start, card_start.date())
		clamped_end = min(row_end, card_end.date())
		return clamped_start, clamped_end

	def get_assignment_hours(self, row) -> float:
		if not row.employee:
			return 0.0

		start_date, end_date = self.get_assignment_window(row)
		if start_date > end_date:
			return 0.0

		planned_days = count_planning_days(start_date, end_date, self.should_exclude_weekends())
		return flt(planned_days * self.get_assignment_daily_hours(), 2)

	def should_exclude_weekends(self) -> bool:
		return exclude_weekends_from_planning_duration()

	def normalize_planning_dates(self):
		if self.start_date:
			start_date = get_datetime(self.start_date)
			self.start_date = get_datetime_str(datetime.combine(start_date.date(), time(0, 0, 0)))
		if self.end_date:
			end_date = get_datetime(self.end_date)
			self.end_date = get_datetime_str(datetime.combine(end_date.date(), time(23, 59, 59)))

	def set_required_hours_from_end_date(self):
		if not self.start_date:
			return

		start_date = get_datetime(self.start_date)
		end_date = get_datetime(self.end_date) if self.end_date else start_date
		if end_date < start_date:
			end_date = start_date
			self.end_date = get_datetime_str(datetime.combine(start_date.date(), time(23, 59, 59)))

		planned_days = count_planning_days(
			start_date.date(),
			end_date.date(),
			self.should_exclude_weekends(),
		)
		self.required_hours = flt(max(planned_days, 1) * flt(self.hours_per_employee_per_day or 0, 2), 2)
		self.duration_in_hours = self.required_hours

	def set_assignment_defaults(self):
		if not self.start_date:
			return

		if not self.end_date:
			self.set_end_date()

		for row in self.assigned_employees:
			if not row.employee:
				continue

			start_date, end_date = self.get_assignment_window(row)
			row.from_date = start_date
			row.to_date = end_date
			row.allocated_hours = self.get_assignment_hours(row)

	def set_allocated_hours(self):
		self.allocated_hours = flt(
			sum(flt(row.allocated_hours) for row in self.assigned_employees if row.employee),
			2,
		)

	def get_planned_days(self) -> int:
		effective_daily_hours = flt(self.hours_per_employee_per_day, 2)
		if effective_daily_hours <= 0:
			frappe.throw(_("Calculated Hours per Day must be greater than zero"))

		return max(int(ceil(flt(self.required_hours) / effective_daily_hours)), 1)

	def set_end_date(self):
		if not self.start_date:
			self.end_date = None
			return

		start_date = get_datetime(self.start_date)
		planned_days = self.get_planned_days()
		last_planned_day = get_last_planned_day(start_date.date(), planned_days, self.should_exclude_weekends())
		end_date = datetime.combine(last_planned_day, time(23, 59, 59))
		self.end_date = get_datetime_str(end_date)


def backfill_planning_cards() -> str:
	updated = 0
	skipped = 0

	for name in frappe.get_all("Planning Card", pluck="name"):
		doc = frappe.get_doc("Planning Card", name)
		if doc.required_hours in (None, "") or flt(doc.required_hours) <= 0:
			doc.required_hours = flt(doc.duration_in_hours) or doc.get_operation_hours()
		if doc.hours_per_employee_per_day in (None, ""):
			doc.hours_per_employee_per_day = doc.get_default_total_daily_hours()
		if flt(doc.required_hours) <= 0:
			skipped += 1
			continue
		doc.save(ignore_permissions=True)
		updated += 1

	frappe.db.commit()
	return _("Planning Cards recalculated: {0} updated, {1} skipped").format(updated, skipped)
