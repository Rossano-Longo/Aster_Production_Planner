frappe.provide("aster_production_planning.capacity_planning");

const ASTER_CAPACITY_PLANNING_UI_VERSION = "cp-ui-v9";

if (!frappe._aster_capacity_invalid_route_guard) {
	frappe._aster_capacity_invalid_route_guard = true;

	try {
		const last_route = (localStorage.getItem("session_last_route") || "").trim().toLowerCase();
		if (["undefined", "/undefined", "desk/undefined", "/desk/undefined"].includes(last_route)) {
			localStorage.removeItem("session_last_route");
		}
	} catch (error) {
		console.warn("Capacity Planning could not inspect session_last_route", error);
	}

	const original_set_route = frappe.set_route.bind(frappe);
	frappe.set_route = function (...args) {
		let route = args;
		if (args.length === 1 && Array.isArray(args[0])) {
			route = args[0];
		} else if (args.length === 1 && typeof args[0] === "string" && args[0].includes("/")) {
			route = args[0].split("/");
		}

		const compact_route = (route || [])
			.filter((value) => value !== null && value !== undefined && value !== "")
			.map((value) => String(value).trim().toLowerCase());
		const route_key = compact_route.join("/");

		if (!compact_route.length || route_key === "undefined" || route_key === "desk/undefined") {
			console.warn("Capacity Planning ignored invalid route", args);
			return Promise.resolve();
		}

		return original_set_route(...args);
	};

	$("body").on("click.asterCapacityInvalidRouteGuard", "a", function (event) {
		const href = (this.getAttribute("href") || "").trim().toLowerCase();
		if (["undefined", "/undefined", "desk/undefined", "/desk/undefined"].includes(href)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return false;
		}
	});
}

frappe.pages["capacity-planning"].on_page_load = function (wrapper) {
	try {
		wrapper.capacity_planning = new aster_production_planning.capacity_planning.Planner(wrapper);
	} catch (error) {
		aster_production_planning.capacity_planning.render_boot_error(wrapper, error, "on_page_load");
	}
};

frappe.pages["capacity-planning"].refresh = function (wrapper) {
	try {
		if (wrapper.capacity_planning && typeof wrapper.capacity_planning.refresh === "function") {
			wrapper.capacity_planning.refresh();
		}
	} catch (error) {
		aster_production_planning.capacity_planning.render_boot_error(wrapper, error, "page_refresh");
	}
};

aster_production_planning.capacity_planning.render_boot_error = function (wrapper, error, context) {
	console.error("Capacity Planning fatal error", context, error);
	const message = frappe.utils.escape_html(error?.stack || error?.message || String(error));
	$(wrapper)
		.empty()
		.append(`
			<div style="padding:24px">
				<div style="max-width:960px;margin:0 auto;background:#fff4f4;border:1px solid #efb1b1;border-radius:16px;padding:20px;color:#7d1f1f">
					<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">
						Capacity Planning Error
					</div>
					<div style="font-size:24px;font-weight:700;margin-bottom:10px">
						Die Seite konnte nicht sauber geladen werden
					</div>
					<div style="margin-bottom:12px">
						Context: ${frappe.utils.escape_html(context || "unknown")} · UI ${ASTER_CAPACITY_PLANNING_UI_VERSION}
					</div>
					<pre style="white-space:pre-wrap;margin:0;font-size:12px;line-height:1.45;background:#fff;border-radius:12px;padding:14px;border:1px solid #f3d3d3">${message}</pre>
				</div>
			</div>
		`);
};

