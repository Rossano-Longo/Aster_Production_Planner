frappe.ui.form.on("Planning Card", {
	refresh(frm) {
		update_end_date(frm);
	},

	operation(frm) {
		set_required_hours_from_operation(frm);
	},

	start_date(frm) {
		update_end_date(frm);
	},

	required_hours(frm) {
		sync_legacy_duration(frm);
		update_end_date(frm);
	},

	hours_per_employee_per_day(frm) {
		update_end_date(frm);
	},

	adjust_end_date_for_parallel_work(frm) {
		update_end_date(frm);
	},
});

frappe.ui.form.on("Planning Card Assignment", {
	employee(frm) {
		update_end_date(frm);
	},
});

function ensure_planning_duration_settings(frm) {
	if (frm.__exclude_weekends_from_planning_duration !== undefined) {
		return Promise.resolve(frm.__exclude_weekends_from_planning_duration);
	}

	if (frm.__exclude_weekends_from_planning_duration_request) {
		return frm.__exclude_weekends_from_planning_duration_request;
	}

	frm.__exclude_weekends_from_planning_duration_request = frappe.db
		.get_single_value("Planning Settings", "exclude_weekends_from_planning_duration")
		.then((value) => {
			frm.__exclude_weekends_from_planning_duration = cint(value || 0);
			return frm.__exclude_weekends_from_planning_duration;
		})
		.catch(() => {
			frm.__exclude_weekends_from_planning_duration = 0;
			return 0;
		})
		.finally(() => {
			frm.__exclude_weekends_from_planning_duration_request = null;
		});

	return frm.__exclude_weekends_from_planning_duration_request;
}

function update_end_date(frm) {
	ensure_planning_duration_settings(frm).then(() => apply_end_date(frm));
}

function apply_end_date(frm) {
	if (!frm.doc.start_date) {
		return;
	}

	if (frm.doc.required_hours === undefined || frm.doc.required_hours === null || frm.doc.required_hours === "") {
		return;
	}

	const requiredHours = flt(frm.doc.required_hours);
	const hoursPerEmployeePerDay = flt(frm.doc.hours_per_employee_per_day || 0);
	if (requiredHours <= 0 || hoursPerEmployeePerDay <= 0) {
		return;
	}

	const assignments = (frm.doc.assigned_employees || []).filter((row) => row.employee);
	const employeeCount = frm.doc.adjust_end_date_for_parallel_work ? Math.max(assignments.length, 1) : 1;
	const plannedDays = Math.max(Math.ceil(requiredHours / (hoursPerEmployeePerDay * employeeCount)), 1);
	const excludeWeekends = Boolean(cint(frm.__exclude_weekends_from_planning_duration || 0));
	const end_date = get_last_planned_moment(moment(frm.doc.start_date), plannedDays, excludeWeekends).format(
		frappe.defaultDatetimeFormat
	);

	frm.set_value("end_date", end_date);
}

function get_last_planned_moment(startMoment, plannedDays, excludeWeekends) {
	const cursor = startMoment.clone().startOf("day");
	let remainingDays = Math.max(cint(plannedDays || 0), 1);

	while (true) {
		if (!excludeWeekends || cursor.isoWeekday() < 6) {
			remainingDays -= 1;
			if (remainingDays <= 0) {
				return cursor.clone().hour(23).minute(59).second(59);
			}
		}

		cursor.add(1, "day");
	}
}

function sync_legacy_duration(frm) {
	frm.set_value("duration_in_hours", flt(frm.doc.required_hours || 0));
}

function set_required_hours_from_operation(frm) {
	if (!frm.doc.operation) {
		return;
	}

	if (flt(frm.doc.required_hours) > 0) {
		update_end_date(frm);
		return;
	}

	frappe.db.get_value("Operation", frm.doc.operation, "total_operation_time", (response) => {
		const message = response?.message || response || {};
		const totalOperationMinutes = flt(message.total_operation_time || 0);
		if (totalOperationMinutes <= 0) {
			return;
		}

		frm.set_value("required_hours", flt(totalOperationMinutes / 60, 2));
	});
}
