frappe.ui.form.on("Planning Card", {
	setup(frm) {
		frm.set_query("task_type", () => get_production_planning_task_type_query());
		frm.set_query("event_type", () => get_event_type_query());
	},

	refresh(frm) {
		apply_card_type_ui(frm);
		update_end_date(frm);
	},

	card_type(frm) {
		apply_card_type_ui(frm);
		update_end_date(frm);
	},

	operation(frm) {
		if (is_event_card(frm)) {
			return;
		}
		load_operation_defaults(frm);
	},

	start_date(frm) {
		update_end_date(frm, frm.__planning_schedule_mode || "required_hours");
	},

	end_date(frm) {
		if (frm.__syncing_planning_schedule) {
			return;
		}

		frm.__planning_schedule_mode = "end_date";
		update_end_date(frm, "end_date");
	},

	required_hours(frm) {
		sync_legacy_duration(frm);
		if (frm.__syncing_planning_schedule) {
			return;
		}

		frm.__planning_schedule_mode = "required_hours";
		update_end_date(frm, "required_hours");
	},

	planned_employee_count(frm) {
		frm.__planning_schedule_mode = "required_hours";
		sync_planned_employee_hours(frm);
		update_end_date(frm, "required_hours");
	},

	hours_per_employee_per_day(frm) {
		update_end_date(frm, frm.__planning_schedule_mode || "required_hours");
	},

	adjust_end_date_for_parallel_work(frm) {
		update_end_date(frm, frm.__planning_schedule_mode || "required_hours");
	},
});

frappe.ui.form.on("Planning Card Assignment", {
	employee(frm) {
		update_end_date(frm);
	},
});

function ensure_planning_duration_settings(frm) {
	if (frm.__planning_duration_settings) {
		return Promise.resolve(frm.__planning_duration_settings);
	}

	if (frm.__planning_duration_settings_request) {
		return frm.__planning_duration_settings_request;
	}

	frm.__planning_duration_settings_request = frappe.call({
		method:
			"aster_production_planning.aster_production_planning.page.planning_setup.planning_setup.get_planning_settings",
	})
		.then((response) => {
			frm.__planning_duration_settings = response?.message || {
				exclude_weekends_from_planning_duration: 0,
				default_hours_per_employee_per_day: 8,
				default_hours_per_day_without_employees: 8,
			};
			return frm.__planning_duration_settings;
		})
		.catch(() => {
			frm.__planning_duration_settings = {
				exclude_weekends_from_planning_duration: 0,
				default_hours_per_employee_per_day: 8,
				default_hours_per_day_without_employees: 8,
			};
			return frm.__planning_duration_settings;
		})
		.finally(() => {
			frm.__planning_duration_settings_request = null;
		});

	return frm.__planning_duration_settings_request;
}

function update_end_date(frm, source = "required_hours") {
	if (is_event_card(frm)) {
		apply_event_end_date(frm);
		return;
	}
	ensure_planning_duration_settings(frm).then(() => apply_end_date(frm, source));
}

function apply_event_end_date(frm) {
	if (!frm.doc.start_date) {
		return;
	}

	const startMoment = moment(frm.doc.start_date).startOf("day");
	let endMoment = frm.doc.end_date ? moment(frm.doc.end_date).startOf("day") : startMoment.clone();
	if (endMoment.isBefore(startMoment, "day")) {
		endMoment = startMoment.clone();
	}

	frm.__syncing_planning_schedule = true;
	Promise.resolve(
		frm.set_value("end_date", endMoment.clone().hour(23).minute(59).second(59).format(frappe.defaultDatetimeFormat))
	).finally(() => {
		frm.__syncing_planning_schedule = false;
	});
}

