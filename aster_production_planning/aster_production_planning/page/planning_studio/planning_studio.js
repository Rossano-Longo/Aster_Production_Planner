frappe.provide("aster_production_planning.planning_studio");

frappe.pages["planning-studio"].on_page_load = function (wrapper) {
	wrapper.planning_studio = new aster_production_planning.planning_studio.PlanningStudio(wrapper);
};

frappe.pages["planning-studio"].refresh = function (wrapper) {
	wrapper.planning_studio?.refresh();
};

aster_production_planning.planning_studio.PlanningStudio = class PlanningStudio {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.horizon_mode = "month";
		this.focus_date = moment();
		this.request_id = 0;
		this.detail_request_id = 0;
		this.drag_card_name = null;
		this.card_resize_interaction = null;
		this.assignment_interaction = null;
		this.active_card_name = null;
		this.card_detail = null;
		this.active_week = null;
		this.day_width = 64;
		this.state = {
			planning_cards: [],
			summary: {},
			capacity_by_employee: [],
			daily_capacity: [],
			daily_absences: [],
			absences: [],
		};

		this.make_page();
		this.make_filters();
		this.make_layout();
		this.bind_actions();
		this.ensure_styles();
		this.refresh();
	}

	make_page() {
		this.page = frappe.ui.make_app_page({
			parent: this.wrapper,
			title: __("Planning Studio"),
			single_column: true,
		});

		$(this.page.main).addClass("aster-planning-studio-page");
	}

	make_filters() {
		this.activity_type_filter = this.page.add_field({
			fieldname: "activity_types",
			label: __("Capacity Activities"),
			fieldtype: "MultiSelectList",
			placeholder: __("All activity types"),
			get_data(txt) {
				return frappe.db.get_link_options("Activity Type", txt);
			},
			onchange: () => this.refresh(),
		});
	}

	make_layout() {
		this.$layout = $(`
			<div class="aster-studio">
				<div class="aster-studio__hero">
					<div class="aster-studio__hero-copy">
						<h2>${__("Planning Studio")}</h2>
					</div>
					<div class="aster-studio__hero-actions">
						<div class="aster-studio__mode-switch">
							<button type="button" class="btn btn-default btn-sm aster-studio-mode" data-mode="month">${__("Month")}</button>
							<button type="button" class="btn btn-default btn-sm aster-studio-mode" data-mode="quarter">${__("Quarter")}</button>
						</div>
						<div class="aster-studio__nav">
							<button type="button" class="btn btn-default btn-sm aster-studio-period-nav" data-shift="-1">${__("Prev")}</button>
							<button type="button" class="btn btn-default btn-sm aster-studio-period-nav" data-action="today">${__("Today")}</button>
							<button type="button" class="btn btn-default btn-sm aster-studio-period-nav" data-shift="1">${__("Next")}</button>
						</div>
					</div>
				</div>

				<div class="aster-studio__range"></div>

				<div class="aster-studio__metrics">
					<div class="aster-studio__metric" data-metric="planned_hours"></div>
					<div class="aster-studio__metric" data-metric="capacity_hours"></div>
					<div class="aster-studio__metric" data-metric="available_hours"></div>
				</div>
				<div class="aster-studio__task-type-summary"></div>

				<div class="aster-studio__stack">
					<section class="aster-studio__panel">
						<div class="aster-studio__panel-head">
							<div>
								<h3>${__("Weekly Rough-Cut View")}</h3>
							</div>
							<div class="aster-studio__panel-actions">
								<button type="button" class="btn btn-default btn-sm aster-studio-refresh">${__("Refresh")}</button>
								<button type="button" class="btn btn-default btn-sm aster-studio-open-list">${__("Planning Cards")}</button>
							</div>
						</div>
						<div class="aster-studio__overview-range"></div>
						<div class="aster-studio__overview"></div>
					</section>

					<section class="aster-studio__panel aster-studio__horizon-panel">
						<div class="aster-studio__panel-head">
							<div>
								<h3>${__("Planning Horizon")}</h3>
							</div>
						</div>
						<div class="aster-studio__horizon"></div>
					</section>

					<div class="aster-studio__support">
						<section class="aster-studio__panel">
							<div class="aster-studio__panel-head">
								<div>
									<h3>${__("Employee Capacity")}</h3>
									<p>${__("Draft and submitted timesheet capacity for the visible horizon.")}</p>
								</div>
							</div>
							<div class="aster-studio__employee-list"></div>
						</section>

						<section class="aster-studio__panel">
							<div class="aster-studio__panel-head">
								<div>
									<h3>${__("Absences")}</h3>
									<p>${__("Submitted and approved leave applications in the visible horizon.")}</p>
								</div>
							</div>
							<div class="aster-studio__activity-list"></div>
						</section>
					</div>
				</div>

				<div class="aster-studio-drawer">
					<div class="aster-studio-drawer__backdrop"></div>
					<aside class="aster-studio-drawer__panel">
						<div class="aster-studio-drawer__content"></div>
					</aside>
				</div>
			</div>
		`).appendTo(this.page.main);

		this.$range = this.$layout.find(".aster-studio__range");
		this.$overview_range = this.$layout.find(".aster-studio__overview-range");
		this.$overview = this.$layout.find(".aster-studio__overview");
		this.$horizon = this.$layout.find(".aster-studio__horizon");
		this.$employee_list = this.$layout.find(".aster-studio__employee-list");
		this.$activity_list = this.$layout.find(".aster-studio__activity-list");
		this.$task_type_summary = this.$layout.find(".aster-studio__task-type-summary");
		this.$drawer = this.$layout.find(".aster-studio-drawer");
		this.$drawer_content = this.$layout.find(".aster-studio-drawer__content");
	}

	bind_actions() {
		this.page.set_primary_action(__("New Planning Card"), () => {
			this.open_create_dialog(this.get_focus_window().start.clone().hour(8).minute(0).second(0));
		});

		this.page.clear_secondary_action();
		this.page.clear_menu();
		this.page.add_menu_item(__("Planning Settings"), () => frappe.set_route("planning-setup"));

		this.$layout.on("click", ".aster-studio-refresh", () => this.refresh());
		this.$layout.on("click", ".aster-studio-open-list", () => frappe.set_route("List", "Planning Card"));

		this.$layout.on("click", ".aster-studio-week-pill", (event) => {
			const $pill = $(event.currentTarget);
			const weekStart = $pill.data("weekStart");
			const weekEnd = $pill.data("weekEnd");
			const isAlreadyActive =
				this.active_week &&
				this.active_week.start === weekStart &&
				this.active_week.end === weekEnd;

			this.active_week = isAlreadyActive
				? null
				: {
					start: weekStart,
					end: weekEnd,
				};
			this.render_overview();
			this.render_horizon();
			if (this.active_card_name) {
				this.load_card_detail(this.active_card_name);
			}
		});

		this.$layout.on("click", ".aster-studio-mode", (event) => {
			const mode = $(event.currentTarget).data("mode");
			if (mode && mode !== this.horizon_mode) {
				this.horizon_mode = mode;
				this.refresh();
			}
		});

		this.$layout.on("click", ".aster-studio-period-nav", (event) => {
			const $button = $(event.currentTarget);
			if ($button.data("action") === "today") {
				this.focus_date = moment();
			} else {
				this.focus_date = this.focus_date
					.clone()
					.add(cint($button.data("shift") || 0), this.horizon_mode === "quarter" ? "quarter" : "month");
			}
			this.refresh();
		});

		this.$layout.on("click", ".aster-studio-day__create", (event) => {
			const date = $(event.currentTarget).closest(".aster-studio-horizon-cell").data("date");
			if (date) {
				this.open_create_dialog(moment(date).hour(8).minute(0).second(0));
			}
		});

		this.$layout.on("click", ".aster-studio-card__open", (event) => {
			const name = $(event.currentTarget).closest(".aster-studio-card").data("name");
			if (name) {
				frappe.set_route("Form", "Planning Card", name);
			}
		});

		this.$layout.on("click", ".aster-studio-card__edit", (event) => {
			const card = this.get_card($(event.currentTarget).closest(".aster-studio-card").data("name"));
			if (card) {
				this.open_edit_dialog(card);
			}
		});

		this.$layout.on("click", ".aster-studio-card", (event) => {
			if ($(event.target).closest(".aster-studio-card__assignment-segment").length) {
				return;
			}
			if ($(event.target).closest("button").length) {
				return;
			}
			const card = this.get_card($(event.currentTarget).data("name"));
			if (card) {
				this.open_card_detail(card);
			}
		});

		this.$layout.on("click", ".aster-studio-drawer__close, .aster-studio-drawer__backdrop", () => {
			this.close_card_detail();
		});

		this.$layout.on("click", ".aster-studio-drawer__edit", () => {
			const card = this.get_card(this.active_card_name);
			if (card) {
				this.open_edit_dialog(card);
			}
		});

		this.$layout.on("click", ".aster-studio-drawer__open", () => {
			if (this.active_card_name) {
				frappe.set_route("Form", "Planning Card", this.active_card_name);
			}
		});

		this.$layout.on("click", ".aster-studio-employee__assign", (event) => {
			const employee = $(event.currentTarget).data("employee");
			if (employee) {
				this.toggle_card_assignment(employee);
			}
		});

		this.$layout.on("click", ".aster-studio-card__shift", (event) => {
			const card = this.get_card($(event.currentTarget).closest(".aster-studio-card").data("name"));
			if (!card) {
				return;
			}

			const shift_days = cint($(event.currentTarget).data("shift") || 0);
			const start = this.to_user_moment(card.start_date).add(shift_days, "days");
			this.update_card_schedule(card, start);
		});

		this.$layout.on("dragstart", ".aster-studio-card", (event) => {
			if (
				$(event.target).closest(".aster-studio-card__assignment-segment").length ||
				$(event.target).closest(".aster-studio-card__resize-handle").length
			) {
				event.preventDefault();
				return false;
			}
			const name = $(event.currentTarget).data("name");
			this.drag_card_name = name;
			$(event.currentTarget).addClass("is-dragging");
			event.originalEvent.dataTransfer.effectAllowed = "move";
			event.originalEvent.dataTransfer.setData("text/plain", String(name || ""));
		});

		this.$layout.on("dragend", ".aster-studio-card", (event) => {
			this.drag_card_name = null;
			$(event.currentTarget).removeClass("is-dragging");
			this.$layout.find(".aster-studio-horizon-cell").removeClass("is-drop-target");
		});

		this.$layout.on("dragover", ".aster-studio-horizon-cell", (event) => {
			const $cell = $(event.currentTarget);
			if ($cell.hasClass("is-outside")) {
				return;
			}
			event.preventDefault();
			$cell.addClass("is-drop-target");
		});

		this.$layout.on("dragleave", ".aster-studio-horizon-cell", (event) => {
			$(event.currentTarget).removeClass("is-drop-target");
		});

		this.$layout.on("drop", ".aster-studio-horizon-cell", (event) => {
			const $cell = $(event.currentTarget);
			$cell.removeClass("is-drop-target");
			if ($cell.hasClass("is-outside")) {
				return;
			}

			event.preventDefault();
			const date = $cell.data("date");
			const transferred_name = event.originalEvent.dataTransfer.getData("text/plain");
			const name = transferred_name || this.drag_card_name;
			const card = this.get_card(name);
			if (!card || !date) {
				return;
			}

			const current_start = this.to_user_moment(card.start_date);
			const target_start = moment(date)
				.hour(current_start.hour())
				.minute(current_start.minute())
				.second(0);

			if (target_start.isSame(current_start)) {
				return;
			}

			this.update_card_schedule(card, target_start);
		});

		this.$layout.on("mousedown", ".aster-studio-card__assignment-segment", (event) => {
			if ($(event.target).closest(".aster-studio-card__assignment-handle").length) {
				return;
			}
			this.start_assignment_interaction(event, "move");
		});

		this.$layout.on("mousedown", ".aster-studio-card__assignment-handle--start", (event) => {
			this.start_assignment_interaction(event, "resize-start");
		});

		this.$layout.on("mousedown", ".aster-studio-card__assignment-handle--end", (event) => {
			this.start_assignment_interaction(event, "resize-end");
		});

		this.$layout.on("click", ".aster-studio-card__resize-handle", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});

		this.$layout.on("mousedown", ".aster-studio-card__resize-handle--start", (event) => {
			this.start_card_resize_interaction(event, "resize-start");
		});

		this.$layout.on("mousedown", ".aster-studio-card__resize-handle--end", (event) => {
			this.start_card_resize_interaction(event, "resize-end");
		});

		this.$layout.on("click", ".aster-studio-card__assignment-segment", (event) => {
			event.stopPropagation();
		});

		$(document).on("mousemove.asterPlanningStudio", (event) => {
			this.handle_card_resize_interaction_move(event);
			this.handle_assignment_interaction_move(event);
		});
		$(document).on("mouseup.asterPlanningStudio", () => {
			this.finish_card_resize_interaction();
			this.finish_assignment_interaction();
		});
	}

	refresh() {
		const request_id = ++this.request_id;
		const horizon_window = this.get_horizon_window();

		this.set_loading(true);
		this.update_labels(horizon_window);
		this.update_mode_buttons();

		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.get_planning_dashboard_data",
			args: {
				start_date: this.to_system_datetime(horizon_window.start),
				end_date: this.to_system_datetime(horizon_window.end),
				activity_types: this.get_selected_activity_types(),
			},
			callback: (response) => {
				if (request_id !== this.request_id) {
					return;
				}

				this.state = response.message || this.state;
				this.render_metrics();
				this.render_overview();
				this.render_horizon();
				this.render_employee_list();
				this.render_absence_list();
				if (this.active_card_name) {
					const activeCard = this.get_card(this.active_card_name);
					if (activeCard) {
						this.load_card_detail(this.active_card_name);
					} else {
						this.close_card_detail();
					}
				}
			},
			always: () => {
				if (request_id === this.request_id) {
					this.set_loading(false);
				}
			},
		});
	}

	update_labels(horizon_window) {
		const focusWindow = this.get_focus_window();
		const horizon_title = this.horizon_mode === "quarter" ? __("Quarter") : __("Month");
		this.$range.text(
			`${horizon_title}: ${focusWindow.start.format("DD MMM YYYY")} - ${focusWindow.end.clone().subtract(1, "day").format("DD MMM YYYY")}`
		);
		this.$overview_range.text(
			`${__("Focused horizon")}: ${this.focus_date.format(this.horizon_mode === "quarter" ? "[Q]Q YYYY" : "MMMM YYYY")}`
		);
	}

	update_mode_buttons() {
		this.$layout.find(".aster-studio-mode").each((_, element) => {
			const $button = $(element);
			$button.toggleClass("is-active", $button.data("mode") === this.horizon_mode);
		});
	}

	render_metrics() {
		const summary = this.state.summary || {};
		const metrics = [
			{
				key: "capacity_hours",
				label: __("Adjusted Capacity"),
				value: this.format_hours_with_unit(summary.capacity_hours),
				meta: __("Draft and submitted timesheet capacity in this horizon"),
			},
			{
				key: "planned_hours",
				label: __("Planned Hours"),
				value: this.format_hours_with_unit(summary.planned_hours),
				meta: `${this.format_percent(summary.utilization_percent)} ${__("utilization in horizon")}`,
			},
			{
				key: "available_hours",
				label: summary.available_hours >= 0 ? __("Open Capacity") : __("Overload"),
				value: this.format_hours_with_unit(summary.available_hours || 0),
				meta:
					summary.available_hours >= 0
						? __("Adjusted capacity minus planned hours")
						: __("Adjusted capacity minus planned hours"),
				state: summary.available_hours >= 0 ? "good" : "danger",
			},
		];

		metrics.forEach((metric) => {
			this.$layout.find(`[data-metric="${metric.key}"]`)
				.toggleClass("is-danger", metric.state === "danger")
				.toggleClass("is-good", metric.state === "good")
				.html(`
				<div class="aster-studio__metric-label">${metric.label}</div>
				<div class="aster-studio__metric-value">${metric.value}</div>
				<div class="aster-studio__metric-meta">${metric.meta}</div>
			`);
		});

		this.render_task_type_summary(summary.task_type_breakdown || []);
	}

	render_task_type_summary(rows) {
		if (!rows.length) {
			this.$task_type_summary.empty();
			return;
		}

		this.$task_type_summary.html(`
			<div class="aster-studio__task-type-card">
				<div class="aster-studio__task-type-head">
					<div>
						<h3>${__("Task Type Hours")}</h3>
						<p>${__("Planned and assigned hours in the visible horizon.")}</p>
					</div>
				</div>
				<div class="aster-studio__task-type-table">
					<div class="aster-studio__task-type-row is-head">
						<div>${__("Task Type")}</div>
						<div>${__("Planned Hours")}</div>
						<div>${__("Assigned Hours")}</div>
					</div>
					${rows
						.map(
							(row) => `
								<div class="aster-studio__task-type-row">
									<div class="aster-studio__task-type-label">
										<span class="aster-studio__task-type-swatch" style="background:${row.color || "rgba(157, 18, 255, 0.18)"}"></span>
										<span>${frappe.utils.escape_html(row.label || __("Without Task Type"))}</span>
									</div>
									<div>${this.format_hours_with_unit(row.planned_hours)}</div>
									<div>${this.format_hours_with_unit(row.assigned_hours)}</div>
								</div>
							`
						)
						.join("")}
				</div>
			</div>
		`);
	}

	render_overview() {
		const weeks = this.build_horizon_weeks();
		this.$overview.html(`
			<div class="aster-studio-overview">
				${weeks
					.map((week) => {
						const weekStart = week.start.format("YYYY-MM-DD");
						const weekEnd = week.end.clone().subtract(1, "day").format("YYYY-MM-DD");
						const isActive =
							this.active_week &&
							this.active_week.start === weekStart &&
							this.active_week.end === weekEnd;
						const tags = week.cards
							.slice(0, 4)
							.map(
								(card) =>
									`<span class="aster-studio-week-pill__tag">${frappe.utils.escape_html(
										card.project_display || card.project || ""
									)}</span>`
							)
							.join("");
						const more =
							week.cards.length > 4
								? `<span class="aster-studio-week-pill__more">+${week.cards.length - 4}</span>`
								: "";

						return `
							<div
								class="aster-studio-week-pill ${isActive ? "is-active" : ""}"
								data-week-start="${weekStart}"
								data-week-end="${weekEnd}"
							>
								<div class="aster-studio-week-pill__head">
									<div>
										<div class="aster-studio-week-pill__label">${__("Week {0}", [week.start.isoWeek()])}</div>
										<div class="aster-studio-week-pill__date">${week.start.format("DD MMM")} - ${week.end.clone().subtract(1, "day").format("DD MMM")}</div>
									</div>
									<div class="aster-studio-week-pill__value">${this.format_hours_with_unit(week.planned_hours)}</div>
								</div>
								<div class="aster-studio-week-pill__meta">
									<span>${__("{0} adjusted capacity", [this.format_hours_with_unit(week.capacity_hours)])}</span>
									<span class="${week.available_hours < 0 ? "is-negative" : ""}">${__("{0} open", [this.format_hours_with_unit(week.available_hours)])}</span>
								</div>
								${this.get_week_capacity_bar_markup(week)}
								<div class="aster-studio-week-pill__tags">${tags}${more}</div>
							</div>
						`;
					})
					.join("")}
			</div>
		`);
	}

	get_week_capacity_bar_markup(week) {
		const capacity = flt(week.capacity_hours || 0);
		const planned = flt(week.planned_hours || 0);
		const open = flt(week.available_hours || 0);
		const utilizationPercent = capacity > 0 ? Math.min((planned / capacity) * 100, 100) : 0;
		const openPercent = capacity > 0 ? Math.max((Math.max(open, 0) / capacity) * 100, 0) : 0;
		const overloaded = open < 0;

		return `
			<div class="aster-studio-week-pill__capacity">
				<div class="aster-studio-week-pill__capacity-bar ${overloaded ? "is-overloaded" : ""}">
					<span class="is-planned" style="width:${utilizationPercent}%"></span>
					<span class="is-open" style="width:${openPercent}%"></span>
				</div>
			</div>
		`;
	}

	render_horizon() {
		const horizon_window = this.get_horizon_window();
		const days = this.build_horizon_days(horizon_window);
		const segments = this.build_horizon_card_segments(horizon_window);

		this.$horizon.html(`
			<div class="aster-studio-horizon aster-studio-horizon--continuous">
				<div
					class="aster-studio-horizon__timeline"
					style="--day-count:${Math.max(days.length, 1)}; --lane-count:${Math.max(segments.lane_count, 1)}; --lane-height:${segments.lane_height}px"
				>
					<div class="aster-studio-horizon__head aster-studio-horizon__head--continuous">
						${days.map((day) => this.get_day_header_markup(day)).join("")}
					</div>
					<div class="aster-studio-horizon__body aster-studio-horizon__body--continuous">
						${days.map((day) => this.get_day_cell_markup(day)).join("")}
						<div class="aster-studio-horizon__bars">
							${
								segments.items.length
									? segments.items.map((segment) => this.get_card_bar_markup(segment)).join("")
									: `<div class="aster-studio-horizon__empty-note">${__("Create or drag planning cards into this planning grid.")}</div>`
							}
						</div>
					</div>
				</div>
			</div>
		`);

		this.center_active_week_in_horizon();
	}

	build_horizon_days(horizon_window = this.get_horizon_window()) {
		const capacityByDay = this.get_daily_capacity_map();
		const absencesByDay = this.get_daily_absence_map();
		const days = [];
		let cursor = horizon_window.start.clone();
		while (cursor.isBefore(horizon_window.end, "day")) {
			const dateKey = cursor.format("YYYY-MM-DD");
			const absenceSummary = absencesByDay[dateKey] || {};
			days.push({
				date: cursor.clone(),
				capacity_hours: flt(capacityByDay[dateKey] || 0),
				absence_count: cint(absenceSummary.absence_count || 0),
				absence_hours: flt(absenceSummary.absence_hours || 0),
				has_absence: cint(absenceSummary.absence_count || 0) > 0,
				is_weekend: cursor.isoWeekday() >= 6,
				is_today: cursor.isSame(moment(), "day"),
				is_active_week: this.is_day_in_active_week(cursor),
			});
			cursor.add(1, "day");
		}
		return days;
	}

	build_horizon_weeks(include_days = false) {
		const horizon_window = this.get_horizon_window();
		const all_cards = this.state.planning_cards || [];
		const all_capacity = this.state.capacity_by_employee || [];
		const weeks = [];
		let cursor = horizon_window.start.clone().startOf("isoWeek");

		while (cursor.isBefore(horizon_window.end)) {
			const week_start = cursor.clone();
			const week_end = cursor.clone().add(7, "days");
			const week_cards = all_cards.filter((card) => {
				const start = this.to_user_moment(card.start_date);
				const end = this.to_user_moment(card.end_date);
				return start.isBefore(week_end) && end.isAfter(week_start);
			});

			const planned_hours = week_cards.reduce((sum, card) => {
				return (
					sum +
					this.get_overlap_hours(
						week_start,
						week_end,
						this.to_user_moment(card.start_date),
						this.to_user_moment(card.end_date),
						flt(card.required_hours || card.duration_in_hours)
					)
				);
			}, 0);

			const capacity_hours = this.estimate_week_capacity(week_start, week_end, all_capacity, horizon_window);
			const week = {
				start: week_start,
				end: week_end,
				cards: week_cards,
				planned_hours,
				capacity_hours,
				available_hours: flt(capacity_hours - planned_hours, 2),
			};

			if (include_days) {
				week.days = Array.from({ length: 7 }, (_, index) => {
					const date = week_start.clone().add(index, "days");
					return {
						date,
						is_outside: date.isBefore(horizon_window.start, "day") || !date.isBefore(horizon_window.end, "day"),
						is_weekend: date.isoWeekday() >= 6,
					};
				});
			}

			weeks.push(week);
			cursor.add(7, "days");
		}

		return weeks;
	}

	estimate_week_capacity(week_start, week_end, capacity_rows, horizon_window) {
		const total_horizon_capacity = capacity_rows.reduce((sum, item) => sum + flt(item.capacity_hours), 0);
		const total_days = Math.max(horizon_window.end.diff(horizon_window.start, "days"), 1);
		const week_days = Math.max(week_end.diff(week_start, "days"), 1);
		return flt((total_horizon_capacity / total_days) * week_days, 2);
	}

	build_horizon_card_segments(horizon_window = this.get_horizon_window()) {
		const sortedCards = [...(this.state.planning_cards || [])]
			.filter((card) => {
				const start = this.to_user_moment(card.start_date);
				const end = this.to_user_moment(card.end_date);
				return start.isBefore(horizon_window.end) && end.isAfter(horizon_window.start);
			})
			.sort((left, right) => {
			const leftStart = this.to_user_moment(left.start_date).valueOf();
			const rightStart = this.to_user_moment(right.start_date).valueOf();
			if (leftStart !== rightStart) {
				return leftStart - rightStart;
			}

			const leftDuration = this.to_user_moment(left.end_date).diff(this.to_user_moment(left.start_date), "days", true);
			const rightDuration = this.to_user_moment(right.end_date).diff(this.to_user_moment(right.start_date), "days", true);
			return rightDuration - leftDuration;
			});
		const laneEnds = [];
		let maxAssignmentRows = 1;
		const items = sortedCards.map((card) => {
			const cardStart = this.to_user_moment(card.start_date);
			const cardEnd = this.to_user_moment(card.end_date);
			const segmentStart = moment.max(cardStart.clone().startOf("day"), horizon_window.start.clone());
			const segmentEnd = moment.min(cardEnd.clone().endOf("day"), horizon_window.end.clone().subtract(1, "second"));
			const startColumn = Math.max(segmentStart.diff(horizon_window.start, "days"), 0) + 1;
			const endColumn = Math.max(segmentEnd.diff(horizon_window.start, "days"), 0) + 1;

			let laneIndex = 0;
			while (laneEnds[laneIndex] !== undefined && laneEnds[laneIndex] >= startColumn) {
				laneIndex += 1;
			}
			laneEnds[laneIndex] = endColumn;
			maxAssignmentRows = Math.max(maxAssignmentRows, Math.max((card.assigned_employees || []).length, 1));

			return {
				card,
				start_column: startColumn,
				end_column: Math.max(endColumn, startColumn),
				lane_index: laneIndex,
				visible_start: segmentStart.clone().startOf("day"),
				visible_end: segmentEnd.clone().startOf("day"),
			};
		});

		return {
			items,
			lane_count: laneEnds.length,
			lane_height: 34 + Math.min(maxAssignmentRows, 4) * 18,
		};
	}

	get_day_header_markup(day) {
		return `
			<div class="aster-studio-horizon__day-header ${day.is_weekend ? "is-weekend" : ""} ${day.is_today ? "is-today" : ""} ${day.is_active_week ? "is-active-week" : ""} ${day.has_absence ? "has-absence" : ""}">
				<div class="aster-studio-horizon__day-name">${day.date.format("ddd")}</div>
				<div class="aster-studio-horizon__day-number">${day.date.format("DD.MM")}</div>
				<div class="aster-studio-horizon__day-capacity">${flt(day.capacity_hours) > 0 ? this.format_hours_with_unit(day.capacity_hours) : "-"}</div>
				${
					flt(day.absence_hours) > 0
						? `<div class="aster-studio-horizon__day-absence">${__("Absence")}: ${this.format_hours_with_unit(day.absence_hours)}</div>`
						: ""
				}
			</div>
		`;
	}

	get_day_cell_markup(day) {
		const date_key = day.date.format("YYYY-MM-DD");
		return `
			<div
				class="aster-studio-horizon-cell ${day.is_weekend ? "is-weekend" : ""} ${day.is_today ? "is-today" : ""} ${day.is_active_week ? "is-active-week" : ""}"
				data-date="${date_key}"
			>
				<div class="aster-studio-horizon-cell__actions">
					<button type="button" class="aster-studio-day__create" title="${__("New Planning Card")}" aria-label="${__("New Planning Card")}">+</button>
				</div>
			</div>
		`;
	}

	get_card_bar_markup(segment) {
		const { card, start_column, end_column, lane_index } = segment;
		const cardColor = card.color || "#2f6f61";
		const cardTextColor = this.get_contrast_text_color(cardColor);
		const projectLabel = card.project_display || card.project;
		const subtitleLabel = [card.elementgruppe, card.operation].filter(Boolean).join(" · ");
		const assignmentMarkup = this.get_card_assignment_segments_markup(card, segment);
		const weekHighlightMarkup = this.get_card_week_highlight_markup(segment);

		return `
			<div
				class="aster-studio-card"
				data-name="${frappe.utils.escape_html(card.name)}"
				data-visible-start="${segment.visible_start.format("YYYY-MM-DD")}"
				data-visible-end="${segment.visible_end.format("YYYY-MM-DD")}"
				draggable="true"
				style="--card-color:${cardColor}; --card-text-color:${cardTextColor}; --card-column-start:${start_column}; --card-column-end:${end_column + 1}; --card-lane:${lane_index + 1}; --assignment-rows:${Math.max((card.assigned_employees || []).length, 1)};"
				title="${frappe.utils.escape_html([projectLabel, card.elementgruppe, card.operation].filter(Boolean).join(" · "))}"
			>
				<span class="aster-studio-card__resize-handle aster-studio-card__resize-handle--start" title="${__("Adjust duration")}" aria-hidden="true"></span>
				<span class="aster-studio-card__resize-handle aster-studio-card__resize-handle--end" title="${__("Adjust duration")}" aria-hidden="true"></span>
				${weekHighlightMarkup}
				<div class="aster-studio-card__header">
					<div class="aster-studio-card__title">${frappe.utils.escape_html(projectLabel)}</div>
					${
						subtitleLabel
							? `<div class="aster-studio-card__subtitle">${frappe.utils.escape_html(subtitleLabel)}</div>`
							: ""
					}
				</div>
				${assignmentMarkup}
			</div>
		`;
	}

	get_daily_capacity_map() {
		return Object.fromEntries(
			(this.state.daily_capacity || []).map((row) => [row.date, flt(row.capacity_hours)])
		);
	}

	get_daily_absence_map() {
		return Object.fromEntries(
			(this.state.daily_absences || []).map((row) => [
				row.date,
				{
					absence_count: cint(row.absence_count || 0),
					absence_hours: flt(row.absence_hours || 0),
				},
			])
		);
	}

	get_card_markup(card) {
		return `
			<div
				class="aster-studio-card"
				data-name="${frappe.utils.escape_html(card.name)}"
				draggable="true"
				style="--card-color:${card.color || "#2f6f61"}"
			>
				<div class="aster-studio-card__title">${frappe.utils.escape_html(card.project)}</div>
				<div class="aster-studio-card__subtitle">${frappe.utils.escape_html(card.operation)}</div>
			</div>
		`;
	}

	render_employee_list() {
		const items = this.state.capacity_by_employee || [];
		if (!items.length) {
			this.$employee_list.html(`<div class="aster-studio__empty">${__("No draft capacity found in this horizon.")}</div>`);
			return;
		}

		this.$employee_list.html(`
			<div class="aster-studio__capacity-table-card">
				<div class="aster-studio__capacity-table">
					<div class="aster-studio__capacity-table-row is-head">
						<div>${__("Employee")}</div>
						<div>${__("Adjusted Capacity")}</div>
						<div>${__("Planned Hours")}</div>
						<div>${__("Open Capacity")}</div>
					</div>
					${items
						.map(
							(item) => `
								<div class="aster-studio__capacity-table-row">
									<div class="aster-studio__capacity-table-name">${frappe.utils.escape_html(item.employee_name || "")}</div>
									<div class="aster-studio__capacity-table-value">${this.format_hours_with_unit(item.capacity_hours)}</div>
									<div class="aster-studio__capacity-table-value">${this.format_hours_with_unit(item.planned_hours)}</div>
									<div class="aster-studio__capacity-table-value ${flt(item.open_capacity_hours) < 0 ? "is-negative" : ""}">${this.format_hours_with_unit(item.open_capacity_hours)}</div>
								</div>
							`
						)
						.join("")}
				</div>
			</div>
		`);
	}

	render_absence_list() {
		const items = this.state.absences || [];
		if (!items.length) {
			this.$activity_list.html(`<div class="aster-studio__empty">${__("No submitted absences in this horizon.")}</div>`);
			return;
		}

		this.$activity_list.html(`
			<div class="aster-studio__absence-table-card">
				<div class="aster-studio__absence-table">
					<div class="aster-studio__absence-table-row is-head">
						<div>${__("Employee")}</div>
						<div>${__("Leave")}</div>
						<div>${__("Period")}</div>
						<div>${__("Duration")}</div>
					</div>
					${items
						.map(
							(item) => `
								<div class="aster-studio__absence-table-row">
									<div class="aster-studio__absence-table-name">${frappe.utils.escape_html(item.employee_name || "")}</div>
									<div>${frappe.utils.escape_html(item.leave_type || __("Leave"))}</div>
									<div>${this.get_absence_schedule_markup(item)}</div>
									<div class="aster-studio__absence-table-duration">${this.format_absence_duration(item)}</div>
								</div>
							`
						)
						.join("")}
				</div>
			</div>
		`);
	}

	open_card_detail(card) {
		if (!card?.name) {
			return;
		}

		this.active_card_name = card.name;
		this.card_detail = null;
		this.$drawer.addClass("is-open");
		this.render_card_detail_loading(card);
		this.load_card_detail(card.name);
	}

	close_card_detail() {
		this.active_card_name = null;
		this.card_detail = null;
		this.$drawer.removeClass("is-open");
	}

	load_card_detail(name) {
		const request_id = ++this.detail_request_id;
		const activeRange = this.get_active_detail_range();
		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.get_planning_card_detail",
			args: {
				name,
				activity_types: this.get_selected_activity_types(),
				range_start: activeRange.start,
				range_end: activeRange.end,
			},
			callback: (response) => {
				if (request_id !== this.detail_request_id || this.active_card_name !== name) {
					return;
				}

				this.card_detail = response.message || null;
				this.render_card_detail();
			},
		});
	}

	render_card_detail_loading(card) {
		const projectLabel = card.project_display || card.project;
		this.$drawer_content.html(`
			<div class="aster-studio-drawer__head">
				<div>
					<div class="aster-studio-drawer__eyebrow">${__("Planning Card")}</div>
					<h3>${frappe.utils.escape_html(projectLabel || "")}</h3>
					<p>${frappe.utils.escape_html([card.elementgruppe, card.operation].filter(Boolean).join(" · "))}</p>
				</div>
				<button type="button" class="aster-studio-drawer__close" aria-label="${__("Close")}">×</button>
			</div>
			<div class="aster-studio-drawer__loading">${__("Loading employee availability...")}</div>
		`);
	}

	render_card_detail() {
		if (!this.card_detail?.card || this.card_detail.card.name !== this.active_card_name) {
			return;
		}

		const card = this.card_detail.card;
		const projectLabel = card.project_display || card.project;
		const start = this.to_user_moment(card.start_date);
		const end = this.to_user_moment(card.end_date);
		const rangeStart = this.to_user_moment(this.card_detail.range_start || card.start_date);
		const rangeEnd = this.to_user_moment(this.card_detail.range_end || card.end_date);
		const employees = this.card_detail.employees || [];
		const hasActiveWeek = Boolean(this.active_week?.start && this.active_week?.end);
		const assignedEmployees = (card.assigned_employee_names || []).length
			? card.assigned_employee_names.join(", ")
			: "";
		const elementgruppeLabel = card.elementgruppe || __("Not set");
		const rangeLabel = hasActiveWeek
			? this.format_date_range(rangeStart, rangeEnd)
			: __("Entire planning card period");
		const assignmentHint = hasActiveWeek
			? __("Assignments from this drawer are stored with this week as their From/To period.")
			: __("No week is active. Assignments will cover the full Planning Card period.");

		this.$drawer_content.html(`
			<div class="aster-studio-drawer__head">
				<div>
					<div class="aster-studio-drawer__eyebrow">${__("Planning Card")}</div>
					<h3>${frappe.utils.escape_html(projectLabel || "")}</h3>
					<p>${frappe.utils.escape_html([card.elementgruppe, card.operation].filter(Boolean).join(" · "))}</p>
				</div>
				<button type="button" class="aster-studio-drawer__close" aria-label="${__("Close")}">×</button>
			</div>

			<div class="aster-studio-drawer__summary">
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Period")}</div>
					<div class="aster-studio-drawer__stat-value">${this.format_date_range(start, end)}</div>
				</div>
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Active Assignment Window")}</div>
					<div class="aster-studio-drawer__stat-value">${rangeLabel}</div>
				</div>
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Elementgruppe")}</div>
					<div class="aster-studio-drawer__stat-value">${frappe.utils.escape_html(elementgruppeLabel)}</div>
				</div>
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Required Hours")}</div>
					<div class="aster-studio-drawer__stat-value">${this.format_hours_with_unit(card.required_hours)}</div>
				</div>
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Daily per Employee")}</div>
					<div class="aster-studio-drawer__stat-value">${this.format_hours_with_unit(card.hours_per_employee_per_day || 8)}</div>
				</div>
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Assigned")}</div>
					<div class="aster-studio-drawer__stat-value">${frappe.utils.escape_html(assignedEmployees || " ")}</div>
				</div>
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Planned via Assignments")}</div>
					<div class="aster-studio-drawer__stat-value">${this.format_hours_with_unit(card.allocated_hours)}</div>
				</div>
			</div>

			<div class="aster-studio-drawer__actions">
				<button type="button" class="btn btn-default btn-sm aster-studio-drawer__edit">${__("Edit Planning Card")}</button>
				<button type="button" class="btn btn-default btn-sm aster-studio-drawer__open">${__("Open Form")}</button>
			</div>

			<div class="aster-studio-drawer__section">
				<div class="aster-studio-drawer__section-head">
					<h4>${__("Available Employees")}</h4>
					<p>${assignmentHint}</p>
					<p>${__("Draft and submitted timesheets define capacity. Already assigned project hours are shown as guidance and do not block further assignment.")}</p>
				</div>
				<div class="aster-studio-drawer__employee-list">
					${
						employees.length
							? employees.map((employee) => this.get_drawer_employee_markup(employee)).join("")
							: `<div class="aster-studio__empty">${__("No employee capacity found for this period.")}</div>`
					}
				</div>
			</div>
		`);
	}

	get_drawer_employee_markup(employee) {
		const remainingClass = employee.remaining_hours < 0 ? "is-negative" : "";
		const assignmentWindows = employee.card_assignment_windows || [];
		const assignmentMarkup = assignmentWindows.length
			? assignmentWindows
					.map((row) => {
						const fromDate = row.from_date
							? moment(row.from_date, "YYYY-MM-DD").format("DD.MM")
							: "–";
						const toDate = row.to_date
							? moment(row.to_date, "YYYY-MM-DD").format("DD.MM")
							: "–";
						return `<span class="aster-studio-employee__badge">${frappe.utils.escape_html(
							`${fromDate} - ${toDate} · ${this.format_hours_with_unit(row.window_hours || row.allocated_hours)}`
						)}</span>`;
					})
					.join("")
			: `<span class="aster-studio-employee__badge is-muted">${__("No assignment in this window")}</span>`;
		const assignLabel = employee.is_assigned_to_card
			? __("Remove")
			: this.active_week?.start
				? __("Assign Week")
				: __("Assign");
		return `
			<div class="aster-studio-employee ${employee.is_assigned_to_card ? "is-assigned" : ""}">
				<div class="aster-studio-employee__row">
					<div>
						<div class="aster-studio-employee__name">${frappe.utils.escape_html(employee.employee_name || "")}</div>
						<div class="aster-studio-employee__meta">${frappe.utils.escape_html(employee.department || __("No Department"))}</div>
					</div>
					<button
						type="button"
						class="btn btn-xs ${employee.is_assigned_to_card ? "btn-default" : "btn-primary"} aster-studio-employee__assign"
						data-employee="${frappe.utils.escape_html(employee.employee || "")}"
					>
						${assignLabel}
					</button>
				</div>
				<div class="aster-studio-employee__stats">
					<span>${__("Capacity")}: ${this.format_hours_with_unit(employee.capacity_hours)}</span>
					<span>${__("On this card")}: ${this.format_hours_with_unit(employee.assigned_card_hours)}</span>
					<span>${__("Other project hours")}: ${this.format_hours_with_unit(employee.assigned_other_hours)}</span>
					<span class="${remainingClass}">${__("Remaining")}: ${this.format_hours_with_unit(employee.remaining_hours)}</span>
				</div>
				<div class="aster-studio-employee__badges">${assignmentMarkup}</div>
				<div class="aster-studio-employee__foot">
					<span>${__("{0} other planning cards", [cint(employee.assigned_project_count)])}</span>
					<span>${employee.is_assigned_to_card ? __("Assigned in the current window") : __("Not assigned in the current window")}</span>
				</div>
			</div>
		`;
	}

	toggle_card_assignment(employee) {
		if (!this.card_detail?.card) {
			return;
		}

		const card = this.card_detail.card;
		const range = this.get_assignment_range(card);
		if (!range) {
			frappe.msgprint(__("The active week does not overlap with this Planning Card."));
			return;
		}
		const assignments = [...(card.assigned_employees || [])];
		const existingIndex = assignments.findIndex(
			(row) =>
				row.employee === employee &&
				(row.from_date || "") === range.from_date &&
				(row.to_date || "") === range.to_date
		);
		if (existingIndex >= 0) {
			assignments.splice(existingIndex, 1);
		} else {
			assignments.push({
				employee,
				from_date: range.from_date,
				to_date: range.to_date,
			});
		}

		const nextEmployees = assignments;
		const submit = (adjustEndDateForParallelWork) => {
			frappe.call({
				method:
					"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.update_planning_card",
				args: {
					name: card.name,
					assigned_employees: nextEmployees,
					adjust_end_date_for_parallel_work: adjustEndDateForParallelWork,
				},
				callback: () => {
					frappe.show_alert({ message: __("Assignments updated"), indicator: "green" });
					this.refresh();
					this.load_card_detail(card.name);
				},
			});
		};

		const uniqueEmployees = new Set(nextEmployees.map((row) => row.employee).filter(Boolean));
		if (uniqueEmployees.size > 1) {
			frappe.confirm(
				__("Several employees are assigned. Should the end date be shortened for parallel work?"),
				() => submit(1),
				() => submit(0)
			);
			return;
		}

		submit(0);
	}

	get_active_detail_range() {
		if (this.active_week?.start && this.active_week?.end) {
			return {
				start: `${this.active_week.start} 00:00:00`,
				end: `${this.active_week.end} 23:59:59`,
			};
		}

		return {
			start: null,
			end: null,
		};
	}

	get_assignment_range(card) {
		const cardStart = this.to_user_moment(card.start_date);
		const cardEnd = this.to_user_moment(card.end_date);
		if (!this.active_week?.start || !this.active_week?.end) {
			return {
				from_date: cardStart.format("YYYY-MM-DD"),
				to_date: cardEnd.format("YYYY-MM-DD"),
			};
		}

		const weekStart = moment(this.active_week.start, "YYYY-MM-DD");
		const weekEnd = moment(this.active_week.end, "YYYY-MM-DD");
		const fromDate = moment.max(cardStart.clone().startOf("day"), weekStart);
		const toDate = moment.min(cardEnd.clone().startOf("day"), weekEnd);
		if (fromDate.isAfter(toDate, "day")) {
			return null;
		}

		return {
			from_date: fromDate.format("YYYY-MM-DD"),
			to_date: toDate.format("YYYY-MM-DD"),
		};
	}

	open_create_dialog(default_start) {
		this.open_card_dialog({ default_start });
	}

	open_edit_dialog(card) {
		this.open_card_dialog({ card });
	}

	open_card_dialog({ card = null, default_start = null } = {}) {
		const is_edit = Boolean(card);
		const start = (card ? this.to_user_moment(card.start_date) : default_start || this.get_horizon_window().start.clone().hour(8).minute(0).second(0)).clone();
		const assignedEmployees = (card?.assigned_employees || []).map((row) => row.employee).filter(Boolean);
		const dialog = new frappe.ui.Dialog({
			title: is_edit ? __("Update Planning Card") : __("New Planning Card"),
			fields: [
				{
					fieldname: "project",
					fieldtype: "Link",
					label: __("Project"),
					options: "Project",
					reqd: 1,
					default: card?.project,
				},
				{
					fieldname: "elementgruppe",
					fieldtype: "Data",
					label: __("Elementgruppe"),
					default: card?.elementgruppe,
				},
				{
					fieldname: "operation",
					fieldtype: "Link",
					label: __("Operation"),
					options: "Operation",
					default: card?.operation,
					onchange: () => {
						this.load_operation_defaults(dialog);
					},
				},
				{
					fieldname: "task_type",
					fieldtype: "Link",
					label: __("Task Type"),
					options: "Task Type",
					default: card?.task_type,
					get_query: () => this.get_production_planning_task_type_query(),
					onchange: () => {
						dialog.__task_type_touched = true;
					},
				},
				{
					fieldname: "start_date",
					fieldtype: "Datetime",
					label: __("Start Date"),
					reqd: 1,
					default: start.format(frappe.defaultDatetimeFormat),
				},
				{
					fieldname: "required_hours",
					fieldtype: "Float",
					label: __("Required Hours"),
					description: __("If empty, the operation time is used."),
					default: flt(card?.required_hours || card?.duration_in_hours || 0),
					onchange: () => {
						dialog.__required_hours_touched = true;
					},
				},
				{
					fieldname: "hours_per_employee_per_day",
					fieldtype: "Float",
					label: __("Calculated Hours per Employee per Day"),
					reqd: 1,
					default: flt(card?.hours_per_employee_per_day || 8),
				},
				{
					fieldname: "assigned_employees",
					fieldtype: "MultiSelectList",
					label: __("Assigned Employees"),
					default: assignedEmployees,
					get_data(txt) {
						return frappe.db.get_link_options("Employee", txt);
					},
				},
				{
					fieldname: "note",
					fieldtype: "Small Text",
					label: __("Note"),
					default: card?.note,
				},
			],
			primary_action_label: is_edit ? __("Save") : __("Create"),
			primary_action: () => {
				const values = dialog.get_values();
				if (!values) {
					return;
				}

				const normalizedEmployees = this.normalize_employee_values(values.assigned_employees);
				const requiredHours = flt(values.required_hours || 0);
				if (requiredHours <= 0) {
					frappe.msgprint(__("Required Hours must be greater than zero."));
					return;
				}

				if (flt(values.hours_per_employee_per_day) <= 0) {
					frappe.msgprint(__("Calculated Hours per Employee per Day must be greater than zero."));
					return;
				}

				const submit = (adjustEndDateForParallelWork) => {
					frappe.call({
						method: is_edit
							? "aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.update_planning_card"
							: "aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.create_planning_card",
						args: {
							name: card?.name,
							project: values.project,
							elementgruppe: values.elementgruppe,
							operation: values.operation,
							task_type: values.task_type,
							start_date: this.to_system_datetime(moment(values.start_date, frappe.defaultDatetimeFormat)),
							required_hours: requiredHours,
							hours_per_employee_per_day: values.hours_per_employee_per_day,
							assigned_employees: normalizedEmployees,
							adjust_end_date_for_parallel_work: adjustEndDateForParallelWork,
							note: values.note,
						},
						callback: () => {
							dialog.hide();
							frappe.show_alert({
								message: is_edit ? __("Planning Card updated") : __("Planning Card created"),
								indicator: "green",
							});
							this.refresh();
						},
					});
				};

				if (normalizedEmployees.length > 1) {
					frappe.confirm(
						__("Several employees are assigned. Should the end date be shortened for parallel work?"),
						() => submit(1),
						() => submit(0)
					);
					return;
				}

				submit(0);
			},
		});

		dialog.__required_hours_touched = is_edit;
		dialog.__task_type_touched = is_edit;
		dialog.show();

		if (!is_edit && !flt(dialog.get_value("required_hours")) && dialog.get_value("operation")) {
			this.load_operation_defaults(dialog);
		}
	}

	load_operation_defaults(dialog) {
		const operation = dialog.get_value("operation");
		if (!operation) {
			return;
		}

		frappe.db.get_value("Operation", operation, ["total_operation_time", "custom_task_type"], (response) => {
			const message = response?.message || response || {};
			if (!dialog.__task_type_touched) {
				this.apply_production_planning_task_type(dialog, message.custom_task_type || "");
			}
			if (dialog.__required_hours_touched && flt(dialog.get_value("required_hours"))) {
				return;
			}
			const totalOperationMinutes = flt(message.total_operation_time || 0);
			if (totalOperationMinutes <= 0) {
				return;
			}

			dialog.set_value("required_hours", flt(totalOperationMinutes / 60, 2));
			dialog.__required_hours_touched = false;
		});
	}

	get_production_planning_task_type_query() {
		return {
			filters: {
				custom_use_for_production_planning: 1,
			},
		};
	}

	apply_production_planning_task_type(target, task_type) {
		if (!target?.set_value) {
			return;
		}

		if (!task_type) {
			target.set_value("task_type", "");
			return;
		}

		frappe.db
			.get_value("Task Type", task_type, "custom_use_for_production_planning")
			.then((response) => {
				const message = response?.message || response || {};
				target.set_value("task_type", cint(message.custom_use_for_production_planning || message || 0) ? task_type : "");
			})
			.catch(() => {
				target.set_value("task_type", "");
			});
	}

	normalize_employee_values(value) {
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

	update_card_schedule(card, start_moment, end_moment = null) {
		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.update_planning_card_schedule",
			args: {
				name: card.name,
				start_date: this.to_system_datetime(start_moment),
				end_date: end_moment ? this.to_system_datetime(end_moment) : null,
			},
			callback: () => {
				frappe.show_alert({ message: __("Planning Card updated"), indicator: "green" });
				this.refresh();
			},
		});
	}

	start_card_resize_interaction(event, mode) {
		event.preventDefault();
		event.stopPropagation();

		const $card = $(event.currentTarget).closest(".aster-studio-card");
		const card = this.get_card($card.data("name"));
		if (!card) {
			return;
		}

		const visibleStart = moment($card.data("visibleStart"), "YYYY-MM-DD");
		const visibleEnd = moment($card.data("visibleEnd"), "YYYY-MM-DD");
		const originalStart = this.to_user_moment(card.start_date);
		const originalEnd = this.to_user_moment(card.end_date);

		this.card_resize_interaction = {
			mode,
			card,
			$card,
			start_x: event.clientX,
			visible_start: visibleStart,
			visible_end: visibleEnd,
			original_start: originalStart,
			original_end: originalEnd,
			preview_start: originalStart.clone(),
			preview_end: originalEnd.clone(),
		};

		$card.addClass("is-resizing");
	}

	handle_card_resize_interaction_move(event) {
		const interaction = this.card_resize_interaction;
		if (!interaction) {
			return;
		}

		const deltaDays = Math.round((event.clientX - interaction.start_x) / this.day_width);
		const resizeDirection = deltaDays === 0 ? 0 : deltaDays > 0 ? 1 : -1;
		let nextStart = interaction.original_start.clone();
		let nextEnd = interaction.original_end.clone();

		if (interaction.mode === "resize-start") {
			nextStart.add(deltaDays, "days");
			nextStart = this.snap_resize_date_to_planning_day(nextStart, resizeDirection);
			if (nextStart.isAfter(nextEnd, "day")) {
				nextStart = nextEnd.clone();
			}
			if (nextStart.isAfter(interaction.visible_end, "day")) {
				nextStart = interaction.visible_end.clone().hour(nextStart.hour()).minute(nextStart.minute()).second(0);
			}
		}

		if (interaction.mode === "resize-end") {
			nextEnd.add(deltaDays, "days");
			nextEnd = this.snap_resize_date_to_planning_day(nextEnd, resizeDirection);
			if (nextEnd.isBefore(nextStart, "day")) {
				nextEnd = nextStart.clone();
			}
			if (nextEnd.isBefore(interaction.visible_start, "day")) {
				nextEnd = interaction.visible_start.clone().hour(nextEnd.hour()).minute(nextEnd.minute()).second(0);
			}
		}

		interaction.preview_start = nextStart;
		interaction.preview_end = nextEnd;
		this.apply_card_resize_preview(interaction);
	}

	apply_card_resize_preview(interaction) {
		const horizonWindow = this.get_horizon_window();
		const horizonStart = horizonWindow.start.clone().startOf("day");
		const horizonEnd = horizonWindow.end.clone().subtract(1, "day").startOf("day");
		const overlapStart = moment.max(
			interaction.preview_start.clone().startOf("day"),
			horizonStart
		);
		const overlapEnd = moment.min(
			interaction.preview_end.clone().startOf("day"),
			horizonEnd
		);

		if (overlapStart.isAfter(overlapEnd, "day")) {
			return;
		}

		const previewStartColumn = Math.max(overlapStart.diff(horizonStart, "days"), 0) + 1;
		const previewEndColumn = Math.max(overlapEnd.diff(horizonStart, "days"), 0) + 2;

		interaction.$card.css("--card-preview-column-start", previewStartColumn);
		interaction.$card.css("--card-preview-column-end", previewEndColumn);
	}

	should_exclude_planning_weekends() {
		return Boolean(cint(this.state.exclude_weekends_from_planning_duration || 0));
	}

	snap_resize_date_to_planning_day(date, direction = 0) {
		const snapped = date.clone();
		if (!this.should_exclude_planning_weekends() || !direction) {
			return snapped;
		}

		while (snapped.isoWeekday() >= 6) {
			snapped.add(direction > 0 ? 1 : -1, "day");
		}

		return snapped;
	}

	finish_card_resize_interaction() {
		const interaction = this.card_resize_interaction;
		if (!interaction) {
			return;
		}

		const changed =
			!interaction.preview_start.isSame(interaction.original_start, "day") ||
			!interaction.preview_end.isSame(interaction.original_end, "day");

		interaction.$card.removeClass("is-resizing");
		interaction.$card.css("--card-preview-column-start", "");
		interaction.$card.css("--card-preview-column-end", "");
		this.card_resize_interaction = null;

		if (!changed) {
			return;
		}

		this.update_card_schedule(interaction.card, interaction.preview_start, interaction.preview_end);
	}

	get_card(name) {
		return (this.state.planning_cards || []).find((card) => card.name === name);
	}

	get_selected_activity_types() {
		const value = this.activity_type_filter.get_value();
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

	get_focus_window() {
		const start = this.focus_date.clone().startOf(this.horizon_mode);
		const end = start.clone().add(1, this.horizon_mode);
		return { start, end };
	}

	get_horizon_window() {
		const focusWindow = this.get_focus_window();
		const start = focusWindow.start.clone().startOf("isoWeek");
		const end = focusWindow.end.clone().subtract(1, "day").endOf("isoWeek").add(1, "day").startOf("day");
		return { start, end };
	}

	get_overlap_hours(window_start, window_end, item_start, item_end, fallback_hours) {
		if (!item_start || !item_end || !item_end.isAfter(item_start)) {
			return 0;
		}

		const overlap_start = moment.max(window_start, item_start);
		const overlap_end = moment.min(window_end, item_end);
		if (!overlap_end.isAfter(overlap_start)) {
			return 0;
		}

		const total_minutes = item_end.diff(item_start, "minutes");
		if (!total_minutes) {
			return flt(fallback_hours || 0);
		}

		const overlap_minutes = overlap_end.diff(overlap_start, "minutes");
		return flt((flt(fallback_hours || 0) * overlap_minutes) / total_minutes, 2);
	}

	to_system_datetime(value) {
		return frappe.datetime.convert_to_system_tz(moment(value).format(frappe.defaultDatetimeFormat));
	}

	to_user_moment(value) {
		return moment(frappe.datetime.convert_to_user_tz(value), frappe.defaultDatetimeFormat);
	}

	format_hours(value) {
		return format_number(flt(value || 0), null, 1);
	}

	format_hours_with_unit(value) {
		return __("{0} h", [this.format_hours(value)]);
	}

	format_percent(value) {
		return `${format_number(flt(value || 0), null, 1)}%`;
	}

	format_absence_datetime_parts(value) {
		if (!value) {
			return { day: "–", time: "" };
		}

		const rawValue = String(value).trim();
		if (!rawValue) {
			return { day: "–", time: "" };
		}

		let parsed = null;
		if (rawValue.length <= 10) {
			parsed = moment(rawValue, "YYYY-MM-DD", true);
		} else {
			parsed = this.to_user_moment(rawValue);
			if (!parsed.isValid()) {
				parsed = moment(rawValue, frappe.defaultDatetimeFormat, true);
			}
		}

		if (!parsed?.isValid()) {
			return { day: rawValue, time: "" };
		}

		const formattedTime = parsed.format("HH:mm:ss");
		return {
			day: parsed.format("DD.MM.YYYY"),
			time: formattedTime === "00:00:00" ? "" : parsed.format("HH:mm"),
		};
	}

	get_absence_schedule_markup(item) {
		const start = this.format_absence_datetime_parts(item.from_date);
		const end = this.format_absence_datetime_parts(item.to_date);
		const startLabel = [start.day, start.time].filter(Boolean).join(" ");
		const endLabel = [end.day, end.time].filter(Boolean).join(" ");

		return `
			<div class="aster-studio__absence-period">
				<span class="aster-studio__absence-label">${__("From")}</span>
				<span class="aster-studio__absence-day">${frappe.utils.escape_html(startLabel)}</span>
				<span class="aster-studio__absence-label">${__("To")}</span>
				<span class="aster-studio__absence-day">${frappe.utils.escape_html(endLabel)}</span>
			</div>
		`;
	}

	format_absence_duration(item) {
		const hours = flt(item.overlap_days || 0) * 8;
		if (hours > 8) {
			return __("{0} days", [flt(item.overlap_days)]);
		}

		return this.format_hours_with_unit(hours);
	}

	format_date_range(start, end) {
		return `${start.format("DD.MM.YYYY")} - ${end.format("DD.MM.YYYY")}`;
	}

	is_day_in_active_week(day) {
		if (!this.active_week?.start || !this.active_week?.end) {
			return false;
		}
		const weekStart = moment(this.active_week.start, "YYYY-MM-DD");
		const weekEnd = moment(this.active_week.end, "YYYY-MM-DD");
		return day.isSameOrAfter(weekStart, "day") && day.isSameOrBefore(weekEnd, "day");
	}

	center_active_week_in_horizon() {
		if (!this.active_week?.start || !this.active_week?.end) {
			return;
		}

		window.requestAnimationFrame(() => {
			const $container = this.$horizon.find(".aster-studio-horizon");
			const $activeDays = this.$horizon.find(".aster-studio-horizon__day-header.is-active-week");
			if (!$container.length || !$activeDays.length) {
				return;
			}

			const firstDay = $activeDays.get(0);
			const lastDay = $activeDays.get($activeDays.length - 1);
			if (!firstDay || !lastDay) {
				return;
			}

			const container = $container.get(0);
			const firstLeft = firstDay.offsetLeft;
			const lastRight = lastDay.offsetLeft + lastDay.offsetWidth;
			const activeWidth = lastRight - firstLeft;
			const targetScrollLeft = Math.max(firstLeft - (container.clientWidth - activeWidth) / 2, 0);

			$container.stop().animate({ scrollLeft: targetScrollLeft }, 180);
		});
	}

	get_card_assignment_segments_markup(card, segment) {
		const assignments = card.assigned_employees || [];
		if (!assignments.length) {
			return "";
		}

		const renderedAssignments = assignments
			.map((assignment) => {
				const position = this.get_assignment_segment_position(card, assignment, segment);
				if (!position) {
					return "";
				}
				const employeeLabel = assignment.employee_name || assignment.employee || __("Employee");
				const hoursLabel = flt(assignment.allocated_hours) > 0 ? this.format_hours_with_unit(assignment.allocated_hours) : "";
				return `
					<div
						class="aster-studio-card__assignment-segment"
						data-employee="${frappe.utils.escape_html(assignment.employee || "")}"
						data-from="${frappe.utils.escape_html(position.from_date)}"
						data-to="${frappe.utils.escape_html(position.to_date)}"
						data-row="${position.row_index}"
						style="--assignment-left:${position.left_percent}%; --assignment-width:${position.width_percent}%; --assignment-row:${position.row_index + 1};"
						title="${frappe.utils.escape_html(`${employeeLabel} · ${position.range_label}${hoursLabel ? ` · ${hoursLabel}` : ""}`)}"
					>
						<span class="aster-studio-card__assignment-handle aster-studio-card__assignment-handle--start"></span>
						<span class="aster-studio-card__assignment-label">${frappe.utils.escape_html(employeeLabel)}</span>
						<span class="aster-studio-card__assignment-range">${frappe.utils.escape_html(position.range_label)}</span>
						<span class="aster-studio-card__assignment-handle aster-studio-card__assignment-handle--end"></span>
					</div>
				`;
			})
			.filter(Boolean)
			.join("");

		if (!renderedAssignments) {
			return "";
		}

		return `<div class="aster-studio-card__segments">${renderedAssignments}</div>`;
	}

	get_assignment_segment_position(card, assignment, segment) {
		const cardStart = this.to_user_moment(card.start_date).startOf("day");
		const cardEnd = this.to_user_moment(card.end_date).startOf("day");
		const fromMoment = moment(assignment.from_date || cardStart.format("YYYY-MM-DD"), "YYYY-MM-DD");
		const toMoment = moment(assignment.to_date || cardEnd.format("YYYY-MM-DD"), "YYYY-MM-DD");
		const visibleStart = segment.visible_start.clone().startOf("day");
		const visibleEnd = segment.visible_end.clone().startOf("day");
		const overlapStart = moment.max(fromMoment.clone(), visibleStart);
		const overlapEnd = moment.min(toMoment.clone(), visibleEnd);

		if (overlapStart.isAfter(overlapEnd, "day")) {
			return null;
		}

		const totalDays = Math.max(visibleEnd.diff(visibleStart, "days") + 1, 1);
		const leftDays = Math.max(overlapStart.diff(visibleStart, "days"), 0);
		const widthDays = Math.max(overlapEnd.diff(overlapStart, "days") + 1, 1);
		const cardStartKey = cardStart.format("YYYY-MM-DD");
		const cardEndKey = cardEnd.format("YYYY-MM-DD");

		return {
			from_date: fromMoment.format("YYYY-MM-DD"),
			to_date: toMoment.format("YYYY-MM-DD"),
			left_percent: (leftDays / totalDays) * 100,
			width_percent: (widthDays / totalDays) * 100,
			row_index: Math.max(
				(card.assigned_employees || []).findIndex(
					(row) =>
						(row.employee || "") === (assignment.employee || "") &&
						(row.from_date || cardStartKey) === (assignment.from_date || cardStartKey) &&
						(row.to_date || cardEndKey) === (assignment.to_date || cardEndKey)
				),
				0
			),
			range_label:
				fromMoment.isSame(toMoment, "day")
					? fromMoment.format("DD.MM")
					: `${fromMoment.format("DD.MM")}-${toMoment.format("DD.MM")}`,
		};
	}

	get_card_week_highlight_markup(segment) {
		if (!this.active_week?.start || !this.active_week?.end) {
			return "";
		}

		const visibleStart = segment.visible_start.clone().startOf("day");
		const visibleEnd = segment.visible_end.clone().startOf("day");
		const weekStart = moment(this.active_week.start, "YYYY-MM-DD");
		const weekEnd = moment(this.active_week.end, "YYYY-MM-DD");
		const overlapStart = moment.max(weekStart, visibleStart);
		const overlapEnd = moment.min(weekEnd, visibleEnd);
		if (overlapStart.isAfter(overlapEnd, "day")) {
			return "";
		}

		const totalDays = Math.max(visibleEnd.diff(visibleStart, "days") + 1, 1);
		const leftPercent = (Math.max(overlapStart.diff(visibleStart, "days"), 0) / totalDays) * 100;
		const widthPercent = ((overlapEnd.diff(overlapStart, "days") + 1) / totalDays) * 100;
		return `<div class="aster-studio-card__week-highlight" style="--week-left:${leftPercent}%; --week-width:${widthPercent}%;"></div>`;
	}

	get_contrast_text_color(color) {
		const normalized = (color || "").replace("#", "");
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
			return "#ffffff";
		}

		const red = parseInt(normalized.slice(0, 2), 16);
		const green = parseInt(normalized.slice(2, 4), 16);
		const blue = parseInt(normalized.slice(4, 6), 16);
		const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
		return luminance > 160 ? "#20303b" : "#ffffff";
	}

	start_assignment_interaction(event, mode) {
		event.preventDefault();
		event.stopPropagation();

		const $segment = $(event.currentTarget).closest(".aster-studio-card__assignment-segment");
		const $card = $segment.closest(".aster-studio-card");
		const card = this.get_card($card.data("name"));
		if (!card) {
			return;
		}

		this.assignment_interaction = {
			mode,
			card,
			$card,
			$segment,
			start_x: event.clientX,
			employee: $segment.data("employee"),
			original_from: moment($segment.data("from"), "YYYY-MM-DD"),
			original_to: moment($segment.data("to"), "YYYY-MM-DD"),
			preview_from: moment($segment.data("from"), "YYYY-MM-DD"),
			preview_to: moment($segment.data("to"), "YYYY-MM-DD"),
		};

		$segment.addClass("is-preview");
	}

	handle_assignment_interaction_move(event) {
		const interaction = this.assignment_interaction;
		if (!interaction) {
			return;
		}

		const deltaDays = Math.round((event.clientX - interaction.start_x) / this.day_width);
		const cardStart = this.to_user_moment(interaction.card.start_date).startOf("day");
		const cardEnd = this.to_user_moment(interaction.card.end_date).startOf("day");
		let nextFrom = interaction.original_from.clone();
		let nextTo = interaction.original_to.clone();

		if (interaction.mode === "move") {
			nextFrom.add(deltaDays, "days");
			nextTo.add(deltaDays, "days");

			if (nextFrom.isBefore(cardStart, "day")) {
				const shiftDays = cardStart.diff(nextFrom, "days");
				nextFrom.add(shiftDays, "days");
				nextTo.add(shiftDays, "days");
			}

			if (nextTo.isAfter(cardEnd, "day")) {
				const shiftDays = nextTo.diff(cardEnd, "days");
				nextFrom.subtract(shiftDays, "days");
				nextTo.subtract(shiftDays, "days");
			}
		}

		if (interaction.mode === "resize-start") {
			nextFrom.add(deltaDays, "days");
			if (nextFrom.isBefore(cardStart, "day")) {
				nextFrom = cardStart.clone();
			}
			if (nextFrom.isAfter(nextTo, "day")) {
				nextFrom = nextTo.clone();
			}
		}

		if (interaction.mode === "resize-end") {
			nextTo.add(deltaDays, "days");
			if (nextTo.isAfter(cardEnd, "day")) {
				nextTo = cardEnd.clone();
			}
			if (nextTo.isBefore(nextFrom, "day")) {
				nextTo = nextFrom.clone();
			}
		}

		interaction.preview_from = nextFrom;
		interaction.preview_to = nextTo;
		this.apply_assignment_preview(interaction);
	}

	apply_assignment_preview(interaction) {
		const visibleStart = moment(interaction.$card.data("visibleStart"), "YYYY-MM-DD");
		const visibleEnd = moment(interaction.$card.data("visibleEnd"), "YYYY-MM-DD");
		const overlapStart = moment.max(interaction.preview_from.clone(), visibleStart);
		const overlapEnd = moment.min(interaction.preview_to.clone(), visibleEnd);

		if (overlapStart.isAfter(overlapEnd, "day")) {
			interaction.$segment.addClass("is-outside");
			return;
		}

		interaction.$segment.removeClass("is-outside");
		const totalDays = Math.max(visibleEnd.diff(visibleStart, "days") + 1, 1);
		const leftPercent = (Math.max(overlapStart.diff(visibleStart, "days"), 0) / totalDays) * 100;
		const widthPercent = ((overlapEnd.diff(overlapStart, "days") + 1) / totalDays) * 100;
		interaction.$segment.css("--assignment-preview-left", `${leftPercent}%`);
		interaction.$segment.css("--assignment-preview-width", `${widthPercent}%`);
		interaction.$segment.find(".aster-studio-card__assignment-range").text(
			interaction.preview_from.isSame(interaction.preview_to, "day")
				? interaction.preview_from.format("DD.MM")
				: `${interaction.preview_from.format("DD.MM")}-${interaction.preview_to.format("DD.MM")}`
		);
	}

	finish_assignment_interaction() {
		const interaction = this.assignment_interaction;
		if (!interaction) {
			return;
		}

		const changed =
			!interaction.preview_from.isSame(interaction.original_from, "day") ||
			!interaction.preview_to.isSame(interaction.original_to, "day");

		interaction.$segment.removeClass("is-preview is-outside");
		interaction.$segment.css("--assignment-preview-left", "");
		interaction.$segment.css("--assignment-preview-width", "");
		this.assignment_interaction = null;

		if (!changed) {
			return;
		}

		this.update_assignment_window(
			interaction.card,
			interaction.employee,
			interaction.original_from.format("YYYY-MM-DD"),
			interaction.original_to.format("YYYY-MM-DD"),
			interaction.preview_from.format("YYYY-MM-DD"),
			interaction.preview_to.format("YYYY-MM-DD")
		);
	}

	update_assignment_window(card, employee, originalFrom, originalTo, nextFrom, nextTo) {
		const cardStartKey = this.to_user_moment(card.start_date).format("YYYY-MM-DD");
		const cardEndKey = this.to_user_moment(card.end_date).format("YYYY-MM-DD");
		const assignments = [...(card.assigned_employees || [])];
		const rowIndex = assignments.findIndex(
			(row) =>
				(row.employee || "") === (employee || "") &&
				(row.from_date || cardStartKey) === originalFrom &&
				(row.to_date || cardEndKey) === originalTo
		);
		if (rowIndex < 0) {
			return;
		}

		assignments[rowIndex] = {
			...assignments[rowIndex],
			from_date: nextFrom,
			to_date: nextTo,
		};

		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.update_planning_card",
			args: {
				name: card.name,
				assigned_employees: assignments,
			},
			callback: () => {
				frappe.show_alert({ message: __("Assignment updated"), indicator: "green" });
				this.refresh();
				if (this.active_card_name === card.name) {
					this.load_card_detail(card.name);
				}
			},
		});
	}

	set_loading(is_loading) {
		this.$layout.toggleClass("is-loading", is_loading);
	}

	ensure_styles() {
		if (document.getElementById("aster-planning-studio-style")) {
			return;
		}

		$(`<style id="aster-planning-studio-style">
			.aster-studio {
				--studio-ink: #24313c;
				--studio-soft: #758896;
				--studio-line: rgba(36, 49, 60, 0.12);
				--studio-panel: #ffffff;
				--studio-shadow: 0 18px 40px rgba(33, 48, 61, 0.08);
				--studio-accent: #9d12ff;
				--studio-accent-strong: #7a00d6;
				--studio-accent-soft: rgba(157, 18, 255, 0.10);
				--studio-accent-wash: rgba(157, 18, 255, 0.18);
				--studio-warm: #d94cff;
				box-sizing: border-box;
				color: var(--studio-ink);
				margin: 0 auto;
				max-width: 1800px;
				padding: 10px clamp(16px, 3vw, 40px) 24px;
			}

			.aster-studio__hero,
			.aster-studio__metrics,
			.aster-studio__stack,
			.aster-studio-overview,
			.aster-studio__support {
				display: grid;
				gap: 16px;
			}

			.aster-studio__hero {
				align-items: end;
				grid-template-columns: minmax(0, 1fr) auto;
				margin-bottom: 8px;
			}

			.aster-studio__hero-copy h2 {
				font-size: clamp(38px, 4.2vw, 56px);
				font-weight: 800;
				letter-spacing: -0.03em;
				line-height: 0.98;
				margin: 0;
				max-width: 880px;
			}

			.aster-studio__hero-actions,
			.aster-studio__mode-switch,
			.aster-studio__nav,
			.aster-studio__panel-actions,
			.aster-studio-card__actions,
			.aster-studio-week-pill__meta,
			.aster-studio-week-pill__tags {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}

			.aster-studio__hero-actions {
				align-items: center;
				justify-content: flex-end;
			}

			.aster-studio__mode-switch .btn.is-active {
				background: var(--studio-accent);
				border-color: var(--studio-accent);
				color: #fff;
			}

			.aster-studio__range,
			.aster-studio__overview-range,
			.aster-studio__horizon-note {
				color: var(--studio-soft);
				font-size: 15px;
				font-weight: 600;
			}

			.aster-studio__metrics {
				grid-template-columns: repeat(3, minmax(0, 1fr));
				margin-bottom: 10px;
			}

			.aster-studio__task-type-summary {
				margin-bottom: 12px;
			}

			.aster-studio__task-type-card {
				background: var(--studio-panel);
				border: 1px solid var(--studio-line);
				border-radius: 24px;
				box-shadow: var(--studio-shadow);
				padding: 18px 20px;
			}

			.aster-studio__task-type-head h3 {
				font-size: 16px;
				font-weight: 700;
				margin: 0;
			}

			.aster-studio__task-type-head p {
				color: var(--studio-soft);
				font-size: 13px;
				margin: 4px 0 0;
			}

			.aster-studio__task-type-table {
				display: grid;
				margin-top: 14px;
			}

			.aster-studio__task-type-row {
				align-items: center;
				border-top: 1px solid var(--studio-line);
				display: grid;
				gap: 12px;
				grid-template-columns: minmax(0, 2fr) minmax(120px, 1fr) minmax(120px, 1fr);
				padding: 10px 0;
			}

			.aster-studio__task-type-row.is-head {
				border-top: 0;
				color: var(--studio-soft);
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				padding-top: 0;
				text-transform: uppercase;
			}

			.aster-studio__task-type-label {
				align-items: center;
				display: flex;
				gap: 10px;
				font-weight: 600;
				min-width: 0;
			}

			.aster-studio__task-type-swatch {
				border-radius: 999px;
				display: inline-block;
				flex: 0 0 10px;
				height: 10px;
				width: 10px;
			}

			.aster-studio__metric,
			.aster-studio__panel,
			.aster-studio-week-pill {
				background: var(--studio-panel);
				border: 1px solid var(--studio-line);
				border-radius: 24px;
				box-shadow: var(--studio-shadow);
			}

			.aster-studio__metric {
				min-height: 132px;
				overflow: hidden;
				padding: 18px 20px;
				position: relative;
			}

			.aster-studio__metric::after {
				background: rgba(157, 18, 255, 0.06);
				content: "";
				inset: 0;
				position: absolute;
			}

			.aster-studio__metric.is-good::after {
				background: rgba(47, 111, 97, 0.08);
			}

			.aster-studio__metric.is-danger::after {
				background: rgba(185, 75, 75, 0.1);
			}

			.aster-studio__metric-label,
			.aster-studio__metric-meta,
			.aster-studio__list-meta,
			.aster-studio__panel-head p,
			.aster-studio__day__empty,
			.aster-studio__empty,
			.aster-studio-card__subtitle,
			.aster-studio-card__meta,
			.aster-studio-card__assignees,
			.aster-studio-week-pill__date,
			.aster-studio-week-pill__meta,
			.aster-studio-horizon-cell__date {
				color: var(--studio-soft);
			}

			.aster-studio__metric-label {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.06em;
				position: relative;
				text-transform: uppercase;
				z-index: 1;
			}

			.aster-studio__metric-value {
				font-size: 34px;
				font-weight: 700;
				line-height: 1.08;
				margin: 10px 0 4px;
				position: relative;
				z-index: 1;
			}

			.aster-studio__metric.is-danger .aster-studio__metric-value {
				color: #b94b4b;
			}

			.aster-studio__metric-meta {
				font-size: 13px;
				position: relative;
				z-index: 1;
			}

			.aster-studio__panel {
				padding: 18px;
			}

			.aster-studio__horizon-panel {
				padding-left: 0;
				padding-right: 0;
				overflow: hidden;
			}

			.aster-studio__horizon-panel .aster-studio__panel-head {
				padding: 0 18px;
			}

			.aster-studio__support {
				grid-template-columns: repeat(2, minmax(0, 1fr));
			}

			.aster-studio-drawer {
				inset: 0;
				pointer-events: none;
				position: fixed;
				z-index: 40;
			}

			.aster-studio-drawer.is-open {
				pointer-events: auto;
			}

			.aster-studio-drawer__backdrop {
				background: rgba(24, 34, 41, 0.16);
				inset: 0;
				opacity: 0;
				position: absolute;
				transition: opacity 0.18s ease;
			}

			.aster-studio-drawer.is-open .aster-studio-drawer__backdrop {
				opacity: 1;
			}

			.aster-studio-drawer__panel {
				background: #ffffff;
				box-shadow: -24px 0 48px rgba(24, 34, 41, 0.14);
				height: 100%;
				margin-left: auto;
				max-width: 520px;
				overflow-y: auto;
				position: relative;
				transform: translateX(100%);
				transition: transform 0.2s ease;
				width: min(92vw, 520px);
			}

			.aster-studio-drawer.is-open .aster-studio-drawer__panel {
				transform: translateX(0);
			}

			.aster-studio-drawer__content {
				display: grid;
				gap: 18px;
				padding: 24px 22px 28px;
			}

			.aster-studio-drawer__head,
			.aster-studio-drawer__actions,
			.aster-studio-employee__row,
			.aster-studio-employee__stats,
			.aster-studio-employee__foot {
				display: flex;
				gap: 10px;
				justify-content: space-between;
			}

			.aster-studio-drawer__head {
				align-items: start;
			}

			.aster-studio-drawer__eyebrow,
			.aster-studio-drawer__stat-label {
				color: var(--studio-soft);
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.06em;
				text-transform: uppercase;
			}

			.aster-studio-drawer__head h3 {
				font-size: 28px;
				line-height: 1.08;
				margin: 6px 0 4px;
			}

			.aster-studio-drawer__head p,
			.aster-studio-drawer__section-head p,
			.aster-studio-employee__meta,
			.aster-studio-employee__foot {
				color: var(--studio-soft);
				font-size: 13px;
			}

			.aster-studio-drawer__close {
				background: rgba(36, 49, 60, 0.06);
				border: 0;
				border-radius: 999px;
				cursor: pointer;
				font-size: 24px;
				height: 38px;
				line-height: 1;
				width: 38px;
			}

			.aster-studio-drawer__summary {
				display: grid;
				gap: 12px;
				grid-template-columns: repeat(2, minmax(0, 1fr));
			}

			.aster-studio-drawer__stat {
				background: rgba(36, 49, 60, 0.04);
				border: 1px solid rgba(36, 49, 60, 0.08);
				border-radius: 16px;
				padding: 12px;
			}

			.aster-studio-drawer__stat-value {
				font-size: 14px;
				font-weight: 700;
				line-height: 1.35;
				margin-top: 6px;
			}

			.aster-studio-drawer__section {
				display: grid;
				gap: 12px;
			}

			.aster-studio-drawer__section-head h4 {
				font-size: 18px;
				margin: 0 0 4px;
			}

			.aster-studio-drawer__employee-list {
				display: grid;
				gap: 10px;
			}

			.aster-studio-employee {
				background: #fff;
				border: 1px solid rgba(36, 49, 60, 0.08);
				border-radius: 16px;
				box-shadow: 0 8px 18px rgba(28, 41, 49, 0.05);
				padding: 12px;
			}

			.aster-studio-employee.is-assigned {
				border-color: rgba(157, 18, 255, 0.32);
				box-shadow: inset 0 0 0 1px rgba(157, 18, 255, 0.10);
			}

			.aster-studio-employee__name {
				font-size: 15px;
				font-weight: 700;
			}

			.aster-studio-employee__stats {
				flex-wrap: wrap;
				font-size: 12px;
				margin-top: 8px;
			}

			.aster-studio-employee__badges {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
				margin-top: 8px;
			}

			.aster-studio-employee__badge {
				background: rgba(157, 18, 255, 0.10);
				border-radius: 999px;
				color: var(--studio-accent);
				font-size: 11px;
				font-weight: 700;
				padding: 4px 8px;
			}

			.aster-studio-employee__badge.is-muted {
				background: rgba(36, 49, 60, 0.06);
				color: var(--studio-soft);
			}

			.aster-studio-employee__foot {
				font-size: 12px;
				margin-top: 8px;
			}

			.aster-studio-employee__stats .is-negative {
				color: #b54747;
				font-weight: 700;
			}

			.aster-studio-drawer__loading {
				color: var(--studio-soft);
				font-size: 14px;
				padding: 8px 0 2px;
			}

			.aster-studio__panel-head {
				align-items: start;
				display: flex;
				gap: 12px;
				justify-content: space-between;
				margin-bottom: 12px;
			}

			.aster-studio__panel-head h3 {
				font-size: 20px;
				margin: 0 0 2px;
			}

			.aster-studio__panel-head p {
				font-size: 14px;
				margin: 0;
			}

			.aster-studio-overview {
				grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			}

			.aster-studio-week-pill {
				cursor: pointer;
				padding: 14px;
				transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
			}

			.aster-studio-week-pill:hover {
				transform: translateY(-1px);
			}

			.aster-studio-week-pill.is-active {
				background: rgba(157, 18, 255, 0.10);
				border-color: rgba(157, 18, 255, 0.52);
				box-shadow: 0 20px 38px rgba(157, 18, 255, 0.18), inset 0 0 0 1px rgba(157, 18, 255, 0.08);
				transform: translateY(-1px);
			}

			.aster-studio-week-pill__head,
			.aster-studio-card__header,
			.aster-studio__list-row,
			.aster-studio-horizon-cell__head {
				align-items: start;
				display: flex;
				gap: 8px;
				justify-content: space-between;
			}

			.aster-studio-week-pill__label,
			.aster-studio-card__title,
			.aster-studio__list-title,
			.aster-studio-horizon-cell__day {
				font-size: 14px;
				font-weight: 700;
				line-height: 1.25;
			}

			.aster-studio-week-pill__value,
			.aster-studio-card__hours,
			.aster-studio__list-value {
				font-size: 13px;
				font-weight: 700;
				white-space: nowrap;
			}

			.aster-studio-week-pill__meta {
				font-size: 12px;
				margin-top: 10px;
			}

			.aster-studio-week-pill__meta .is-negative {
				color: #b94b4b;
			}

			.aster-studio-week-pill__capacity {
				margin-top: 10px;
			}

			.aster-studio-week-pill__capacity-bar {
				background: rgba(36, 49, 60, 0.08);
				border-radius: 999px;
				display: flex;
				height: 10px;
				overflow: hidden;
				position: relative;
			}

			.aster-studio-week-pill__capacity-bar .is-planned {
				background: rgba(157, 18, 255, 0.85);
				display: block;
				height: 100%;
			}

			.aster-studio-week-pill__capacity-bar .is-open {
				background: rgba(47, 111, 97, 0.68);
				display: block;
				height: 100%;
			}

			.aster-studio-week-pill__capacity-bar.is-overloaded {
				box-shadow: inset 0 0 0 1px rgba(185, 75, 75, 0.25);
			}

			.aster-studio-week-pill__capacity-bar.is-overloaded .is-planned {
				background: rgba(185, 75, 75, 0.88);
			}

			.aster-studio-week-pill__tags {
				margin-top: 12px;
			}

			.aster-studio-week-pill__tag,
			.aster-studio-week-pill__more {
				background: rgba(157, 18, 255, 0.08);
				border-radius: 999px;
				color: var(--studio-accent-strong);
				font-size: 11px;
				font-weight: 600;
				padding: 4px 8px;
			}

			.aster-studio-horizon {
				overflow-x: auto;
				padding: 0 18px 4px;
			}

			.aster-studio-horizon__timeline {
				min-width: max-content;
				width: max-content;
			}

			.aster-studio-horizon__head--continuous,
			.aster-studio-horizon__body--continuous {
				display: grid;
				grid-template-columns: repeat(var(--day-count), minmax(64px, 64px));
			}

			.aster-studio-horizon__head--continuous {
				gap: 0;
				margin-bottom: 0;
				position: sticky;
				top: 0;
				z-index: 3;
			}

			.aster-studio-horizon__day-header {
				background: rgba(36, 49, 60, 0.04);
				border-bottom: 1px solid rgba(36, 49, 60, 0.08);
				border-right: 1px solid rgba(36, 49, 60, 0.06);
				min-height: 88px;
				padding: 8px 6px 10px;
			}

			.aster-studio-horizon__day-header.is-weekend {
				background: rgba(248, 244, 238, 0.92);
			}

			.aster-studio-horizon__day-header.is-today {
				background: rgba(157, 18, 255, 0.10);
			}

			.aster-studio-horizon__day-header.is-active-week {
				background: rgba(157, 18, 255, 0.18);
				box-shadow: inset 0 -3px 0 rgba(157, 18, 255, 0.56);
			}

			.aster-studio-horizon__day-header.has-absence {
				background: linear-gradient(180deg, rgba(255, 234, 214, 0.95) 0%, rgba(255, 246, 237, 0.95) 100%);
				box-shadow: inset 0 -2px 0 rgba(223, 124, 38, 0.42);
			}

			.aster-studio-horizon__day-name {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
			}

			.aster-studio-horizon__day-number {
				color: var(--studio-soft);
				font-size: 14px;
				font-weight: 600;
				margin-top: 4px;
			}

			.aster-studio-horizon__day-capacity {
				color: #24313c;
				font-size: 13px;
				font-weight: 700;
				margin-top: 8px;
			}

			.aster-studio-horizon__day-absence {
				color: #c35f24;
				font-size: 11px;
				font-weight: 700;
				margin-top: 3px;
			}

			.aster-studio-horizon__body--continuous {
				min-height: calc(84px + var(--lane-count) * var(--lane-height, 74px));
				position: relative;
				z-index: 1;
			}

			.aster-studio-horizon-cell {
				background: rgba(255, 255, 255, 0.88);
				border-bottom: 1px solid rgba(36, 49, 60, 0.08);
				border-right: 1px solid rgba(36, 49, 60, 0.06);
				min-height: calc(84px + var(--lane-count) * var(--lane-height, 74px));
				padding: 0;
				position: relative;
				transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
			}

			.aster-studio-horizon-cell.is-weekend {
				background: rgba(248, 244, 238, 0.92);
			}

			.aster-studio-horizon-cell.is-today {
				background: rgba(157, 18, 255, 0.08);
			}

			.aster-studio-horizon-cell.is-active-week {
				background: rgba(157, 18, 255, 0.14);
			}

			.aster-studio-horizon-cell.is-drop-target {
				background: rgba(157, 18, 255, 0.10);
				border-color: rgba(157, 18, 255, 0.38);
				box-shadow: inset 0 0 0 1px rgba(157, 18, 255, 0.22);
			}

			.aster-studio-horizon-cell__actions {
				display: flex;
				inset: 0;
				justify-content: center;
				align-items: center;
				position: absolute;
				z-index: 1;
			}

			.aster-studio-day__create {
				align-items: center;
				background: transparent;
				border: 0;
				border-radius: 999px;
				color: rgba(36, 49, 60, 0.18);
				cursor: pointer;
				display: inline-flex;
				font-size: 18px;
				font-weight: 300;
				height: 24px;
				justify-content: center;
				line-height: 1;
				opacity: 0.6;
				padding: 0;
				transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
				width: 24px;
			}

			.aster-studio-day__create:hover {
				background: rgba(36, 49, 60, 0.05);
				color: rgba(36, 49, 60, 0.48);
				opacity: 1;
			}

			.aster-studio-horizon__bars {
				display: grid;
				gap: 12px 0;
				grid-template-columns: repeat(var(--day-count), minmax(64px, 64px));
				grid-template-rows: repeat(var(--lane-count), var(--lane-height, 74px));
				left: 0;
				padding: 36px 0 16px;
				pointer-events: none;
				position: absolute;
				right: 0;
				top: 0;
				z-index: 2;
			}

			.aster-studio-horizon__empty-note {
				align-self: start;
				background: rgba(36, 49, 60, 0.05);
				border: 1px dashed rgba(36, 49, 60, 0.12);
				border-radius: 14px;
				color: var(--studio-soft);
				font-size: 12px;
				grid-column: 1 / span 4;
				margin-left: 12px;
				padding: 10px 12px;
			}

			.aster-studio-card,
			.aster-studio__list-card {
				background: #fff;
				border: 1px solid rgba(36, 49, 60, 0.08);
				border-radius: 16px;
				box-shadow: 0 10px 24px rgba(28, 41, 49, 0.06);
				padding: 12px;
			}

			.aster-studio__list-card--absence {
				padding: 10px 12px;
			}

			.aster-studio-card {
				align-items: flex-start;
				background: var(--card-color);
				border: 1px solid transparent;
				border-radius: 12px;
				box-shadow: 0 8px 20px rgba(28, 41, 49, 0.12);
				color: var(--card-text-color, #fff);
				display: flex;
				flex-direction: column;
				gap: 3px;
				grid-column: var(--card-preview-column-start, var(--card-column-start)) / var(--card-preview-column-end, var(--card-column-end));
				grid-row: var(--card-lane);
				cursor: grab;
				min-height: var(--lane-height, 52px);
				overflow: hidden;
				padding: 6px 10px 7px;
				position: relative;
				pointer-events: auto;
				white-space: normal;
			}

			.aster-studio-card.is-dragging {
				opacity: 0.55;
			}

			.aster-studio-card.is-resizing {
				box-shadow: 0 10px 24px rgba(28, 41, 49, 0.2);
				cursor: ew-resize;
			}

			.aster-studio-card__week-highlight {
				background: rgba(255, 255, 255, 0.18);
				border-left: 1px solid rgba(255, 255, 255, 0.42);
				border-right: 1px solid rgba(255, 255, 255, 0.42);
				bottom: 0;
				left: var(--week-left);
				position: absolute;
				top: 0;
				width: var(--week-width);
				z-index: 0;
			}

			.aster-studio-card__header {
				align-items: baseline;
				display: flex;
				gap: 8px;
				max-width: 100%;
				min-width: 0;
				position: relative;
				z-index: 2;
			}

			.aster-studio-card__resize-handle {
				bottom: 0;
				cursor: ew-resize;
				position: absolute;
				top: 0;
				width: 10px;
				z-index: 4;
			}

			.aster-studio-card__resize-handle::after {
				background: rgba(255, 255, 255, 0.78);
				border-radius: 999px;
				content: "";
				height: 22px;
				left: 50%;
				opacity: 0;
				position: absolute;
				top: 50%;
				transform: translate(-50%, -50%);
				transition: opacity 0.18s ease;
				width: 3px;
			}

			.aster-studio-card:hover .aster-studio-card__resize-handle::after,
			.aster-studio-card.is-resizing .aster-studio-card__resize-handle::after {
				opacity: 1;
			}

			.aster-studio-card__resize-handle--start {
				left: 0;
			}

			.aster-studio-card__resize-handle--end {
				right: 0;
			}

			.aster-studio-card__title,
			.aster-studio-card__subtitle {
				color: inherit;
				font-size: 12px;
				line-height: 1.2;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				position: relative;
			}

			.aster-studio-card__title {
				flex: 0 1 auto;
				font-size: 14px;
				font-weight: 700;
				min-width: 0;
				max-width: 55%;
			}

			.aster-studio-card__subtitle {
				flex: 1 1 auto;
				min-width: 0;
				opacity: 0.95;
			}

			.aster-studio-card__segments {
				height: calc(var(--assignment-rows, 1) * 18px);
				margin-top: 2px;
				position: relative;
				width: 100%;
				z-index: 2;
			}

			.aster-studio-card__assignment-segment {
				align-items: center;
				background: rgba(255, 255, 255, 0.28);
				border: 1px solid rgba(255, 255, 255, 0.34);
				border-radius: 999px;
				color: inherit;
				cursor: grab;
				display: flex;
				font-size: 10px;
				font-weight: 700;
				gap: 4px;
				height: 16px;
				left: var(--assignment-preview-left, var(--assignment-left));
				line-height: 1;
				min-width: 10px;
				padding: 0 5px;
				position: absolute;
				top: calc((var(--assignment-row) - 1) * 18px);
				width: var(--assignment-preview-width, var(--assignment-width));
				z-index: 2;
			}

			.aster-studio-card__assignment-segment.is-preview {
				box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
				opacity: 0.95;
			}

			.aster-studio-card__assignment-segment.is-outside {
				opacity: 0.18;
			}

			.aster-studio-card__assignment-label,
			.aster-studio-card__assignment-range {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.aster-studio-card__assignment-label {
				flex: 1 1 auto;
				min-width: 0;
			}

			.aster-studio-card__assignment-range {
				flex: 0 0 auto;
				opacity: 0.88;
			}

			.aster-studio-card__assignment-handle {
				background: rgba(255, 255, 255, 0.88);
				border-radius: 999px;
				cursor: ew-resize;
				flex: 0 0 auto;
				height: 10px;
				width: 3px;
			}

			.aster-studio__list-meta {
				font-size: 12px;
				margin-top: 6px;
			}

			.aster-studio__capacity-table-card,
			.aster-studio__absence-table-card {
				background: var(--studio-panel);
				border: 1px solid var(--studio-line);
				border-radius: 24px;
				box-shadow: var(--studio-shadow);
				padding: 16px 18px;
			}

			.aster-studio__capacity-table,
			.aster-studio__absence-table {
				display: grid;
			}

			.aster-studio__capacity-table-row,
			.aster-studio__absence-table-row {
				align-items: center;
				border-top: 1px solid var(--studio-line);
				display: grid;
				gap: 12px;
				padding: 10px 0;
			}

			.aster-studio__capacity-table-row {
				grid-template-columns: minmax(0, 1.4fr) minmax(100px, 0.8fr) minmax(100px, 0.8fr) minmax(100px, 0.8fr);
			}

			.aster-studio__absence-table-row {
				grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.8fr) minmax(90px, 0.7fr);
			}

			.aster-studio__capacity-table-row.is-head,
			.aster-studio__absence-table-row.is-head {
				border-top: 0;
				color: var(--studio-soft);
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				padding-top: 0;
				text-transform: uppercase;
			}

			.aster-studio__capacity-table-name,
			.aster-studio__capacity-table-value,
			.aster-studio__absence-table-name,
			.aster-studio__absence-table-duration {
				font-weight: 700;
			}

			.aster-studio__capacity-table-value.is-negative {
				color: #b94b4b;
			}

			.aster-studio__absence-period {
				align-items: baseline;
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}

			.aster-studio__absence-label {
				color: var(--studio-soft);
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.03em;
				text-transform: uppercase;
			}

			.aster-studio__absence-day {
				font-size: 12px;
				font-weight: 700;
			}

			.aster-studio__absence-time {
				color: var(--studio-soft);
				font-size: 12px;
			}

			.aster-studio__progress {
				background: rgba(36, 49, 60, 0.08);
				border-radius: 999px;
				height: 8px;
				margin-top: 10px;
				overflow: hidden;
			}

			.aster-studio__progress span {
				background: var(--studio-accent);
				display: block;
				height: 100%;
			}

			.aster-studio__empty {
				background: rgba(36, 49, 60, 0.04);
				border-radius: 14px;
				font-size: 13px;
				padding: 12px;
			}

			.aster-studio__empty.is-inline {
				padding: 10px;
			}

			.aster-studio.is-loading {
				opacity: 0.72;
				pointer-events: none;
			}

			@media (max-width: 1320px) {
				.aster-studio__support {
					grid-template-columns: 1fr;
				}
			}

			@media (max-width: 1100px) {
				.aster-studio__metrics {
					grid-template-columns: repeat(2, minmax(0, 1fr));
				}

				.aster-studio__task-type-row {
					grid-template-columns: minmax(0, 1.6fr) repeat(2, minmax(100px, 1fr));
				}

				.aster-studio__capacity-table-row {
					grid-template-columns: minmax(0, 1.2fr) repeat(3, minmax(90px, 0.8fr));
				}

				.aster-studio__absence-table-row {
					grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 1.4fr) minmax(90px, 0.7fr);
				}

				.aster-studio__hero {
					grid-template-columns: 1fr;
				}

				.aster-studio__hero-actions {
					justify-content: flex-start;
				}
			}

			@media (max-width: 680px) {
				.aster-studio__metrics {
					grid-template-columns: 1fr;
				}

				.aster-studio__task-type-row,
				.aster-studio__task-type-row.is-head {
					grid-template-columns: 1fr;
				}

				.aster-studio__capacity-table-row,
				.aster-studio__capacity-table-row.is-head,
				.aster-studio__absence-table-row,
				.aster-studio__absence-table-row.is-head {
					grid-template-columns: 1fr;
				}
			}
		</style>`).appendTo(document.head);
	}
};