aster_production_planning.capacity_planning.Planner = class Planner {
	constructor(wrapper) {
		try {
			this.wrapper = wrapper;
			this.request_id = 0;
			this.state = null;
			this.preview_card = null;
			this.interaction = null;
			this.board_signature = null;
			this.hour_start = 6;
			this.hour_end = 20;
			this.px_per_hour = 76;
			this.snap_minutes = 15;
			this.suppress_click_until = 0;

			this.set_view_start(moment());
			this.make_page();
			this.make_filters();
			this.make_layout();
			this.bind_actions();
			this.ensure_styles();
		} catch (error) {
			this.show_fatal_error(error, "constructor");
			throw error;
		}
	}

	make_page() {
		this.page = frappe.ui.make_app_page({
			parent: this.wrapper,
			title: __("Capacity Planning"),
			single_column: true,
		});

		$(this.page.main).addClass("aster-capacity-planning-page");
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
			onchange: () => {
				this.refresh();
			},
		});
	}

	make_layout() {
		this.$layout = $(`
			<div class="aster-capacity-shell">
				<div class="aster-capacity-metrics">
					<div class="aster-metric-card" data-metric="planned_hours"></div>
					<div class="aster-metric-card" data-metric="capacity_hours"></div>
					<div class="aster-metric-card" data-metric="available_hours"></div>
					<div class="aster-metric-card" data-metric="planning_cards_count"></div>
				</div>
				<div class="aster-task-type-summary"></div>
				<div class="aster-capacity-note">
					<span class="aster-capacity-note__badge">${__("Capacity Source")}</span>
					<span>${__("Draft and submitted timesheet rows in the visible calendar range")}</span>
					<span class="aster-capacity-note__badge aster-capacity-note__badge--version">${ASTER_CAPACITY_PLANNING_UI_VERSION}</span>
					<span class="aster-capacity-note__period"></span>
				</div>
				<div class="aster-capacity-grid">
					<section class="aster-panel aster-panel--calendar">
						<div class="aster-panel__head">
							<div>
								<h3>${__("Planning Board")}</h3>
								<p>${__("A custom timeline board for weekly production planning with direct moving and resizing.")}</p>
							</div>
							<div class="aster-panel__actions">
								<button type="button" class="btn btn-default btn-sm aster-inline-refresh">${__("Refresh")}</button>
								<button type="button" class="btn btn-default btn-sm aster-open-list">${__("Planning Cards")}</button>
							</div>
						</div>
						<div class="aster-board-stage"></div>
						<div class="aster-planning-list"></div>
					</section>
					<aside class="aster-capacity-sidebar">
						<section class="aster-panel">
							<div class="aster-panel__head">
								<div>
									<h3>${__("Employee Capacity")}</h3>
									<p>${__("Available employee hours for the current view.")}</p>
								</div>
							</div>
							<div class="aster-employee-list"></div>
						</section>
						<section class="aster-panel">
							<div class="aster-panel__head">
								<div>
									<h3>${__("Absences")}</h3>
									<p>${__("Submitted and approved leave applications in the visible period.")}</p>
								</div>
							</div>
							<div class="aster-activity-list"></div>
						</section>
					</aside>
				</div>
			</div>
		`).appendTo(this.page.main);

		this.$board_stage = this.$layout.find(".aster-board-stage");
		this.$planning_list = this.$layout.find(".aster-planning-list");
		this.$employee_list = this.$layout.find(".aster-employee-list");
		this.$activity_list = this.$layout.find(".aster-activity-list");
		this.$period = this.$layout.find(".aster-capacity-note__period");
		this.$task_type_summary = this.$layout.find(".aster-task-type-summary");
	}

	bind_actions() {
		this.page.set_primary_action(__("New Planning Card"), () => {
			this.open_create_dialog();
		});

		this.page.clear_secondary_action();
		this.page.clear_menu();
		this.page.add_menu_item(__("Planning Settings"), () => frappe.set_route("planning-setup"));

		this.$layout.on("click", ".aster-open-list", () => {
			frappe.set_route("List", "Planning Card");
		});

		this.$layout.on("click", ".aster-inline-refresh", () => {
			this.refresh();
		});

		this.$layout.on("click", ".aster-board-nav", (event) => {
			const $button = $(event.currentTarget);
			const action = $button.data("action");
			if (action === "today") {
				this.set_view_start(moment());
			} else {
				this.set_view_start(this.view_start.clone().add(cint($button.data("shift") || 0), "days"));
			}
			this.refresh();
		});

		this.$layout.on("dblclick", ".aster-day-column__canvas", (event) => {
			const slot = this.resolve_pointer_slot(event);
			if (!slot) {
				return;
			}

			this.open_create_dialog({
				start: slot.toDate(),
				end: slot.clone().add(2, "hours").toDate(),
			});
		});

		this.$layout.on("click", ".aster-planning-block", (event) => {
			if ($(event.target).closest(".aster-planning-block__resize").length) {
				return;
			}
			if (Date.now() < this.suppress_click_until) {
				return;
			}

			const name = $(event.currentTarget).data("name");
			if (name) {
				frappe.set_route("Form", "Planning Card", name);
			}
		});

		this.$layout.on("pointerdown", ".aster-planning-block__body", (event) => {
			this.start_interaction(event, "move");
		});

		this.$layout.on("pointerdown", ".aster-planning-block__resize", (event) => {
			this.start_interaction(event, "resize");
		});
	}

	refresh() {
		try {
			const current_request = ++this.request_id;
			this.preview_card = null;
			this.set_loading(true);
			this.update_period_label();

			frappe.call({
				method:
					"aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning.get_planning_dashboard_data",
				args: {
					start_date: this.to_system_datetime(this.current_window.start),
					end_date: this.to_system_datetime(this.current_window.end),
					activity_types: this.get_selected_activity_types(),
				},
				callback: (response) => {
					if (current_request !== this.request_id) {
						return;
					}

					try {
						this.state = response.message || {};
						this.render_metrics(this.state.summary || {});
						this.render_capacity_lists();
						this.render_board();
						this.render_planning_cards(this.state.planning_cards || []);
					} catch (error) {
						this.show_fatal_error(error, "refresh_render");
					}
				},
				error: (error) => {
					this.show_fatal_error(error, "refresh_call");
				},
				always: () => {
					if (current_request === this.request_id) {
						this.set_loading(false);
					}
				},
			});
		} catch (error) {
			this.show_fatal_error(error, "refresh");
			throw error;
		}
	}

	render_metrics(summary) {
		const metrics = [
			{
				key: "planned_hours",
				label: __("Planned Hours"),
				value: `${this.format_hours(summary.planned_hours)} h`,
				helper: `${this.format_percent(summary.utilization_percent)} ${__("utilization")}`,
			},
			{
				key: "capacity_hours",
				label: __("Available Capacity"),
				value: `${this.format_hours(summary.capacity_hours)} h`,
				helper: __("Draft and submitted timesheet capacity"),
			},
			{
				key: "available_hours",
				label: summary.available_hours >= 0 ? __("Remaining Capacity") : __("Overload"),
				value: `${this.format_hours(Math.abs(summary.available_hours || 0))} h`,
				helper:
					summary.available_hours >= 0
						? __("Still available in this range")
						: __("Planned hours exceed available capacity"),
				state: summary.available_hours >= 0 ? "good" : "danger",
			},
			{
				key: "planning_cards_count",
				label: __("Planning Cards"),
				value: cint(summary.planning_cards_count || 0),
				helper: __("Dummy planning entities in view"),
			},
		];

		metrics.forEach((metric) => {
			const $card = this.$layout.find(`[data-metric="${metric.key}"]`);
			$card
				.removeClass("is-good is-danger")
				.toggleClass("is-good", metric.state === "good")
				.toggleClass("is-danger", metric.state === "danger")
				.html(`
					<div class="aster-metric-card__label">${metric.label}</div>
					<div class="aster-metric-card__value">${metric.value}</div>
					<div class="aster-metric-card__helper">${metric.helper}</div>
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
			<div class="aster-task-type-summary__card">
				<div class="aster-task-type-summary__head">
					<div>
						<h4>${__("Task Type Hours")}</h4>
						<p>${__("Planned and assigned hours in the visible range.")}</p>
					</div>
				</div>
				<div class="aster-task-type-summary__table">
					<div class="aster-task-type-summary__row is-head">
						<div>${__("Task Type")}</div>
						<div>${__("Planned Hours")}</div>
						<div>${__("Assigned Hours")}</div>
					</div>
					${rows
						.map(
							(row) => `
								<div class="aster-task-type-summary__row">
									<div class="aster-task-type-summary__type">
										<span class="aster-task-type-summary__swatch" style="background:${row.color || "rgba(47, 111, 97, 0.18)"}"></span>
										<span>${frappe.utils.escape_html(row.label || __("Without Task Type"))}</span>
									</div>
									<div>${this.format_hours(row.planned_hours)} h</div>
									<div>${this.format_hours(row.assigned_hours)} h</div>
								</div>
							`
						)
						.join("")}
				</div>
			</div>
		`);
	}

	render_capacity_lists() {
		this.render_employee_capacity(this.state.capacity_by_employee || []);
		this.render_absences(this.state.absences || []);
	}

	render_planning_cards(cards) {
		if (!cards.length) {
			this.$planning_list.html(this.empty_state(__("No Planning Cards found in the visible date range.")));
			return;
		}

		this.$planning_list.html(`
			<div class="aster-planning-list__head">
				<div>
					<h4>${__("Planning Cards In View")}</h4>
					<p>${__("Every card below is rendered from the same dataset as the board.")}</p>
				</div>
				<div class="aster-planning-list__count">${cards.length}</div>
			</div>
			<div class="aster-planning-list__items">
				${cards
					.map((card) => {
						const start = this.format_datetime(card.start_date);
						const end = this.format_datetime(card.end_date);
						return `
							<div class="aster-planning-card-row">
								<div class="aster-planning-card-row__swatch" style="background:${card.color || "#2f6f61"}"></div>
								<div class="aster-planning-card-row__body">
									<div class="aster-planning-card-row__title">${frappe.utils.escape_html(card.title)}</div>
									<div class="aster-planning-card-row__meta">${frappe.utils.escape_html(card.name)} · ${this.format_hours(card.duration_in_hours)} h</div>
									<div class="aster-planning-card-row__meta">${frappe.utils.escape_html(start)} -> ${frappe.utils.escape_html(end)}</div>
								</div>
							</div>
						`;
					})
					.join("")}
			</div>
		`);
	}

	render_employee_capacity(items) {
		if (!items.length) {
			this.$employee_list.html(this.empty_state(__("No draft capacity found for the current range.")));
			return;
		}

		this.$employee_list.html(
			items
				.map((item) => {
					const activities = item.activity_types.length
						? item.activity_types
								.map(
									(activity) =>
										`<span class="aster-tag">${frappe.utils.escape_html(activity)}</span>`
								)
								.join("")
						: `<span class="aster-tag">${__("No Activity Type")}</span>`;

					return `
						<div class="aster-capacity-item">
							<div class="aster-capacity-item__top">
								<div>
									<div class="aster-capacity-item__title">${frappe.utils.escape_html(item.employee_name)}</div>
									<div class="aster-capacity-item__meta">${frappe.utils.escape_html(item.department || __("No Department"))}</div>
								</div>
								<div class="aster-capacity-item__value">${this.format_hours(item.capacity_hours)} h</div>
							</div>
							<div class="aster-capacity-item__bar">
								<span style="width:${item.share_percent || 0}%"></span>
							</div>
							<div class="aster-capacity-item__meta">
								${cint(item.timesheet_rows)} ${__("rows")} · ${this.format_percent(item.share_percent)} ${__("of visible capacity")}
							</div>
							<div class="aster-capacity-item__tags">${activities}</div>
						</div>
					`;
				})
				.join("")
		);
	}

	render_absences(items) {
		if (!items.length) {
			this.$activity_list.html(this.empty_state(__("No submitted absences found for the current range.")));
			return;
		}

		this.$activity_list.html(
			items
				.map((item) => {
					return `
						<div class="aster-capacity-item">
							<div class="aster-capacity-item__top">
								<div>
									<div class="aster-capacity-item__title">${frappe.utils.escape_html(item.employee_name)}</div>
									<div class="aster-capacity-item__meta">${frappe.utils.escape_html(item.department || __("No Department"))}</div>
								</div>
								<div class="aster-capacity-item__value">${flt(item.overlap_days)} ${__("days")}</div>
							</div>
							<div class="aster-capacity-item__meta">${frappe.utils.escape_html(item.leave_type || __("Leave"))}</div>
							${this.get_absence_schedule_markup(item)}
						</div>
					`;
				})
				.join("")
		);
	}

	render_board() {
		this.render_board_scaffold();
		this.render_board_cards(this.get_cards_for_render());
	}

	render_board_scaffold() {
		const signature = this.view_start.format("YYYY-MM-DD");
		const days = this.get_view_days();
		const board_height = this.get_board_height();

		if (signature !== this.board_signature) {
			this.board_signature = signature;
			this.$board_stage.html(`
				<div class="aster-board-toolbar">
					<div class="aster-board-toolbar__nav">
						<button type="button" class="btn btn-default btn-sm aster-board-nav" data-shift="-7">${__("Prev Week")}</button>
						<button type="button" class="btn btn-default btn-sm aster-board-nav" data-shift="7">${__("Next Week")}</button>
						<button type="button" class="btn btn-default btn-sm aster-board-nav" data-action="today">${__("Today")}</button>
					</div>
					<div class="aster-board-toolbar__title"></div>
					<div class="aster-board-toolbar__hint">${__("Double-click in a column to create a card")}</div>
				</div>
				<div class="aster-week-board">
					<div class="aster-week-board__header">
						<div class="aster-week-board__corner">${__("Time")}</div>
						<div class="aster-week-board__days">
							${days
								.map(
									(day) => `
										<div class="aster-day-head ${day.isoWeekday() >= 6 ? "is-weekend" : ""}">
											<div class="aster-day-head__weekday">${day.format("ddd")}</div>
											<div class="aster-day-head__date">${day.format("DD.MM")}</div>
										</div>
									`
								)
								.join("")}
						</div>
					</div>
					<div class="aster-week-board__scroll">
						<div class="aster-week-board__body">
							<div class="aster-week-board__times">
								${this.get_hour_labels()
									.map(
										(hour) => `
											<div class="aster-time-label" style="height:${this.px_per_hour}px">
												${hour}
											</div>
										`
									)
									.join("")}
							</div>
							<div class="aster-day-columns">
								${days
									.map(
										(day) => `
											<div class="aster-day-column ${day.isoWeekday() >= 6 ? "is-weekend" : ""}" data-date="${day.format("YYYY-MM-DD")}">
												<div class="aster-day-column__canvas" style="height:${board_height}px"></div>
											</div>
										`
									)
									.join("")}
							</div>
						</div>
					</div>
				</div>
			`);

			this.$board_scroll = this.$board_stage.find(".aster-week-board__scroll");
		}

		this.$board_stage
			.find(".aster-board-toolbar__title")
			.text(`${days[0].format("DD MMM")} - ${days[6].format("DD MMM YYYY")}`);
	}

	render_board_cards(cards) {
		const $canvases = this.$board_stage.find(".aster-day-column__canvas");
		$canvases.empty();

		this.render_now_marker();

		cards.forEach((card) => {
			this.get_card_segments(card).forEach((segment) => {
				const date_key = segment.start.format("YYYY-MM-DD");
				const $canvas = this.$board_stage.find(`.aster-day-column[data-date="${date_key}"] .aster-day-column__canvas`);
				if (!$canvas.length) {
					return;
				}

				const top = this.get_offset_from_time(segment.start);
				const height = Math.max(this.get_offset_from_time(segment.end) - top, 58);
				const compact = height < 92;
				const $block = $(`
					<div
						class="aster-planning-block ${compact ? "is-compact" : ""} ${card.name === this.preview_card?.name ? "is-preview" : ""}"
						data-name="${frappe.utils.escape_html(card.name)}"
						style="top:${top}px;height:${height}px;background:${card.color || "#2f6f61"}"
					>
						<div class="aster-planning-block__body">
							<div class="aster-planning-block__project">${frappe.utils.escape_html(card.project)}</div>
							<div class="aster-planning-block__operation">${frappe.utils.escape_html(card.operation)}</div>
							<div class="aster-planning-block__time">${segment.start.format("HH:mm")} - ${segment.end.format("HH:mm")}</div>
						</div>
						${
							segment.is_last
								? `<div class="aster-planning-block__resize" title="${__("Resize")}"></div>`
								: ""
						}
					</div>
				`);
				$canvas.append($block);
			});
		});
	}

	render_now_marker() {
		const now = moment();
		const within_range =
			now.isSameOrAfter(this.view_start, "day") && now.isBefore(this.view_start.clone().add(7, "days"), "day");
		const within_hours =
			this.get_minutes_of_day(now) >= this.hour_start * 60 &&
			this.get_minutes_of_day(now) <= this.hour_end * 60;

		if (!within_range || !within_hours) {
			return;
		}

		const date_key = now.format("YYYY-MM-DD");
		const $canvas = this.$board_stage.find(`.aster-day-column[data-date="${date_key}"] .aster-day-column__canvas`);
		if (!$canvas.length) {
			return;
		}

		$canvas.append(`<div class="aster-now-line" style="top:${this.get_offset_from_time(now)}px"></div>`);
	}

	get_card_segments(card) {
		const start = this.to_user_moment(card.start_date);
		const end = this.to_user_moment(card.end_date);
		const segments = [];
		let cursor = start.clone();

		while (cursor.isBefore(end)) {
			const day_end = cursor.clone().endOf("day");
			const segment_end = moment.min(end, day_end);
			segments.push({
				start: cursor.clone(),
				end: segment_end.clone(),
				is_last: segment_end.isSame(end),
			});
			cursor = segment_end.clone().add(1, "second").startOf("day");
		}

		return segments;
	}

	open_create_dialog(selection_info = null) {
		const defaults = this.get_dialog_defaults(selection_info);
		let dialog = null;

		dialog = frappe.prompt(
			[
				{
					fieldname: "project",
					fieldtype: "Link",
					label: __("Project"),
					options: "Project",
					reqd: 1,
				},
				{
					fieldname: "elementgruppe",
					fieldtype: "Data",
					label: __("Elementgruppe"),
				},
				{
					fieldname: "operation",
					fieldtype: "Link",
					label: __("Operation"),
					options: "Operation",
					onchange: () => {
						this.load_operation_defaults(dialog);
					},
				},
				{
					fieldname: "task_type",
					fieldtype: "Link",
					label: __("Task Type"),
					options: "Task Type",
					default: defaults.task_type,
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
					default: defaults.start_date,
				},
				{
					fieldname: "required_hours",
					fieldtype: "Float",
					label: __("Required Hours"),
					reqd: 1,
					default: defaults.duration_in_hours,
				},
				{
					fieldname: "note",
					fieldtype: "Small Text",
					label: __("Note"),
				},
			],
			(values) => {
				frappe.call({
					method:
						"aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning.create_planning_card",
					args: {
						project: values.project,
						elementgruppe: values.elementgruppe,
						operation: values.operation,
						task_type: values.task_type,
						start_date: frappe.datetime.convert_to_system_tz(values.start_date),
						required_hours: values.required_hours,
						note: values.note,
					},
				}).then(() => {
					frappe.show_alert({
						message: __("Planning Card created"),
						indicator: "green",
					});
					this.refresh();
				});
			},
			__("New Planning Card"),
			__("Create")
		);
		dialog.__task_type_touched = false;
		if (defaults.operation && dialog?.get_value("operation")) {
			this.load_operation_defaults(dialog);
		}
	}

	load_operation_defaults(dialog) {
		const operation = dialog?.get_value("operation");
		if (!operation) {
			return;
		}

		frappe.db.get_value("Operation", operation, ["total_operation_time", "custom_task_type"], (response) => {
			const message = response?.message || response || {};
			if (!dialog.__task_type_touched) {
				this.apply_production_planning_task_type(dialog, message.custom_task_type || "");
			}
			if (flt(dialog.get_value("required_hours")) > 0) {
				return;
			}
			const totalOperationMinutes = flt(message.total_operation_time || 0);
			if (totalOperationMinutes <= 0) {
				return;
			}

			dialog.set_value("required_hours", flt(totalOperationMinutes / 60, 2));
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

	start_interaction(event, mode) {
		const native = event.originalEvent || event;
		if (native.button !== undefined && native.button !== 0) {
			return;
		}

		const $block = $(event.currentTarget).closest(".aster-planning-block");
		const card = this.get_card_by_name($block.data("name"));
		if (!card) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		this.interaction = {
			mode,
			card,
			original_start: this.to_user_moment(card.start_date),
			original_end: this.to_user_moment(card.end_date),
			start_client_x: native.clientX,
			start_client_y: native.clientY,
			moved: false,
		};

		$("body").addClass("aster-is-dragging");
		$(document)
			.on("pointermove.asterPlanner", (move_event) => this.on_pointer_move(move_event))
			.on("pointerup.asterPlanner pointercancel.asterPlanner", (up_event) =>
				this.on_pointer_up(up_event)
			);
	}

	on_pointer_move(event) {
		if (!this.interaction) {
			return;
		}

		const native = event.originalEvent || event;
		const distance = Math.abs(native.clientX - this.interaction.start_client_x) +
			Math.abs(native.clientY - this.interaction.start_client_y);
		if (distance > 4) {
			this.interaction.moved = true;
		}

		const next_window = this.compute_interaction_window(native.clientX, native.clientY);
		if (!next_window) {
			return;
		}

		this.preview_card = this.build_preview_card(this.interaction.card, next_window.start, next_window.end);
		this.render_board_cards(this.get_cards_for_render());
	}

	on_pointer_up() {
		if (!this.interaction) {
			return;
		}

		const interaction = this.interaction;
		const preview_card = this.preview_card;

		this.interaction = null;
		$("body").removeClass("aster-is-dragging");
		$(document).off(".asterPlanner");

		if (!interaction.moved || !preview_card) {
			this.preview_card = null;
			this.render_board_cards(this.get_cards_for_render());
			return;
		}

		this.suppress_click_until = Date.now() + 250;
		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.capacity_planning.capacity_planning.update_planning_card_schedule",
			args: {
				name: interaction.card.name,
				start_date: preview_card.start_date,
				end_date: preview_card.end_date,
			},
			callback: () => {
				frappe.show_alert({
					message: __("Planning Card updated"),
					indicator: "green",
				});
				this.refresh();
			},
			error: () => {
				this.preview_card = null;
				this.render_board_cards(this.get_cards_for_render());
			},
		});
	}

	compute_interaction_window(client_x, client_y) {
		const slot = this.resolve_pointer_slot({ clientX: client_x, clientY: client_y });
		if (!slot) {
			return null;
		}

		if (this.interaction.mode === "resize") {
			const end = slot.clone();
			if (end.diff(this.interaction.original_start, "minutes") < this.snap_minutes) {
				end.add(this.snap_minutes - end.diff(this.interaction.original_start, "minutes"), "minutes");
			}
			return {
				start: this.interaction.original_start.clone(),
				end: end.isAfter(this.interaction.original_start)
					? end
					: this.interaction.original_start.clone().add(this.snap_minutes, "minutes"),
			};
		}

		const duration = this.interaction.original_end.diff(this.interaction.original_start, "minutes");
		return {
			start: slot.clone(),
			end: slot.clone().add(duration, "minutes"),
		};
	}

	resolve_pointer_slot(event) {
		const native = event.originalEvent || event;
		const columns_el = this.$board_stage.find(".aster-day-columns").get(0);
		const first_canvas = this.$board_stage.find(".aster-day-column__canvas").get(0);

		if (!columns_el || !first_canvas) {
			return null;
		}

		const columns_rect = columns_el.getBoundingClientRect();
		const canvas_rect = first_canvas.getBoundingClientRect();
		const scroll_top = this.$board_scroll?.scrollTop() || 0;
		const column_width = columns_rect.width / 7;
		const local_x = Math.min(Math.max(native.clientX - columns_rect.left, 0), columns_rect.width - 1);
		const local_y = Math.min(
			Math.max(native.clientY - canvas_rect.top + scroll_top, 0),
			this.get_board_height()
		);
		const day_index = Math.min(Math.max(Math.floor(local_x / column_width), 0), 6);
		const minutes = this.hour_start * 60 + (local_y / this.px_per_hour) * 60;
		const snapped_minutes = this.snap_to_minutes(minutes);
		const day = this.view_start.clone().add(day_index, "days");

		return day
			.clone()
			.hour(Math.floor(snapped_minutes / 60))
			.minute(snapped_minutes % 60)
			.second(0);
	}

	build_preview_card(card, start, end) {
		return {
			...card,
			start_date: this.to_system_datetime(start.toDate()),
			end_date: this.to_system_datetime(end.toDate()),
			duration_in_hours: end.diff(start, "minutes") / 60,
		};
	}

	get_cards_for_render() {
		const cards = [...(this.state?.planning_cards || [])];
		if (!this.preview_card) {
			return cards;
		}

		return cards.map((card) => (card.name === this.preview_card.name ? this.preview_card : card));
	}

	get_card_by_name(name) {
		return (this.state?.planning_cards || []).find((card) => card.name === name);
	}

	get_dialog_defaults(selection_info) {
		if (selection_info?.start) {
			const start = moment(selection_info.start);
			const end = selection_info.end ? moment(selection_info.end) : start.clone().add(4, "hours");
			return {
				start_date: start.format(frappe.defaultDatetimeFormat),
				duration_in_hours: this.round_hours(end.diff(start, "minutes") / 60),
			};
		}

		const start = moment().startOf("hour").add(1, "hour");
		return {
			start_date: start.format(frappe.defaultDatetimeFormat),
			duration_in_hours: 4,
		};
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
			try {
				const parsed = JSON.parse(value);
				if (Array.isArray(parsed)) {
					return parsed.filter(Boolean);
				}
			} catch (error) {
				return value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean);
			}
		}

		return [value];
	}

	set_view_start(date) {
		this.view_start = date.clone().startOf("isoWeek");
		this.current_window = {
			start: this.view_start.clone().startOf("day").toDate(),
			end: this.view_start.clone().add(7, "days").startOf("day").toDate(),
		};
	}

	get_view_days() {
		return Array.from({ length: 7 }, (_, index) => this.view_start.clone().add(index, "days"));
	}

	get_hour_labels() {
		return Array.from({ length: this.hour_end - this.hour_start }, (_, index) =>
			moment()
				.hour(this.hour_start + index)
				.minute(0)
				.format("HH:mm")
		);
	}

	get_board_height() {
		return (this.hour_end - this.hour_start) * this.px_per_hour;
	}

	get_minutes_of_day(value) {
		return value.hours() * 60 + value.minutes();
	}

	get_offset_from_time(value) {
		const minutes = this.get_minutes_of_day(value);
		return ((minutes - this.hour_start * 60) / 60) * this.px_per_hour;
	}

	snap_to_minutes(value) {
		const snapped = Math.round(value / this.snap_minutes) * this.snap_minutes;
		return Math.min(Math.max(snapped, this.hour_start * 60), this.hour_end * 60);
	}

	update_period_label() {
		const start = moment(this.current_window.start).format("DD MMM YYYY");
		const end = moment(this.current_window.end).subtract(1, "day").format("DD MMM YYYY");
		this.$period.text(`${__("Visible Range")}: ${start} - ${end}`);
	}

	set_loading(is_loading) {
		this.$layout.toggleClass("is-loading", is_loading);
	}

	to_system_datetime(date) {
		return frappe.datetime.convert_to_system_tz(moment(date).format(frappe.defaultDatetimeFormat));
	}

	to_user_moment(value) {
		return moment(frappe.datetime.convert_to_user_tz(value), frappe.defaultDatetimeFormat);
	}

	format_hours(value) {
		return format_number(this.round_hours(value || 0), null, 1);
	}

	format_percent(value) {
		return `${format_number(value || 0, null, 1)}%`;
	}

	format_datetime(value) {
		return this.to_user_moment(value).format("DD.MM.YYYY HH:mm");
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

		return `
			<div class="aster-capacity-item__absence-range">
				<div class="aster-capacity-item__absence-point">
					<span class="aster-capacity-item__absence-label">${__("From")}</span>
					<span class="aster-capacity-item__absence-day">${frappe.utils.escape_html(start.day)}</span>
					${start.time ? `<span class="aster-capacity-item__absence-time">${frappe.utils.escape_html(start.time)}</span>` : ""}
				</div>
				<div class="aster-capacity-item__absence-point">
					<span class="aster-capacity-item__absence-label">${__("To")}</span>
					<span class="aster-capacity-item__absence-day">${frappe.utils.escape_html(end.day)}</span>
					${end.time ? `<span class="aster-capacity-item__absence-time">${frappe.utils.escape_html(end.time)}</span>` : ""}
				</div>
			</div>
		`;
	}

	round_hours(value) {
		return Math.round((flt(value) || 0) * 4) / 4;
	}

	empty_state(message) {
		return `
			<div class="aster-empty-state">
				<div class="aster-empty-state__title">${__("Nothing to show")}</div>
				<div class="aster-empty-state__text">${message}</div>
			</div>
		`;
	}

	show_fatal_error(error, context) {
		console.error("Capacity Planning fatal error", context, error);
		if (!this.wrapper) {
			return;
		}

		const message = frappe.utils.escape_html(error?.stack || error?.message || String(error));
		$(this.wrapper).find(".layout-main-section").html(`
			<div class="aster-capacity-fatal">
				<div class="aster-capacity-fatal__eyebrow">Capacity Planning Error</div>
				<h3>${__("Die Seite konnte nicht sauber geladen werden")}</h3>
				<p>${__("Context")}: ${frappe.utils.escape_html(context || "unknown")} · UI ${ASTER_CAPACITY_PLANNING_UI_VERSION}</p>
				<pre>${message}</pre>
			</div>
		`);
	}

	ensure_styles() {
		if (document.getElementById("aster-capacity-planning-style")) {
			return;
		}

		$(`<style id="aster-capacity-planning-style">
			.aster-capacity-shell {
				--aster-ink: #17313a;
				--aster-ink-soft: #55727c;
				--aster-line: rgba(23, 49, 58, 0.12);
				--aster-panel: linear-gradient(180deg, #ffffff 0%, #f7f3ec 100%);
				--aster-panel-alt: linear-gradient(180deg, #f8fbfb 0%, #eef6f3 100%);
				--aster-accent: #2f6f61;
				--aster-accent-soft: rgba(47, 111, 97, 0.14);
				--aster-warm: #cc7a3c;
				--aster-danger: #b94b4b;
				--aster-shadow: 0 20px 45px rgba(29, 43, 51, 0.08);
				color: var(--aster-ink);
				padding: 12px 0 28px;
			}

			.aster-capacity-metrics {
				display: grid;
				gap: 14px;
				grid-template-columns: repeat(4, minmax(0, 1fr));
				margin-bottom: 14px;
			}

			.aster-task-type-summary {
				margin-bottom: 14px;
			}

			.aster-task-type-summary__card {
				background: var(--aster-panel);
				border: 1px solid var(--aster-line);
				border-radius: 20px;
				box-shadow: var(--aster-shadow);
				padding: 18px 20px;
			}

			.aster-task-type-summary__head h4 {
				font-size: 16px;
				font-weight: 700;
				margin: 0;
			}

			.aster-task-type-summary__head p {
				color: var(--aster-ink-soft);
				font-size: 13px;
				margin: 4px 0 0;
			}

			.aster-task-type-summary__table {
				display: grid;
				margin-top: 14px;
			}

			.aster-task-type-summary__row {
				align-items: center;
				border-top: 1px solid var(--aster-line);
				display: grid;
				gap: 12px;
				grid-template-columns: minmax(0, 2fr) minmax(120px, 1fr) minmax(120px, 1fr);
				padding: 10px 0;
			}

			.aster-task-type-summary__row.is-head {
				border-top: 0;
				color: var(--aster-ink-soft);
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				padding-top: 0;
				text-transform: uppercase;
			}

			.aster-task-type-summary__type {
				align-items: center;
				display: flex;
				gap: 10px;
				font-weight: 600;
				min-width: 0;
			}

			.aster-task-type-summary__swatch {
				border-radius: 999px;
				display: inline-block;
				flex: 0 0 10px;
				height: 10px;
				width: 10px;
			}

			.aster-capacity-fatal {
				background: #fff4f4;
				border: 1px solid #efb1b1;
				border-radius: 20px;
				color: #7d1f1f;
				margin: 16px 0;
				padding: 20px;
			}

			.aster-capacity-fatal__eyebrow {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.08em;
				margin-bottom: 8px;
				text-transform: uppercase;
			}

			.aster-capacity-fatal pre {
				background: #fff;
				border: 1px solid #f3d3d3;
				border-radius: 12px;
				font-size: 12px;
				line-height: 1.45;
				margin: 0;
				padding: 14px;
				white-space: pre-wrap;
			}

			.aster-metric-card,
			.aster-panel {
				background: var(--aster-panel);
				border: 1px solid var(--aster-line);
				border-radius: 20px;
				box-shadow: var(--aster-shadow);
			}

			.aster-metric-card {
				padding: 18px 20px;
				position: relative;
				overflow: hidden;
			}

			.aster-metric-card::after {
				background: radial-gradient(circle at top right, rgba(204, 122, 60, 0.18), transparent 55%);
				content: "";
				inset: 0;
				position: absolute;
				pointer-events: none;
			}

			.aster-metric-card.is-good::after {
				background: radial-gradient(circle at top right, rgba(47, 111, 97, 0.18), transparent 55%);
			}

			.aster-metric-card.is-danger::after {
				background: radial-gradient(circle at top right, rgba(185, 75, 75, 0.18), transparent 55%);
			}

			.aster-metric-card__label,
			.aster-capacity-item__meta,
			.aster-panel__head p,
			.aster-capacity-note {
				color: var(--aster-ink-soft);
			}

			.aster-capacity-item__absence-range {
				display: grid;
				gap: 6px;
				margin-top: 8px;
			}

			.aster-capacity-item__absence-point {
				align-items: baseline;
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}

			.aster-capacity-item__absence-label {
				color: var(--aster-ink-soft);
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.03em;
				text-transform: uppercase;
			}

			.aster-capacity-item__absence-day {
				font-size: 12px;
				font-weight: 700;
			}

			.aster-capacity-item__absence-time {
				color: var(--aster-ink-soft);
				font-size: 12px;
			}

			.aster-metric-card__label {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.06em;
				text-transform: uppercase;
			}

			.aster-metric-card__value {
				font-size: 32px;
				font-weight: 700;
				line-height: 1.05;
				margin: 10px 0 6px;
				position: relative;
				z-index: 1;
			}

			.aster-metric-card__helper {
				font-size: 13px;
				position: relative;
				z-index: 1;
			}

			.aster-capacity-note {
				align-items: center;
				background: linear-gradient(135deg, #f4eee5 0%, #fbf8f3 100%);
				border: 1px solid var(--aster-line);
				border-radius: 16px;
				display: flex;
				flex-wrap: wrap;
				gap: 10px;
				margin-bottom: 14px;
				padding: 12px 16px;
			}

			.aster-capacity-note__badge {
				background: rgba(23, 49, 58, 0.08);
				border-radius: 999px;
				color: var(--aster-ink);
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.05em;
				padding: 5px 10px;
				text-transform: uppercase;
			}

			.aster-capacity-note__period {
				font-weight: 600;
				margin-left: auto;
			}

			.aster-capacity-grid {
				display: grid;
				gap: 16px;
				grid-template-columns: minmax(0, 1.75fr) minmax(320px, 0.9fr);
			}

			.aster-panel {
				padding: 18px;
			}

			.aster-panel--calendar {
				background: var(--aster-panel-alt);
			}

			.aster-panel__head {
				align-items: start;
				display: flex;
				gap: 12px;
				justify-content: space-between;
				margin-bottom: 14px;
			}

			.aster-panel__head h3 {
				font-size: 18px;
				font-weight: 700;
				margin: 0 0 4px;
			}

			.aster-panel__head p {
				font-size: 13px;
				margin: 0;
				max-width: 520px;
			}

			.aster-capacity-sidebar {
				display: grid;
				gap: 16px;
			}

			.aster-board-stage {
				display: grid;
				gap: 12px;
			}

			.aster-board-toolbar {
				align-items: center;
				display: grid;
				gap: 12px;
				grid-template-columns: auto 1fr auto;
			}

			.aster-board-toolbar__nav {
				display: flex;
				gap: 8px;
			}

			.aster-board-toolbar__title {
				font-size: 22px;
				font-weight: 700;
				text-align: center;
			}

			.aster-board-toolbar__hint {
				color: var(--aster-ink-soft);
				font-size: 12px;
				text-align: right;
			}

			.aster-week-board {
				background: rgba(255, 255, 255, 0.82);
				border: 1px solid rgba(23, 49, 58, 0.08);
				border-radius: 20px;
				overflow: hidden;
			}

			.aster-week-board__header,
			.aster-week-board__body {
				display: grid;
				grid-template-columns: 78px 1fr;
			}

			.aster-week-board__corner {
				align-items: center;
				background: rgba(23, 49, 58, 0.04);
				border-right: 1px solid rgba(23, 49, 58, 0.08);
				color: var(--aster-ink-soft);
				display: flex;
				font-size: 12px;
				font-weight: 700;
				justify-content: center;
				letter-spacing: 0.04em;
				padding: 12px 8px;
				text-transform: uppercase;
			}

			.aster-week-board__days,
			.aster-day-columns {
				display: grid;
				grid-template-columns: repeat(7, minmax(140px, 1fr));
			}

			.aster-day-head {
				background: rgba(248, 251, 251, 0.92);
				border-left: 1px solid rgba(23, 49, 58, 0.08);
				padding: 14px 10px;
				text-align: center;
			}

			.aster-day-head.is-weekend {
				background: rgba(23, 49, 58, 0.03);
			}

			.aster-day-head__weekday {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
			}

			.aster-day-head__date {
				color: var(--aster-ink-soft);
				font-size: 12px;
				margin-top: 3px;
			}

			.aster-week-board__scroll {
				max-height: 760px;
				overflow: auto;
			}

			.aster-week-board__times {
				background:
					repeating-linear-gradient(
						to bottom,
						transparent 0,
						transparent calc(${this.px_per_hour}px - 1px),
						rgba(23, 49, 58, 0.08) calc(${this.px_per_hour}px - 1px),
						rgba(23, 49, 58, 0.08) ${this.px_per_hour}px
					);
				border-right: 1px solid rgba(23, 49, 58, 0.08);
			}

			.aster-time-label {
				align-items: start;
				color: var(--aster-ink-soft);
				display: flex;
				font-size: 12px;
				justify-content: center;
				padding-top: 6px;
			}

			.aster-day-column {
				border-left: 1px solid rgba(23, 49, 58, 0.08);
				min-width: 0;
			}

			.aster-day-column.is-weekend {
				background: rgba(23, 49, 58, 0.025);
			}

			.aster-day-column__canvas {
				background:
					repeating-linear-gradient(
						to bottom,
						rgba(23, 49, 58, 0.02) 0,
						rgba(23, 49, 58, 0.02) 1px,
						transparent 1px,
						transparent calc(${this.px_per_hour / 2}px),
						rgba(23, 49, 58, 0.045) calc(${this.px_per_hour / 2}px),
						rgba(23, 49, 58, 0.045) calc(${this.px_per_hour / 2}px + 1px),
						transparent calc(${this.px_per_hour / 2}px + 1px),
						transparent ${this.px_per_hour}px
					);
				position: relative;
			}

			.aster-planning-block {
				border: 0;
				border-radius: 16px;
				box-shadow: 0 12px 24px rgba(23, 49, 58, 0.14);
				color: #ffffff;
				cursor: grab;
				left: 8px;
				overflow: hidden;
				position: absolute;
				right: 8px;
				user-select: none;
			}

			.aster-planning-block.is-preview {
				opacity: 0.82;
			}

			.aster-planning-block.is-compact .aster-planning-block__operation,
			.aster-planning-block.is-compact .aster-planning-block__time {
				display: none;
			}

			.aster-planning-block__body {
				cursor: grab;
				display: grid;
				gap: 4px;
				height: calc(100% - 12px);
				padding: 12px 12px 4px;
				text-align: left;
				width: 100%;
			}

			.aster-planning-block__project {
				font-size: 14px;
				font-weight: 700;
				line-height: 1.15;
			}

			.aster-planning-block__operation,
			.aster-planning-block__time {
				font-size: 12px;
				line-height: 1.2;
				opacity: 0.92;
			}

			.aster-planning-block__resize {
				background: rgba(255, 255, 255, 0.28);
				bottom: 0;
				cursor: ns-resize;
				height: 12px;
				left: 0;
				position: absolute;
				right: 0;
			}

			.aster-now-line {
				border-top: 2px dashed #ff6c5c;
				left: 0;
				position: absolute;
				right: 0;
				z-index: 2;
			}

			.aster-planning-list {
				border-top: 1px solid rgba(23, 49, 58, 0.08);
				display: grid;
				gap: 10px;
				margin-top: 14px;
				padding-top: 14px;
			}

			.aster-planning-list__head {
				align-items: center;
				display: flex;
				gap: 12px;
				justify-content: space-between;
			}

			.aster-planning-list__head h4 {
				font-size: 15px;
				font-weight: 700;
				margin: 0 0 3px;
			}

			.aster-planning-list__head p,
			.aster-planning-card-row__meta {
				color: var(--aster-ink-soft);
				font-size: 12px;
				margin: 0;
			}

			.aster-planning-list__count {
				background: rgba(23, 49, 58, 0.08);
				border-radius: 999px;
				font-size: 12px;
				font-weight: 700;
				min-width: 28px;
				padding: 6px 10px;
				text-align: center;
			}

			.aster-planning-list__items {
				display: grid;
				gap: 10px;
			}

			.aster-planning-card-row {
				align-items: stretch;
				background: rgba(255, 255, 255, 0.72);
				border: 1px solid rgba(23, 49, 58, 0.08);
				border-radius: 14px;
				display: grid;
				grid-template-columns: 8px 1fr;
				overflow: hidden;
			}

			.aster-planning-card-row__swatch {
				min-height: 100%;
			}

			.aster-planning-card-row__body {
				padding: 12px 14px;
			}

			.aster-planning-card-row__title {
				font-size: 14px;
				font-weight: 700;
				margin-bottom: 4px;
			}

			.aster-employee-list,
			.aster-activity-list {
				display: grid;
				gap: 12px;
			}

			.aster-capacity-item {
				background: rgba(255, 255, 255, 0.72);
				border: 1px solid rgba(23, 49, 58, 0.08);
				border-radius: 16px;
				padding: 14px;
			}

			.aster-capacity-item__top {
				align-items: start;
				display: flex;
				gap: 12px;
				justify-content: space-between;
				margin-bottom: 10px;
			}

			.aster-capacity-item__title {
				font-size: 15px;
				font-weight: 700;
				line-height: 1.25;
			}

			.aster-capacity-item__value {
				font-size: 17px;
				font-weight: 700;
				white-space: nowrap;
			}

			.aster-capacity-item__bar {
				background: rgba(23, 49, 58, 0.08);
				border-radius: 999px;
				height: 8px;
				margin-bottom: 10px;
				overflow: hidden;
			}

			.aster-capacity-item__bar span {
				background: linear-gradient(90deg, #2f6f61 0%, #cc7a3c 100%);
				border-radius: inherit;
				display: block;
				height: 100%;
			}

			.aster-capacity-item__tags {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
				margin-top: 10px;
			}

			.aster-tag {
				background: var(--aster-accent-soft);
				border-radius: 999px;
				color: var(--aster-accent);
				font-size: 11px;
				font-weight: 700;
				padding: 5px 9px;
			}

			.aster-empty-state {
				background: rgba(255, 255, 255, 0.7);
				border: 1px dashed rgba(23, 49, 58, 0.16);
				border-radius: 16px;
				padding: 20px;
				text-align: center;
			}

			.aster-empty-state__title {
				font-size: 16px;
				font-weight: 700;
				margin-bottom: 6px;
			}

			.aster-empty-state__text {
				color: var(--aster-ink-soft);
				font-size: 13px;
			}

			.aster-capacity-shell.is-loading {
				opacity: 0.72;
				pointer-events: none;
			}

			body.aster-is-dragging,
			body.aster-is-dragging * {
				cursor: grabbing !important;
			}

			@media (max-width: 1100px) {
				.aster-capacity-metrics,
				.aster-capacity-grid {
					grid-template-columns: 1fr;
				}

				.aster-task-type-summary__row {
					grid-template-columns: minmax(0, 1.6fr) repeat(2, minmax(100px, 1fr));
				}

				.aster-board-toolbar {
					grid-template-columns: 1fr;
				}

				.aster-board-toolbar__title,
				.aster-board-toolbar__hint {
					text-align: left;
				}
			}

			@media (max-width: 768px) {
				.aster-capacity-metrics {
					grid-template-columns: 1fr 1fr;
				}

				.aster-task-type-summary__row,
				.aster-task-type-summary__row.is-head {
					grid-template-columns: 1fr;
				}

				.aster-week-board__scroll {
					overflow: auto;
				}

				.aster-week-board__body,
				.aster-week-board__header {
					min-width: 980px;
				}

				.aster-capacity-note__period {
					margin-left: 0;
					width: 100%;
				}
			}
		</style>`).appendTo(document.head);
	}
};