function apply_end_date(frm, source = "required_hours") {
	if (!frm.doc.start_date) {
		return;
	}

	const hoursPerEmployeePerDay = flt(frm.doc.hours_per_employee_per_day || 0);
	if (hoursPerEmployeePerDay <= 0) {
		return;
	}

	const startMoment = moment(frm.doc.start_date).startOf("day");
	if (source === "end_date") {
		let endMoment = frm.doc.end_date ? moment(frm.doc.end_date).startOf("day") : startMoment.clone();
		if (endMoment.isBefore(startMoment, "day")) {
			endMoment = startMoment.clone();
		}

		const plannedDays = Math.max(
			count_planning_days(startMoment, endMoment, Boolean(cint(frm.__planning_duration_settings?.exclude_weekends_from_planning_duration || 0))),
			1
		);
		const requiredHours = flt(plannedDays * hoursPerEmployeePerDay, 2);

		frm.__syncing_planning_schedule = true;
		Promise.resolve(
			frm.set_value({
				end_date: endMoment.clone().hour(23).minute(59).second(59).format(frappe.defaultDatetimeFormat),
				required_hours: requiredHours,
			})
		).finally(() => {
			frm.__syncing_planning_schedule = false;
		});
		return;
	}

	if (frm.doc.required_hours === undefined || frm.doc.required_hours === null || frm.doc.required_hours === "") {
		return;
	}

	const requiredHours = flt(frm.doc.required_hours);
	if (requiredHours <= 0) {
		return;
	}

	const plannedDays = Math.max(Math.ceil(requiredHours / hoursPerEmployeePerDay), 1);
	const excludeWeekends = Boolean(cint(frm.__planning_duration_settings?.exclude_weekends_from_planning_duration || 0));
	const end_date = get_last_planned_moment(startMoment, plannedDays, excludeWeekends)
		.hour(23)
		.minute(59)
		.second(59)
		.format(frappe.defaultDatetimeFormat);

	frm.__syncing_planning_schedule = true;
	Promise.resolve(frm.set_value("end_date", end_date)).finally(() => {
		frm.__syncing_planning_schedule = false;
	});
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

function sync_planned_employee_hours(frm) {
	if (frm.__syncing_planned_employee_hours) {
		return;
	}

	const plannedEmployeeCount = Math.max(cint(frm.doc.planned_employee_count || 0), 0);
	const totalDailyHours = get_default_total_daily_hours(frm, plannedEmployeeCount);
	const updates = {};

	if (cint(frm.doc.planned_employee_count || 0) !== plannedEmployeeCount) {
		updates.planned_employee_count = plannedEmployeeCount;
	}

	if (flt(frm.doc.hours_per_employee_per_day || 0) !== totalDailyHours) {
		updates.hours_per_employee_per_day = totalDailyHours;
	}

	if (!Object.keys(updates).length) {
		return;
	}

	frm.__syncing_planned_employee_hours = true;
	Promise.resolve(frm.set_value(updates)).finally(() => {
		frm.__syncing_planned_employee_hours = false;
	});
}

function get_default_total_daily_hours(frm, plannedEmployeeCount) {
	const plannedCount = Math.max(cint(plannedEmployeeCount || 0), 0);
	const defaultEmployeeHours = flt(frm.__planning_duration_settings?.default_hours_per_employee_per_day || 8, 2) || 8;
	const defaultUnassignedHours = flt(frm.__planning_duration_settings?.default_hours_per_day_without_employees || 8, 2) || 8;
	return plannedCount > 0 ? flt(plannedCount * defaultEmployeeHours, 2) : defaultUnassignedHours;
}

function count_planning_days(startMoment, endMoment, excludeWeekends) {
	const cursor = startMoment.clone().startOf("day");
	const lastDay = endMoment.clone().startOf("day");
	let plannedDays = 0;

	while (!cursor.isAfter(lastDay, "day")) {
		if (!excludeWeekends || cursor.isoWeekday() < 6) {
			plannedDays += 1;
		}
		cursor.add(1, "day");
	}

	return plannedDays;
}

function load_operation_defaults(frm) {
	if (is_event_card(frm)) {
		return;
	}

	if (!frm.doc.operation) {
		return;
	}

	frappe.db.get_value("Operation", frm.doc.operation, ["total_operation_time", "custom_task_type"], (response) => {
		const message = response?.message || response || {};
		apply_production_planning_task_type(frm, message.custom_task_type || "");

		if (flt(frm.doc.required_hours) > 0) {
			update_end_date(frm);
			return;
		}

		const totalOperationMinutes = flt(message.total_operation_time || 0);
		if (totalOperationMinutes <= 0) {
			return;
		}

		frm.set_value("required_hours", flt(totalOperationMinutes / 60, 2));
	});
}

function get_production_planning_task_type_query() {
	return {
		filters: {
			custom_use_for_production_planning: 1,
		},
	};
}

function apply_production_planning_task_type(frm, taskType) {
	if (!taskType) {
		frm.set_value("task_type", "");
		return;
	}

	frappe.db
		.get_value("Task Type", taskType, "custom_use_for_production_planning")
		.then((response) => {
			const message = response?.message || response || {};
			frm.set_value("task_type", cint(message.custom_use_for_production_planning || message || 0) ? taskType : "");
		})
		.catch(() => {
			frm.set_value("task_type", "");
		});
}

function is_event_card(frm) {
	return (frm.doc.card_type || "Produktion") === "Event";
}

function get_event_type_query() {
	return {
		order_by: "title asc",
	};
}

function apply_card_type_ui(frm) {
	const eventCard = is_event_card(frm);
	const productionFields = [
		"elementgruppe",
		"operation",
		"task_type",
		"required_hours",
		"planned_employee_count",
		"hours_per_employee_per_day",
		"allocated_hours",
		"adjust_end_date_for_parallel_work",
		"assigned_employees",
		"note",
		"color",
	];

	const eventFields = ["event_type", "description"];

	productionFields.forEach((fieldname) => frm.toggle_display(fieldname, !eventCard));
	eventFields.forEach((fieldname) => frm.toggle_display(fieldname, eventCard));
	frm.toggle_display("planning_team_section", !eventCard);
	frm.toggle_display("note", !eventCard);
	frm.toggle_display("description", eventCard);

	frm.set_df_property("required_hours", "reqd", eventCard ? 0 : 1);
	frm.set_df_property("hours_per_employee_per_day", "reqd", eventCard ? 0 : 1);
}
