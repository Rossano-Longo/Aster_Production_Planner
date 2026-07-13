frappe.provide("aster_production_planning.planning_setup");

const ASTER_PLANNING_SETTINGS_VERSION = "ps-settings-v6";

frappe.pages["planning-setup"].on_page_load = function (wrapper) {
	wrapper.planning_setup = new aster_production_planning.planning_setup.Page(wrapper);
};

frappe.pages["planning-setup"].refresh = function (wrapper) {
	wrapper.planning_setup?.refresh();
};

aster_production_planning.planning_setup.Page = class PlanningSettingsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.controls = {};

		this.make_page();
		this.make_layout();
		this.make_controls();
		this.bind_actions();
		this.ensure_styles();
		this.refresh();
	}

	make_page() {
		this.page = frappe.ui.make_app_page({
			parent: this.wrapper,
			title: __("Planning Settings"),
			single_column: true,
		});

		$(this.page.main).addClass("aster-planning-settings-page");
	}

	make_layout() {
		this.$layout = $(`
			<div class="aster-settings">
				<div class="aster-settings__hero">
					<div>
						<div class="aster-settings__eyebrow">${__("Planning Settings")} <span>${ASTER_PLANNING_SETTINGS_VERSION}</span></div>
						<h2>${__("Define which timesheet capacity is relevant for planning.")}</h2>
						<p>${__("Leave a list empty if all records of that type should be included. If you choose values, only those are counted as capacity. You can also define whether Planning Card durations should skip weekends.")}</p>
					</div>
				</div>
				<div class="aster-settings__grid">
					<section class="aster-settings__card">
						<h3>${__("Planning Card Duration")}</h3>
						<p>${__("If enabled, Saturdays and Sundays are skipped when Planning Card end dates and allocated hours are calculated. Example: 400 planned hours with 8 hours per day become 50 working days.")}</p>
						<div class="aster-settings__field" data-field="exclude_weekends_from_planning_duration"></div>
						<div class="aster-settings__field" data-field="default_hours_per_employee_per_day"></div>
						<div class="aster-settings__field" data-field="default_hours_per_day_without_employees"></div>
					</section>
					<section class="aster-settings__card">
						<h3>${__("Event Planning Cards")}</h3>
						<p>${__("Define the default appearance of Event Planning Cards in the Planning Studio and calendar views.")}</p>
						<div class="aster-settings__field" data-field="event_card_color"></div>
						<div class="aster-settings__field" data-field="event_card_icon"></div>
						<div class="aster-settings__field" data-field="show_task_type_icon_in_production_cards"></div>
						<div class="aster-settings__field" data-field="show_leave_type_in_planning_studio"></div>
						<div class="aster-settings__field" data-field="show_absences_in_planning_card_calendar"></div>
					</section>
					<section class="aster-settings__card">
						<h3>${__("Employees")}</h3>
						<p>${__("Only these employees are considered as capacity. Empty means all employees.")}</p>
						<div class="aster-settings__field" data-field="employees"></div>
					</section>
					<section class="aster-settings__card">
						<h3>${__("Departments")}</h3>
						<p>${__("All timesheets with one of these departments are considered as capacity. The filter uses the department field directly from the timesheet.")}</p>
						<div class="aster-settings__field" data-field="departments"></div>
					</section>
					<section class="aster-settings__card">
						<h3>${__("Activity Types")}</h3>
						<p>${__("Only these activity types from timesheet rows are counted, for example Arbeitszeit. Empty means all activity types.")}</p>
						<div class="aster-settings__field" data-field="activity_types"></div>
					</section>
				</div>
			</div>
		`).appendTo(this.page.main);
	}

	make_controls() {
		this.controls.exclude_weekends_from_planning_duration = this.make_check_control(
			"exclude_weekends_from_planning_duration",
			__("Exclude weekends from Planning Card duration")
		);
		this.controls.default_hours_per_employee_per_day = this.make_float_control(
			"default_hours_per_employee_per_day",
			__("Default hours per employee per day")
		);
		this.controls.default_hours_per_day_without_employees = this.make_float_control(
			"default_hours_per_day_without_employees",
			__("Default hours per day without employees")
		);
		this.controls.event_card_color = this.make_color_control(
			"event_card_color",
			__("Event card color")
		);
		this.controls.event_card_icon = this.make_icon_control(
			"event_card_icon",
			__("Event card icon")
		);
		this.controls.show_task_type_icon_in_production_cards = this.make_check_control(
			"show_task_type_icon_in_production_cards",
			__("Show Task Type icon on Production Cards")
		);
		this.controls.show_leave_type_in_planning_studio = this.make_check_control(
			"show_leave_type_in_planning_studio",
			__("Show Leave Type in Planning Studio")
		);
		this.controls.show_absences_in_planning_card_calendar = this.make_check_control(
			"show_absences_in_planning_card_calendar",
			__("Show Absences in Planning Card Calendar")
		);
		this.controls.employees = this.make_multiselect_control("employees", __("Employees"), "Employee");
		this.controls.departments = this.make_multiselect_control("departments", __("Departments"), "Department");
		this.controls.activity_types = this.make_multiselect_control("activity_types", __("Activity Types"), "Activity Type");
	}

	make_check_control(fieldname, label) {
		const control = frappe.ui.form.make_control({
			parent: this.$layout.find(`[data-field="${fieldname}"]`).get(0),
			df: {
				fieldname,
				fieldtype: "Check",
				label,
				default: 0,
			},
			render_input: true,
		});

		control.refresh();
		return control;
	}

	make_float_control(fieldname, label) {
		const control = frappe.ui.form.make_control({
			parent: this.$layout.find(`[data-field="${fieldname}"]`).get(0),
			df: {
				fieldname,
				fieldtype: "Float",
				label,
				default: 8,
				precision: 2,
			},
			render_input: true,
		});

		control.refresh();
		return control;
	}

	make_color_control(fieldname, label) {
		const control = frappe.ui.form.make_control({
			parent: this.$layout.find(`[data-field="${fieldname}"]`).get(0),
			df: {
				fieldname,
				fieldtype: "Color",
				label,
				default: "#c35f24",
			},
			render_input: true,
		});

		control.refresh();
		return control;
	}

	make_icon_control(fieldname, label) {
		const control = frappe.ui.form.make_control({
			parent: this.$layout.find(`[data-field="${fieldname}"]`).get(0),
			df: {
				fieldname,
				fieldtype: "Icon",
				label,
				default: "calendar",
			},
			render_input: true,
		});

		control.refresh();
		return control;
	}

	make_multiselect_control(fieldname, label, doctype) {
		const control = frappe.ui.form.make_control({
			parent: this.$layout.find(`[data-field="${fieldname}"]`).get(0),
			df: {
				fieldname,
				fieldtype: "MultiSelectList",
				label,
				placeholder: __("Select one or more"),
				get_data(txt) {
					return frappe.db.get_link_options(doctype, txt);
				},
			},
			render_input: true,
		});

		control.refresh();
		return control;
	}

	bind_actions() {
		this.page.set_primary_action(__("Save"), () => this.save());
		this.page.set_secondary_action(__("Open Planning Studio"), () => frappe.set_route("planning-studio"));
	}

	refresh() {
		frappe.call({
			method: "aster_production_planning.aster_production_planning.page.planning_setup.planning_setup.get_planning_settings",
			callback: (response) => {
				const settings = response.message || {};
				this.controls.exclude_weekends_from_planning_duration.set_value(
					cint(settings.exclude_weekends_from_planning_duration || 0)
				);
				this.controls.default_hours_per_employee_per_day.set_value(
					flt(settings.default_hours_per_employee_per_day || 8, 2)
				);
				this.controls.default_hours_per_day_without_employees.set_value(
					flt(settings.default_hours_per_day_without_employees || 8, 2)
				);
				this.controls.event_card_color.set_value(settings.event_card_color || "#c35f24");
				this.controls.event_card_icon.set_value(settings.event_card_icon || "calendar");
				this.controls.show_task_type_icon_in_production_cards.set_value(
					cint(settings.show_task_type_icon_in_production_cards ?? 1)
				);
				this.controls.show_leave_type_in_planning_studio.set_value(
					cint(settings.show_leave_type_in_planning_studio ?? 1)
				);
				this.controls.show_absences_in_planning_card_calendar.set_value(
					cint(settings.show_absences_in_planning_card_calendar ?? 1)
				);
				this.controls.employees.set_value(settings.employees || []);
				this.controls.departments.set_value(settings.departments || []);
				this.controls.activity_types.set_value(settings.activity_types || []);
			},
		});
	}

	save() {
		frappe.call({
			method: "aster_production_planning.aster_production_planning.page.planning_setup.planning_setup.save_planning_settings",
			args: {
				exclude_weekends_from_planning_duration: cint(
					this.controls.exclude_weekends_from_planning_duration.get_value() || 0
				),
				default_hours_per_employee_per_day: flt(
					this.controls.default_hours_per_employee_per_day.get_value() || 8,
					2
				),
				default_hours_per_day_without_employees: flt(
					this.controls.default_hours_per_day_without_employees.get_value() || 8,
					2
				),
				event_card_color: this.controls.event_card_color.get_value() || "#c35f24",
				event_card_icon: this.controls.event_card_icon.get_value() || "calendar",
				show_task_type_icon_in_production_cards: cint(
					this.controls.show_task_type_icon_in_production_cards.get_value() ?? 1
				),
				show_leave_type_in_planning_studio: cint(
					this.controls.show_leave_type_in_planning_studio.get_value() ?? 1
				),
				show_absences_in_planning_card_calendar: cint(
					this.controls.show_absences_in_planning_card_calendar.get_value() ?? 1
				),
				employees: this.normalize_values(this.controls.employees.get_value()),
				departments: this.normalize_values(this.controls.departments.get_value()),
				activity_types: this.normalize_values(this.controls.activity_types.get_value()),
			},
			callback: () => {
				frappe.show_alert({ message: __("Planning Settings saved"), indicator: "green" });
				this.refresh();
			},
		});
	}

	normalize_values(value) {
		if (!value) {
			return [];
		}
		if (Array.isArray(value)) {
			return value.filter(Boolean);
		}
		if (typeof value === "string") {
			return value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
		}
		return [value];
	}

	ensure_styles() {
		if ($("#aster-planning-settings-styles").length) {
			return;
		}

		$(`<style id="aster-planning-settings-styles">
			.aster-planning-settings-page {
				background: linear-gradient(180deg, #f6f3ec 0%, #fbfaf7 100%);
				min-height: 100%;
			}

			.aster-settings {
				padding: 24px;
			}

			.aster-settings__hero {
				background: linear-gradient(135deg, #24313c 0%, #456173 100%);
				border-radius: 20px;
				color: #fff;
				margin-bottom: 20px;
				padding: 24px;
			}

			.aster-settings__eyebrow {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: .08em;
				margin-bottom: 10px;
				text-transform: uppercase;
			}

			.aster-settings__eyebrow span {
				opacity: .7;
			}

			.aster-settings__hero h2 {
				font-size: 30px;
				line-height: 1.1;
				margin: 0 0 8px;
			}

			.aster-settings__hero p {
				font-size: 14px;
				line-height: 1.6;
				margin: 0;
				max-width: 840px;
				opacity: .9;
			}

			.aster-settings__grid {
				display: grid;
				gap: 18px;
				grid-template-columns: repeat(2, minmax(0, 1fr));
			}

			.aster-settings__card {
				background: #fff;
				border: 1px solid rgba(36, 49, 60, .08);
				border-radius: 18px;
				box-shadow: 0 12px 30px rgba(28, 41, 49, .06);
				padding: 20px;
			}

			.aster-settings__card h3 {
				font-size: 18px;
				margin: 0 0 6px;
			}

			.aster-settings__card p {
				color: #5b6770;
				font-size: 13px;
				line-height: 1.55;
				margin: 0 0 14px;
			}

			.aster-settings__field .form-group {
				margin-bottom: 0;
			}

			.aster-settings__field .checkbox {
				margin: 0;
			}

			@media (max-width: 991px) {
				.aster-settings__grid {
					grid-template-columns: 1fr;
				}

				.aster-settings {
					padding: 16px;
				}
			}
		</style>`).appendTo("head");
	}
};
