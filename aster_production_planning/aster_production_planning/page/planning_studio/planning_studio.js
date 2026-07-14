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
		this.horizon_mode = "two_weeks";
		this.focus_date = moment();
		this.horizon_start_date = null;
		this.horizon_end_date = null;
		this.calendar_view_mode = "production";
		this.header_collapsed = this.load_header_collapsed_preference();
		this.horizon_controls = {};
		this.suppress_horizon_control_change = false;
		this.request_id = 0;
		this.overview_request_id = 0;
		this.detail_request_id = 0;
		this.drag_card_name = null;
		this.card_resize_interaction = null;
		this.assignment_interaction = null;
		this.card_create_interaction = null;
		this.active_card_name = null;
		this.card_detail = null;
		this.active_week = null;
		this.active_overview_info_week = null;
		this.day_width = 64;
		this.horizon_days = [];
		this.horizon_segments = null;
		this.open_filter_picker = null;
		this.filter_request_ids = {};
		this.filter_search = {
			projects: "",
			task_types: "",
			operations: "",
		};
		this.filter_options = {
			projects: [],
			task_types: [],
			operations: [],
		};
		this.filter_values = {
			projects: [],
			task_types: [],
			operations: [],
		};
		this.filter_drafts = {
			projects: [],
			task_types: [],
			operations: [],
		};
		this.filter_label_cache = {
			projects: {},
			task_types: {},
			operations: {},
		};
		this.state = {
			planning_cards: [],
			summary: {},
			capacity_by_employee: [],
			daily_capacity: [],
			daily_absences: [],
			absences: [],
			planning_settings: {
				default_hours_per_employee_per_day: 8,
				default_hours_per_day_without_employees: 8,
				show_task_type_icon_in_production_cards: 1,
				show_leave_type_in_planning_studio: 1,
				show_absences_in_planning_card_calendar: 1,
			},
		};
		this.overview_state = {
			planning_cards: [],
			capacity_by_employee: [],
			daily_capacity: [],
		};

		this.make_page();
		this.make_layout();
		this.make_horizon_controls();
		this.make_filters();
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

		const $main = $(this.page.main);
		$main.addClass("aster-planning-studio-page");
		$main.closest(".layout-main-section-wrapper").addClass("aster-planning-studio-section-wrapper");
		$main.closest(".layout-main").addClass("aster-planning-studio-layout");
		$main.closest(".page-container").addClass("aster-planning-studio-container");
	}

	make_filters() {
			this.filter_definitions = {
				projects: {
					label: __("Projects"),
					placeholder: __("All projects"),
					get_data: (txt) =>
						frappe.xcall(
							"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.search_project_filter_options",
							{ txt }
						),
				},
			task_types: {
				label: __("Task Types"),
				placeholder: __("All task types"),
				get_data: (txt) =>
					frappe.db.get_link_options(
						"Task Type",
						txt,
						this.get_production_planning_task_type_query().filters || {}
					),
			},
			operations: {
				label: __("Operations"),
				placeholder: __("All operations"),
				get_data: (txt) => frappe.db.get_link_options("Operation", txt),
			},
		};

		this.render_filter_pickers();
	}

	make_layout() {
		this.$layout = $(`
			<div class="aster-studio">
				<div class="aster-studio__sticky-head">
					<div class="aster-studio__hero">
						<div class="aster-studio__hero-copy">
							<h2>${__("Planning Studio")}</h2>
							<div class="aster-studio__horizon-controls">
								<div class="aster-studio__horizon-dates">
									<div class="aster-studio__horizon-field" data-field="horizon_from"></div>
									<div class="aster-studio__horizon-field" data-field="horizon_to"></div>
								</div>
								<div class="aster-studio__horizon-actions">
										<div class="aster-studio__mode-switch">
											<button type="button" class="btn btn-default btn-sm aster-studio-mode" data-mode="two_weeks">${__("2 Weeks")}</button>
											<button type="button" class="btn btn-default btn-sm aster-studio-mode" data-mode="month">${__("Month")}</button>
											<button type="button" class="btn btn-default btn-sm aster-studio-mode" data-mode="quarter">${__("Quarter")}</button>
										</div>
									<div class="aster-studio__nav">
										<button
											type="button"
											class="btn btn-default btn-sm aster-studio-period-nav aster-studio-period-nav--arrow"
											data-shift="-1"
											title="${__("Prev")}"
											aria-label="${__("Prev")}"
										>←</button>
										<button type="button" class="btn btn-default btn-sm aster-studio-period-nav" data-action="today">${__("Today")}</button>
										<button
											type="button"
											class="btn btn-default btn-sm aster-studio-period-nav aster-studio-period-nav--arrow"
											data-shift="1"
											title="${__("Next")}"
											aria-label="${__("Next")}"
										>→</button>
									</div>
								</div>
							</div>
						</div>
						<div class="aster-studio__hero-toggle-wrap">
							<button
								type="button"
								class="btn btn-default btn-sm aster-studio__sticky-toggle"
								aria-expanded="true"
								title="${__("Collapse header")}"
								aria-label="${__("Collapse header")}"
							>${frappe.utils.icon("small-up", "sm")}</button>
						</div>
					</div>

					<div class="aster-studio__metrics">
						<div class="aster-studio__metric" data-metric="planned_hours"></div>
						<div class="aster-studio__metric" data-metric="capacity_hours"></div>
						<div class="aster-studio__metric" data-metric="available_hours"></div>
					</div>
				</div>
				<div class="aster-studio__task-type-summary"></div>

				<div class="aster-studio__stack">
					<section class="aster-studio__panel aster-studio__overview-panel">
						<div class="aster-studio__panel-head">
							<div>
								<h3>${__("Yearly Overview")}</h3>
							</div>
							<div class="aster-studio__panel-actions">
								<button type="button" class="btn btn-default btn-sm aster-studio-refresh">${__("Refresh")}</button>
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
							<div class="aster-studio__panel-actions">
								<div class="aster-studio__view-switch">
									<button type="button" class="btn btn-default btn-sm aster-studio-view-mode" data-view-mode="production">${__("Produktionsansicht")}</button>
									<button type="button" class="btn btn-default btn-sm aster-studio-view-mode" data-view-mode="site">${__("Baustellenansicht")}</button>
								</div>
							</div>
						</div>
						<div class="aster-studio__calendar-filters"></div>
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

		this.$sticky_head = this.$layout.find(".aster-studio__sticky-head");
		this.$sticky_toggle = this.$layout.find(".aster-studio__sticky-toggle");
		this.$overview_range = this.$layout.find(".aster-studio__overview-range");
		this.$overview = this.$layout.find(".aster-studio__overview");
		this.$calendar_filters = this.$layout.find(".aster-studio__calendar-filters");
		this.$horizon = this.$layout.find(".aster-studio__horizon");
		this.$employee_list = this.$layout.find(".aster-studio__employee-list");
		this.$activity_list = this.$layout.find(".aster-studio__activity-list");
		this.$task_type_summary = this.$layout.find(".aster-studio__task-type-summary");
		this.$drawer = this.$layout.find(".aster-studio-drawer");
		this.$drawer_content = this.$layout.find(".aster-studio-drawer__content");
		this.set_header_collapsed(this.header_collapsed, { persist: false });
	}

	make_horizon_controls() {
		this.horizon_controls.from = this.make_horizon_date_control("horizon_from", __("Von"));
		this.horizon_controls.to = this.make_horizon_date_control("horizon_to", __("Bis"));
		this.apply_horizon_preset(this.horizon_mode, this.focus_date, { refresh: false });
	}

	make_horizon_date_control(fieldname, label) {
		const control = frappe.ui.form.make_control({
			parent: this.$layout.find(`[data-field="${fieldname}"]`).get(0),
			df: {
				fieldname,
				fieldtype: "Date",
				label,
				options: {
					dateFormat: "dd.mm.yyyy",
				},
			},
			render_input: true,
		});

		control.refresh();
		control.parse = (value) => {
			if (!value) {
				return value;
			}

			const parsed = this.parse_user_date(value);
			return parsed ? parsed.format("YYYY-MM-DD") : String(value).trim();
		};
		control.validate = (value) => {
			if (!value) {
				return value;
			}

			const parsed = this.parse_user_date(value);
			if (!parsed) {
				frappe.msgprint(__("Date {0} must be in format: {1}", [value, "dd.mm.yyyy"]));
				return "";
			}

			return parsed.format("YYYY-MM-DD");
		};
		control.format_for_input = (value) => this.format_horizon_date(value);
		control.$input?.on("change", () => this.handle_horizon_control_change());
		return control;
	}

	get_header_collapsed_storage_key() {
		return "aster_planning_studio_header_collapsed";
	}

	load_header_collapsed_preference() {
		try {
			return JSON.parse(localStorage.getItem(this.get_header_collapsed_storage_key()) || "false");
		} catch (error) {
			return false;
		}
	}

	set_header_collapsed(collapsed, { persist = true } = {}) {
		this.header_collapsed = !!collapsed;
		this.$sticky_head?.toggleClass("is-collapsed", this.header_collapsed);
		if (this.header_collapsed) {
			this.close_filter_picker();
		}

		const title = this.header_collapsed ? __("Expand header") : __("Collapse header");
		const icon = this.header_collapsed ? "small-down" : "small-up";
		this.$sticky_toggle
			.attr("title", title)
			.attr("aria-label", title)
			.attr("aria-expanded", this.header_collapsed ? "false" : "true")
			.html(frappe.utils.icon(icon, "sm"));

		if (persist) {
			localStorage.setItem(
				this.get_header_collapsed_storage_key(),
				JSON.stringify(this.header_collapsed)
			);
		}
	}

	toggle_header_collapsed() {
		this.set_header_collapsed(!this.header_collapsed);
	}

	render_filter_pickers() {
		if (!this.$calendar_filters?.length) {
			return;
		}

		this.$calendar_filters.html(
			Object.keys(this.filter_definitions)
				.map((filter_name) => this.get_filter_picker_markup(filter_name))
				.join("")
		);
	}

	get_filter_picker_markup(filter_name) {
		const definition = this.filter_definitions[filter_name];
		const applied_values = this.get_filter_values(filter_name);
		const selected_count = applied_values.length;
		const is_open = this.open_filter_picker === filter_name;
		const summary = this.get_filter_summary(filter_name, applied_values);
		const draft_values = is_open ? this.get_filter_draft_values(filter_name) : applied_values;
		const search_text = this.filter_search[filter_name] || "";
		const options = this.filter_options[filter_name] || [];

		return `
			<div class="aster-filter-picker ${is_open ? "is-open" : ""}" data-filter="${frappe.utils.escape_html(filter_name)}">
				<div class="aster-filter-picker__label">${frappe.utils.escape_html(definition.label)}</div>
				<button
					type="button"
					class="aster-filter-picker__trigger"
					aria-haspopup="true"
					aria-expanded="${is_open ? "true" : "false"}"
				>
					<span class="aster-filter-picker__trigger-text">${frappe.utils.escape_html(summary || definition.placeholder)}</span>
					<span class="aster-filter-picker__trigger-meta">
						${selected_count ? `<span class="aster-filter-picker__count">${selected_count}</span>` : ""}
						<span class="aster-filter-picker__caret">${frappe.utils.icon(is_open ? "chevron-up" : "chevron-down", "xs")}</span>
					</span>
				</button>
				<div class="aster-filter-picker__menu" aria-hidden="${is_open ? "false" : "true"}">
					<div class="aster-filter-picker__search">
						<input
							type="text"
							class="form-control input-xs aster-filter-picker__search-input"
							placeholder="${__("Search")}"
							value="${frappe.utils.escape_html(search_text)}"
						/>
					</div>
					<div class="aster-filter-picker__options">
						${
							options.length
								? options
										.map((option) => {
											const is_checked = draft_values.includes(option.value);
											return `
												<label class="aster-filter-picker__option">
													<input
														type="checkbox"
														class="aster-filter-picker__checkbox"
														value="${frappe.utils.escape_html(option.value)}"
														${is_checked ? "checked" : ""}
													/>
													<span>${frappe.utils.escape_html(option.label || option.value)}</span>
												</label>
											`;
										})
										.join("")
								: `<div class="aster-filter-picker__empty">${__("No options found")}</div>`
						}
					</div>
					<div class="aster-filter-picker__actions">
						<button type="button" class="btn btn-default btn-xs aster-filter-picker__reset">${__("Zurücksetzen")}</button>
						<button type="button" class="btn btn-primary btn-xs aster-filter-picker__apply">${__("Fertig")}</button>
					</div>
				</div>
			</div>
		`;
	}

	get_filter_values(filter_name) {
		return Array.isArray(this.filter_values[filter_name]) ? this.filter_values[filter_name] : [];
	}

	get_filter_draft_values(filter_name) {
		return Array.isArray(this.filter_drafts[filter_name]) ? this.filter_drafts[filter_name] : [];
	}

	get_filter_summary(filter_name, values) {
		const definition = this.filter_definitions[filter_name];
		if (!values?.length) {
			return definition?.placeholder || "";
		}

		const labels = values
			.map((value) => this.filter_label_cache[filter_name]?.[value] || value)
			.filter(Boolean);

		if (labels.length <= 2) {
			return labels.join(", ");
		}

		return labels.slice(0, 2).join(", ");
	}

	process_filter_options(filter_name, options) {
		const processed = (options || []).map((option) => {
			if (typeof option === "string") {
				return {
					label: option,
					value: option,
				};
			}
			return {
				label: option.label || option.value,
				value: option.value || option.label,
			};
		});

		const selected_options = this.get_filter_draft_values(filter_name).map((value) => ({
			value,
			label: this.filter_label_cache[filter_name]?.[value] || value,
		}));

		const merged = [...selected_options, ...processed].filter((option) => option.value);
		const unique = [];
		const seen = new Set();
		merged.forEach((option) => {
			if (seen.has(option.value)) {
				return;
			}
			seen.add(option.value);
			this.filter_label_cache[filter_name][option.value] = option.label || option.value;
			unique.push(option);
		});
		return unique;
	}

	load_filter_options(filter_name, search_text = "") {
		const definition = this.filter_definitions[filter_name];
		if (!definition?.get_data) {
			this.filter_options[filter_name] = [];
			this.render_filter_pickers();
			return Promise.resolve();
		}

		const request_id = (this.filter_request_ids[filter_name] || 0) + 1;
		this.filter_request_ids[filter_name] = request_id;

		return Promise.resolve(definition.get_data(search_text)).then((options) => {
			if (this.filter_request_ids[filter_name] !== request_id) {
				return;
			}
			this.filter_options[filter_name] = this.process_filter_options(filter_name, options);
			this.sync_filter_picker(filter_name);
		});
	}

	sync_filter_picker(filter_name) {
		const widget = this.$layout.find(`.aster-filter-picker[data-filter="${filter_name}"]`);
		if (!widget.length) {
			this.render_filter_pickers();
			return;
		}

		const is_open = this.open_filter_picker === filter_name;
		const applied_values = this.get_filter_values(filter_name);
		const draft_values = is_open ? this.get_filter_draft_values(filter_name) : applied_values;
		const summary = this.get_filter_summary(filter_name, applied_values);
		const selected_count = applied_values.length;
		const definition = this.filter_definitions[filter_name];
		const options = this.filter_options[filter_name] || [];

		widget.toggleClass("is-open", is_open);
		widget.find(".aster-filter-picker__trigger").attr("aria-expanded", is_open ? "true" : "false");
		widget.find(".aster-filter-picker__menu").attr("aria-hidden", is_open ? "false" : "true");
		widget
			.find(".aster-filter-picker__trigger-text")
			.text(summary || definition.placeholder || "");
		widget
			.find(".aster-filter-picker__caret")
			.html(frappe.utils.icon(is_open ? "chevron-up" : "chevron-down", "xs"));

		const options_markup = options.length
			? options
					.map((option) => {
						const is_checked = draft_values.includes(option.value);
						return `
							<label class="aster-filter-picker__option">
								<input
									type="checkbox"
									class="aster-filter-picker__checkbox"
									value="${frappe.utils.escape_html(option.value)}"
									${is_checked ? "checked" : ""}
								/>
								<span>${frappe.utils.escape_html(option.label || option.value)}</span>
							</label>
						`;
					})
					.join("")
			: `<div class="aster-filter-picker__empty">${__("No options found")}</div>`;
		widget.find(".aster-filter-picker__options").html(options_markup);
		widget.find(".aster-filter-picker__search-input").val(this.filter_search[filter_name] || "");

		const count = widget.find(".aster-filter-picker__count");
		if (selected_count) {
			if (count.length) {
				count.text(selected_count);
			} else {
				widget
					.find(".aster-filter-picker__trigger-meta")
					.prepend(`<span class="aster-filter-picker__count">${selected_count}</span>`);
			}
		} else {
			count.remove();
		}
	}

	toggle_filter_picker(filter_name) {
		if (this.open_filter_picker === filter_name) {
			this.close_filter_picker();
			return;
		}

		this.open_filter_picker = filter_name;
		this.filter_drafts[filter_name] = [...this.get_filter_values(filter_name)];
		this.filter_search[filter_name] = "";
		this.render_filter_pickers();
		this.load_filter_options(filter_name, "").then(() => {
			this.$layout.find(`.aster-filter-picker[data-filter="${filter_name}"] .aster-filter-picker__search-input`).trigger("focus");
		});
	}

	close_filter_picker() {
		if (!this.open_filter_picker) {
			return;
		}

		const filter_name = this.open_filter_picker;
		this.filter_drafts[filter_name] = [...this.get_filter_values(filter_name)];
		this.filter_search[filter_name] = "";
		this.open_filter_picker = null;
		this.render_filter_pickers();
	}

	apply_filter_picker(filter_name) {
		this.filter_values[filter_name] = [...this.get_filter_draft_values(filter_name)];
		this.open_filter_picker = null;
		this.filter_search[filter_name] = "";
		this.render_filter_pickers();
		this.refresh();
	}

	reset_filter_picker(filter_name) {
		this.filter_drafts[filter_name] = [];
		this.filter_search[filter_name] = "";
		this.load_filter_options(filter_name, "");
	}

	toggle_filter_draft_value(filter_name, value, is_checked) {
		const next_values = [...this.get_filter_draft_values(filter_name)];
		if (is_checked) {
			if (!next_values.includes(value)) {
				next_values.push(value);
			}
		} else {
			const index = next_values.indexOf(value);
			if (index > -1) {
				next_values.splice(index, 1);
			}
		}
		this.filter_drafts[filter_name] = next_values;
		this.sync_filter_picker(filter_name);
	}

	bind_actions() {
		this.page.set_primary_action(__("New Planning Card"), () => {
			this.open_create_dialog(this.get_horizon_window().start.clone().hour(8).minute(0).second(0));
		});

		this.page.clear_secondary_action();
		this.page.clear_menu();
		this.page.add_menu_item(__("Planning Settings"), () => frappe.set_route("planning-setup"));

		this.$layout.on("click", ".aster-studio-refresh", () => this.refresh());
		this.$layout.on("click", ".aster-studio__sticky-toggle", () => this.toggle_header_collapsed());
		this.$layout.on("click", ".aster-filter-picker__trigger", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const filter_name = $(event.currentTarget).closest(".aster-filter-picker").data("filter");
			if (filter_name) {
				this.toggle_filter_picker(filter_name);
			}
		});
		this.$layout.on("click", ".aster-filter-picker__menu", (event) => {
			event.stopPropagation();
		});
		this.$layout.on(
			"input",
			".aster-filter-picker__search-input",
			frappe.utils.debounce((event) => {
				const $input = $(event.currentTarget);
				const filter_name = $input.closest(".aster-filter-picker").data("filter");
				if (!filter_name) {
					return;
				}
				this.filter_search[filter_name] = $input.val() || "";
				this.load_filter_options(filter_name, this.filter_search[filter_name]);
			}, 200)
		);
		this.$layout.on("change", ".aster-filter-picker__checkbox", (event) => {
			const $checkbox = $(event.currentTarget);
			const filter_name = $checkbox.closest(".aster-filter-picker").data("filter");
			if (!filter_name) {
				return;
			}
			this.toggle_filter_draft_value(filter_name, $checkbox.val(), $checkbox.is(":checked"));
		});
		this.$layout.on("click", ".aster-filter-picker__reset", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const filter_name = $(event.currentTarget).closest(".aster-filter-picker").data("filter");
			if (filter_name) {
				this.reset_filter_picker(filter_name);
			}
		});
		this.$layout.on("click", ".aster-filter-picker__apply", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const filter_name = $(event.currentTarget).closest(".aster-filter-picker").data("filter");
			if (filter_name) {
				this.apply_filter_picker(filter_name);
			}
		});
		this.$layout.on("keydown", ".aster-filter-picker", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.close_filter_picker();
			}
		});

		this.$layout.on("click", ".aster-studio-week-pill", (event) => {
			const $pill = $(event.currentTarget);
			if (!cint($pill.data("selectable"))) {
				return;
			}
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

		this.$layout.on("click", ".aster-studio-week-pill__info", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const $button = $(event.currentTarget);
			const weekStart = $button.data("weekStart");
			this.active_overview_info_week =
				this.active_overview_info_week === weekStart ? null : weekStart;
			this.render_overview();
		});

		this.$layout.on("mouseenter", ".aster-studio-week-pill", (event) => {
			this.show_overview_hovercard(event.currentTarget);
		});

		this.$layout.on("mouseleave", ".aster-studio-week-pill", () => {
			this.hide_overview_hovercard();
		});

		this.$layout.on("focusin", ".aster-studio-week-pill", (event) => {
			this.show_overview_hovercard(event.currentTarget);
		});

		this.$layout.on("focusout", ".aster-studio-week-pill", () => {
			this.hide_overview_hovercard();
		});

		this.$layout.on("mouseenter", ".aster-studio-card", (event) => {
			this.show_card_hovercard(event.currentTarget);
		});

		this.$layout.on("mouseleave", ".aster-studio-card", () => {
			this.hide_card_hovercard();
		});

		this.$layout.on("dragstart", ".aster-studio-card", () => {
			this.hide_card_hovercard();
		});

		this.$layout.on("mousedown", ".aster-studio-card", () => {
			this.hide_card_hovercard();
		});

		this.$layout.on("scroll", ".aster-studio-horizon", () => {
			this.hide_card_hovercard();
		});

		$(document.body)
			.off("toggleFullWidth.asterPlanningStudio")
			.on("toggleFullWidth.asterPlanningStudio", () => {
				requestAnimationFrame(() => {
					this.render_overview();
					this.render_horizon();
				});
			});

		$(window)
			.off("resize.asterPlanningStudio")
			.on(
				"resize.asterPlanningStudio",
				frappe.utils.debounce(() => {
					this.render_overview();
					this.render_horizon();
				}, 120)
			);

		this.$layout.on("click", ".aster-studio-mode", (event) => {
			const mode = $(event.currentTarget).data("mode");
			if (mode) {
				this.apply_horizon_preset(mode);
			}
		});

		this.$layout.on("click", ".aster-studio-view-mode", (event) => {
			const viewMode = $(event.currentTarget).data("viewMode");
			if (viewMode) {
				this.set_calendar_view_mode(viewMode);
			}
		});

		this.$layout.on("click", ".aster-studio-period-nav", (event) => {
			const $button = $(event.currentTarget);
			if ($button.data("action") === "today") {
				this.apply_horizon_preset(this.horizon_mode, moment());
			} else {
				const shiftConfig = this.get_horizon_shift_config();
				this.apply_horizon_preset(
					this.horizon_mode,
					this.focus_date
						.clone()
						.add(cint($button.data("shift") || 0) * shiftConfig.amount, shiftConfig.unit)
				);
			}
		});

		this.$layout.on("click", ".aster-studio-day__create", (event) => {
			const date = $(event.currentTarget).closest(".aster-studio-horizon-cell").data("date");
			if (date) {
				this.open_create_dialog(moment(date).hour(8).minute(0).second(0));
			}
		});

		this.$layout.on("mousedown", ".aster-studio-horizon-cell", (event) => {
			if ($(event.target).closest(".aster-studio-day__create").length) {
				return;
			}
			this.start_card_create_interaction(event);
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
			this.handle_card_create_interaction_move(event);
			this.handle_card_resize_interaction_move(event);
			this.handle_assignment_interaction_move(event);
		});
		$(document).on("mouseup.asterPlanningStudio", () => {
			this.finish_card_create_interaction();
			this.finish_card_resize_interaction();
			this.finish_assignment_interaction();
		});
		$(document).on("mousedown.asterPlanningStudio", (event) => {
			if (!$(event.target).closest(".aster-filter-picker").length) {
				this.close_filter_picker();
			}
		});
	}

	refresh() {
		const request_id = ++this.request_id;
		const horizon_window = this.get_horizon_window();
		const overview_request_id = ++this.overview_request_id;
		const overview_window = this.get_overview_data_window();

		this.set_loading(true);
		this.update_labels(horizon_window);
		this.update_mode_buttons();

		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.get_planning_dashboard_data",
				args: {
					start_date: this.to_system_datetime(horizon_window.start),
					end_date: this.to_system_datetime(horizon_window.end),
					projects: this.get_selected_projects(),
					task_types: this.get_selected_task_types(),
					operations: this.get_selected_operations(),
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

		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.get_planning_dashboard_data",
			args: {
				start_date: this.to_system_datetime(overview_window.start),
				end_date: this.to_system_datetime(overview_window.end),
				projects: this.get_selected_projects(),
				task_types: this.get_selected_task_types(),
				operations: this.get_selected_operations(),
			},
			callback: (response) => {
				if (overview_request_id !== this.overview_request_id) {
					return;
				}

				const message = response.message || {};
				this.overview_state = {
					planning_cards: message.planning_cards || [],
					capacity_by_employee: message.capacity_by_employee || [],
					daily_capacity: message.daily_capacity || [],
				};
				this.render_overview();
			},
		});
	}

	update_labels(horizon_window) {
		const helper_label =
			this.horizon_mode === "quarter"
				? __("Quarter helper")
				: this.horizon_mode === "two_weeks"
					? __("2-week helper")
					: __("Month helper");
		this.$overview_range.text(
			`${__("Year overview")}: ${this.get_overview_year()} · ${helper_label}: ${
				this.horizon_mode === "quarter"
					? this.focus_date.format("[Q]Q YYYY")
					: this.horizon_mode === "two_weeks"
						? `${this.focus_date.clone().startOf("isoWeek").format("DD MMM YYYY")} - ${this.focus_date
								.clone()
								.startOf("isoWeek")
								.add(11, "days")
								.format("DD MMM YYYY")}`
						: this.focus_date.format("MMMM YYYY")
			}`
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
				.attr("data-meta", metric.meta || "")
				.attr("title", metric.meta || "")
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
		const weeks = this.build_overview_weeks();
		const monthSegments = this.get_overview_month_segments(weeks);
		const minVisibleBarHeight = 14;
		const maxVisualBarHeight = 148;
		const maxHoursAcrossYear = weeks.reduce((maxValue, week) => {
			return Math.max(
				maxValue,
				flt(week.capacity_hours || 0),
				flt(week.planned_hours || 0)
			);
		}, 0);
		if (
			this.active_week &&
			!weeks.some(
				(week) =>
					week.is_selectable &&
					week.start.format("YYYY-MM-DD") === this.active_week.start &&
					week.end.clone().subtract(1, "day").format("YYYY-MM-DD") === this.active_week.end
			)
		) {
			this.active_week = null;
		}
		this.$overview.html(`
			<div class="aster-studio-overview-wrap">
				<div class="aster-studio-overview-scroll">
					<div class="aster-studio-overview-track" style="--week-count:${Math.max(weeks.length, 1)}">
						<div class="aster-studio-overview aster-studio-overview--bars">
						${weeks
							.map((week, index) => {
								const weekStart = week.start.format("YYYY-MM-DD");
								const weekEnd = week.end.clone().subtract(1, "day").format("YYYY-MM-DD");
								const isActive =
									this.active_week &&
									this.active_week.start === weekStart &&
									this.active_week.end === weekEnd;
								const previousWeek = index > 0 ? weeks[index - 1] : null;
								const isMonthStart =
									!previousWeek ||
									!previousWeek.start.clone().add(3, "days").isSame(week.start.clone().add(3, "days"), "month");
								const projectLabels = [...new Set(
									week.cards
										.map((card) => card.project_display || card.project || "")
										.filter(Boolean)
								)];
								const plannedHours = flt(week.planned_hours || 0);
								const capacityHours = flt(week.capacity_hours || 0);
								const isEmptyWeek = plannedHours <= 0 && capacityHours <= 0;
								const overloaded = flt(week.available_hours || 0) < 0;
								const utilizationRatio = capacityHours > 0 ? plannedHours / capacityHours : plannedHours > 0 ? 2 : 0;
								const fillRatio = Math.min(utilizationRatio, 1);
								const fillColor = this.get_overview_fill_color(plannedHours, capacityHours);
								const weekMaxHours = Math.max(plannedHours, capacityHours, 0);
								const totalHeightRatio = maxHoursAcrossYear > 0 ? weekMaxHours / maxHoursAcrossYear : 0;
								const totalBarHeightPx =
									weekMaxHours > 0
										? Math.round(
											minVisibleBarHeight +
											totalHeightRatio * (maxVisualBarHeight - minVisibleBarHeight)
										)
										: 10;
								const capacityHeightPx =
									capacityHours > 0 && maxHoursAcrossYear > 0
										? Math.round(
											minVisibleBarHeight +
											(capacityHours / maxHoursAcrossYear) *
												(maxVisualBarHeight - minVisibleBarHeight)
										)
										: 0;
								const shellHeightPx =
									capacityHours > 0
										? capacityHeightPx
										: plannedHours > 0
											? totalBarHeightPx
											: 10;
								const plannedFillPercent =
									plannedHours > 0
										? Math.max(Math.min(fillRatio * 100, 100), 6)
										: 0;
								const capacityTrackPercent = capacityHours > 0 ? 100 : 0;
								const hasOverflowSegment = overloaded && capacityHours > 0;
								const overflowHeightPx = hasOverflowSegment
									? Math.max(totalBarHeightPx - shellHeightPx, 6)
									: 0;
								const tooltipProjects = projectLabels.length
									? projectLabels
											.map(
												(label) =>
													`<div class="aster-studio-week-pill__tooltip-project">${frappe.utils.escape_html(label)}</div>`
											)
											.join("")
									: `<div class="aster-studio-week-pill__tooltip-empty">${__("No projects planned")}</div>`;

								return `
									<div
										class="aster-studio-week-pill ${isActive ? "is-active" : ""} ${week.is_selectable ? "is-selectable" : "is-outside-horizon"} ${isMonthStart ? "is-month-start" : ""} ${isEmptyWeek ? "is-empty-week" : ""}"
										data-week-start="${weekStart}"
										data-week-end="${weekEnd}"
										data-selectable="${week.is_selectable ? 1 : 0}"
										aria-label="${frappe.utils.escape_html(__("Week {0}", [week.start.isoWeek()]))}"
									>
										<div class="aster-studio-week-pill__chart">
											<div class="aster-studio-week-pill__bar-stack" style="--bar-shell-height:${shellHeightPx}px;--planned-fill-color:${fillColor || "transparent"}">
												${
													hasOverflowSegment
														? `<div class="aster-studio-week-pill__bar-overflow" style="height:${overflowHeightPx}px"></div>`
														: ""
												}
												<div class="aster-studio-week-pill__bar-shell ${hasOverflowSegment ? "is-overloaded" : ""} ${capacityHours <= 0 ? "is-zero-capacity" : ""}" style="height:${shellHeightPx}px">
													<div class="aster-studio-week-pill__bar-capacity" style="height:${capacityTrackPercent}%"></div>
													${isEmptyWeek || capacityHours <= 0 || !hasOverflowSegment ? "" : `<div class="aster-studio-week-pill__bar-cap-marker"></div>`}
													<div class="aster-studio-week-pill__bar-planned" style="height:${plannedFillPercent}%"></div>
												</div>
											</div>
										</div>
										<div class="aster-studio-week-pill__week-label">${week.start.isoWeek()}</div>
										<div class="aster-studio-week-pill__tooltip-content" role="tooltip">
											<div class="aster-studio-week-pill__tooltip-title">${__("Week {0}", [week.start.isoWeek()])}</div>
											<div class="aster-studio-week-pill__tooltip-range">${week.start.format("DD.MM")} - ${week.end.clone().subtract(1, "day").format("DD.MM")}</div>
											<div class="aster-studio-week-pill__tooltip-stats">
												<div>${__("Planned {0}", [this.format_hours_with_unit(week.planned_hours)])}</div>
												<div>${__("Cap. {0}", [this.format_hours_with_unit(week.capacity_hours)])}</div>
												<div class="${week.available_hours < 0 ? "is-negative" : ""}">${__("Open {0}", [this.format_hours_with_unit(week.available_hours)])}</div>
											</div>
											<div class="aster-studio-week-pill__tooltip-projects">${tooltipProjects}</div>
										</div>
									</div>
								`;
							})
							.join("")}
						</div>
						<div class="aster-studio-overview aster-studio-overview--months">
							${monthSegments
								.map(
									(segment) => `
										<div
											class="aster-studio-overview__month"
											style="grid-column:${segment.column_start} / span ${segment.column_span}"
										>
											${frappe.utils.escape_html(segment.label)}
										</div>
									`
								)
								.join("")}
						</div>
					</div>
				</div>
				<div class="aster-studio-overview-hovercard" aria-hidden="true"></div>
			</div>
		`);
	}

	show_overview_hovercard(target) {
		const $target = $(target);
		const $wrap = this.$overview.find(".aster-studio-overview-wrap");
		const $card = $wrap.find(".aster-studio-overview-hovercard");
		const $content = $target.find(".aster-studio-week-pill__tooltip-content").first();
		if (!$wrap.length || !$card.length || !$content.length) {
			return;
		}

		$card.html($content.html()).addClass("is-visible").attr("aria-hidden", "false");
		this.position_overview_hovercard(target);
	}

	position_overview_hovercard(target) {
		const wrap = this.$overview.find(".aster-studio-overview-wrap").get(0);
		const card = this.$overview.find(".aster-studio-overview-hovercard").get(0);
		if (!wrap || !card || !target) {
			return;
		}

		const wrapRect = wrap.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const cardWidth = card.offsetWidth || 220;
		const rawCenter = targetRect.left - wrapRect.left + targetRect.width / 2;
		const left = Math.min(
			Math.max(rawCenter, cardWidth / 2 + 8),
			Math.max(wrapRect.width - cardWidth / 2 - 8, cardWidth / 2 + 8)
		);
		const top = Math.max(targetRect.top - wrapRect.top - 16, 0);

		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
	}

	hide_overview_hovercard() {
		const $card = this.$overview.find(".aster-studio-overview-hovercard");
		if (!$card.length) {
			return;
		}

		$card.removeClass("is-visible").attr("aria-hidden", "true").empty().attr("style", "");
	}

	show_card_hovercard(target) {
		if (
			!target ||
			this.drag_card_name ||
			this.card_resize_interaction ||
			this.assignment_interaction ||
			this.card_create_interaction
		) {
			return;
		}

		const $target = $(target);
		const cardData = this.get_card($target.data("name"));
		const $wrap = this.$horizon.find(".aster-studio-horizon__timeline");
		const $card = $wrap.find(".aster-studio-card-hovercard");
		if (!cardData || !$wrap.length || !$card.length) {
			return;
		}

		$card
			.html(this.get_card_hovercard_markup(cardData))
			.addClass("is-visible")
			.attr("aria-hidden", "false");
		this.position_card_hovercard(target);
	}

	position_card_hovercard(target) {
		const wrap = this.$horizon.find(".aster-studio-horizon__timeline").get(0);
		const card = this.$horizon.find(".aster-studio-card-hovercard").get(0);
		if (!wrap || !card || !target) {
			return;
		}

		const wrapRect = wrap.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const cardWidth = card.offsetWidth || 280;
		const rawCenter = targetRect.left - wrapRect.left + targetRect.width / 2;
		const left = Math.min(
			Math.max(rawCenter, cardWidth / 2 + 8),
			Math.max(wrapRect.width - cardWidth / 2 - 8, cardWidth / 2 + 8)
		);
		const top = targetRect.top - wrapRect.top - 14;

		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
	}

	hide_card_hovercard() {
		const $card = this.$horizon.find(".aster-studio-card-hovercard");
		if (!$card.length) {
			return;
		}

		$card.removeClass("is-visible").attr("aria-hidden", "true").empty().attr("style", "");
	}

	get_card_hovercard_markup(card) {
		const title = this.get_card_title(card);
		const subtitle = this.get_card_subtitle(card);
		const start = this.to_user_moment(card.start_date);
		const end = this.to_user_moment(card.end_date);
		const timeLabel = this.get_card_time_label(card);
		const note = (card?.note || "").trim();
		const detailRows = [
			{
				label: __("Period"),
				value:
					start.isValid() && end.isValid()
						? this.format_date_range(start, end)
						: [card?.start_date, card?.end_date].filter(Boolean).join(" - "),
			},
		];

		if (timeLabel) {
			detailRows.push({
				label: __("Time"),
				value: timeLabel,
			});
		}

		if (this.is_event_card(card)) {
			if (card?.event_type) {
				detailRows.push({
					label: __("Event Type"),
					value: card.event_type,
				});
			}
			if (card?.description) {
				detailRows.push({
					label: __("Description"),
					value: card.description,
				});
			}
		} else {
			const plannedEmployeeCount = this.get_card_planned_employee_count(
				card,
				card.assigned_employee_names || []
			);
			if (card?.task_type) {
				detailRows.push({
					label: __("Task Type"),
					value: card.task_type,
				});
			}
			if (card?.operation) {
				detailRows.push({
					label: __("Operation"),
					value: card.operation,
				});
			}
			if (card?.elementgruppe) {
				detailRows.push({
					label: __("Elementgruppe"),
					value: card.elementgruppe,
				});
			}
			if (flt(card?.required_hours || card?.duration_in_hours || 0) > 0) {
				detailRows.push({
					label: __("Required Hours"),
					value: this.format_hours_with_unit(card.required_hours || card.duration_in_hours),
				});
			}
			detailRows.push({
				label: __("Employees on Card"),
				value: String(plannedEmployeeCount),
			});
		}

		const detailMarkup = detailRows
			.filter((row) => row.value)
			.map(
				(row) =>
					`<div><strong>${frappe.utils.escape_html(row.label)}:</strong> ${frappe.utils.escape_html(row.value)}</div>`
			)
			.join("");

		return `
			<div class="aster-studio-week-pill__tooltip-title">${frappe.utils.escape_html(title)}</div>
			${
				subtitle
					? `<div class="aster-studio-week-pill__tooltip-range">${frappe.utils.escape_html(subtitle)}</div>`
					: ""
			}
			${detailMarkup ? `<div class="aster-studio-week-pill__tooltip-stats">${detailMarkup}</div>` : ""}
			${
				note
					? `<div class="aster-studio-week-pill__tooltip-projects">
							<div class="aster-studio-card-hovercard__note-label">${__("Notes")}</div>
							<div class="aster-studio-card-hovercard__note-text">${this.format_hovercard_text(note)}</div>
						</div>`
					: ""
			}
		`;
	}

	format_hovercard_text(value) {
		return frappe.utils.escape_html(value || "").replace(/\n/g, "<br>");
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
		const use_full_width = this.horizon_mode === "two_weeks";
		this.day_width = this.get_horizon_day_width(days, use_full_width);
		const dayColumns = this.get_horizon_day_columns(days, use_full_width);
		this.horizon_days = days;
		this.horizon_segments = segments;
		this.sync_calendar_view_mode_buttons();

		this.$horizon.html(`
			<div class="aster-studio-horizon aster-studio-horizon--continuous ${use_full_width ? "is-full-width" : ""}">
				<div
					class="aster-studio-horizon__timeline"
					style="--day-count:${Math.max(days.length, 1)}; --day-width:${this.day_width}px; --day-columns:${dayColumns}; --lane-count:${Math.max(segments.lane_count, 1)}; --lane-height:${segments.lane_height}px"
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
						<div class="aster-studio-horizon__create-preview" aria-hidden="true"></div>
					</div>
					<div class="aster-studio-card-hovercard" aria-hidden="true"></div>
				</div>
			</div>
		`);

		this.center_active_week_in_horizon();
		if (this.card_create_interaction) {
			this.apply_card_create_preview(this.card_create_interaction);
		}
	}

	get_horizon_day_width(days = [], use_full_width = false) {
		if (!use_full_width || !this.$horizon?.length) {
			return 64;
		}

		const horizonDays = Array.isArray(days) ? days : [];
		const container_width = Math.max(flt(this.$horizon.innerWidth() || 0) - 36, 0);
		if (!container_width || !horizonDays.length) {
			return 64;
		}

		const totalWidthUnits = horizonDays.reduce(
			(sum, day) => sum + this.get_horizon_day_width_unit(day.date),
			0
		);
		if (!totalWidthUnits) {
			return 64;
		}

		return Math.max(Math.floor(container_width / totalWidthUnits), 64);
	}

	get_horizon_day_width_unit(date) {
		return moment(date).isoWeekday() >= 6 ? 0.25 : 1;
	}

	get_horizon_units_between(startDate, endDate) {
		if (!startDate || !endDate) {
			return 0;
		}

		const rangeStart = moment(startDate).startOf("day");
		const rangeEnd = moment(endDate).startOf("day");
		if (rangeStart.isAfter(rangeEnd, "day")) {
			return 0;
		}

		let units = 0;
		const cursor = rangeStart.clone();
		while (!cursor.isAfter(rangeEnd, "day")) {
			units += this.get_horizon_day_width_unit(cursor);
			cursor.add(1, "day");
		}

		return units;
	}

	get_horizon_relative_span(visibleStart, visibleEnd, overlapStart, overlapEnd) {
		const totalUnits = Math.max(this.get_horizon_units_between(visibleStart, visibleEnd), 0.25);
		const leftUnits = overlapStart.isAfter(visibleStart, "day")
			? this.get_horizon_units_between(visibleStart, overlapStart.clone().subtract(1, "day"))
			: 0;
		const widthUnits = Math.max(this.get_horizon_units_between(overlapStart, overlapEnd), 0.25);

		return {
			left_percent: (leftUnits / totalUnits) * 100,
			width_percent: (widthUnits / totalUnits) * 100,
		};
	}

	get_horizon_day_columns(days = [], use_full_width = false) {
		const horizonDays = Array.isArray(days) ? days : [];
		if (!horizonDays.length) {
			return "minmax(64px, 64px)";
		}

		if (use_full_width) {
			return horizonDays
				.map((day) => (day.is_weekend ? "minmax(18px, 0.25fr)" : "minmax(64px, 1fr)"))
				.join(" ");
		}

		return horizonDays.map((day) => (day.is_weekend ? "16px" : "64px")).join(" ");
	}

	get_horizon_day_cells() {
		return this.$horizon.find(".aster-studio-horizon-cell").get();
	}

	get_horizon_day_cell(date) {
		if (!date) {
			return null;
		}

		const dateKey = moment.isMoment(date) ? date.format("YYYY-MM-DD") : cstr(date);
		return this.$horizon.find(`.aster-studio-horizon-cell[data-date="${dateKey}"]`).get(0) || null;
	}

	get_horizon_range_bounds(startDate, endDate) {
		const startCell = this.get_horizon_day_cell(startDate);
		const endCell = this.get_horizon_day_cell(endDate);
		if (!startCell || !endCell) {
			return null;
		}

		const left = startCell.offsetLeft;
		const right = endCell.offsetLeft + endCell.offsetWidth;
		return {
			left,
			width: Math.max(right - left, startCell.offsetWidth),
			start_width: startCell.offsetWidth,
			end_width: endCell.offsetWidth,
		};
	}

	build_horizon_days(horizon_window = this.get_horizon_window()) {
		const capacityByDay = this.get_daily_capacity_map();
		const absencesByDay = this.should_show_absences_in_planning_card_calendar()
			? this.get_daily_absence_map()
			: {};
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
		const all_daily_capacity = this.state.daily_capacity || [];
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
				return sum + this.get_planned_hours_in_window(week_start, week_end, card);
			}, 0);

			const capacity_hours = this.get_capacity_hours_in_range(week_start, week_end, all_daily_capacity);
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

	get_overview_year() {
		return (this.horizon_start_date || this.focus_date || moment()).clone().isoWeekYear();
	}

	get_overview_data_window() {
		const overviewYear = this.get_overview_year();
		const start = moment().isoWeekYear(overviewYear).isoWeek(1).startOf("isoWeek");
		const end = moment().isoWeekYear(overviewYear + 1).isoWeek(1).startOf("isoWeek");
		return { start, end };
	}

	is_week_in_horizon_window(weekStart, weekEnd, horizonWindow = this.get_horizon_window()) {
		return weekStart.isBefore(horizonWindow.end) && weekEnd.isAfter(horizonWindow.start);
	}

	build_overview_weeks() {
		const horizon_window = this.get_horizon_window();
		const overview_window = this.get_overview_data_window();
		const overviewSource =
			(this.overview_state?.planning_cards || []).length ||
			(this.overview_state?.capacity_by_employee || []).length ||
			(this.overview_state?.daily_capacity || []).length
				? this.overview_state
				: this.state;
		const all_cards = overviewSource.planning_cards || [];
		const all_daily_capacity = overviewSource.daily_capacity || [];
		const weeks = [];
		const overviewYear = this.get_overview_year();
		const yearStart = moment().isoWeekYear(overviewYear).isoWeek(1).startOf("isoWeek");
		const nextYearStart = moment().isoWeekYear(overviewYear + 1).isoWeek(1).startOf("isoWeek");
		let cursor = yearStart.clone();

		while (cursor.isBefore(nextYearStart)) {
			const week_start = cursor.clone();
			const week_end = cursor.clone().add(7, "days");
			const week_cards = all_cards.filter((card) => {
				const start = this.to_user_moment(card.start_date);
				const end = this.to_user_moment(card.end_date);
				return start.isBefore(week_end) && end.isAfter(week_start);
			});
			const planned_hours = week_cards.reduce((sum, card) => {
				return sum + this.get_planned_hours_in_window(week_start, week_end, card);
			}, 0);
			const is_selectable = this.is_week_in_horizon_window(week_start, week_end, horizon_window);
			const capacity_hours = this.get_capacity_hours_in_range(week_start, week_end, all_daily_capacity);

			weeks.push({
				start: week_start,
				end: week_end,
				cards: week_cards,
				planned_hours,
				capacity_hours,
				available_hours: flt(capacity_hours - planned_hours, 2),
				is_selectable,
			});
			cursor.add(7, "days");
		}

		return weeks;
	}

	get_capacity_hours_in_range(rangeStart, rangeEnd, dailyCapacityRows = []) {
		if (!rangeStart || !rangeEnd || !dailyCapacityRows.length) {
			return 0;
		}

		return flt(
			dailyCapacityRows.reduce((sum, row) => {
				const rowDate = moment(row.date, "YYYY-MM-DD");
				if (!rowDate.isValid()) {
					return sum;
				}

				return rowDate.isSameOrAfter(rangeStart, "day") && rowDate.isBefore(rangeEnd, "day")
					? sum + flt(row.capacity_hours)
					: sum;
			}, 0),
			2
		);
	}

	get_overview_month_segments(weeks = []) {
		const monthLabels = [
			__("Jan"),
			__("Feb"),
			__("Mär"),
			__("Apr"),
			__("Mai"),
			__("Jun"),
			__("Jul"),
			__("Aug"),
			__("Sep"),
			__("Okt"),
			__("Nov"),
			__("Dez"),
		];
		const segments = [];
		let currentSegment = null;

		weeks.forEach((week, index) => {
			const anchorDate = week.start.clone().add(3, "days");
			const monthIndex = anchorDate.month();
			const monthKey = `${anchorDate.year()}-${monthIndex}`;

			if (!currentSegment || currentSegment.key !== monthKey) {
				currentSegment = {
					key: monthKey,
					label: monthLabels[monthIndex] || anchorDate.format("MMM"),
					column_start: index + 1,
					column_span: 1,
				};
				segments.push(currentSegment);
				return;
			}

			currentSegment.column_span += 1;
		});

		return segments;
	}

	estimate_week_capacity(week_start, week_end, capacity_rows, horizon_window) {
		const total_horizon_capacity = capacity_rows.reduce((sum, item) => sum + flt(item.capacity_hours), 0);
		const total_days = Math.max(horizon_window.end.diff(horizon_window.start, "days"), 1);
		const week_days = Math.max(week_end.diff(week_start, "days"), 1);
		return flt((total_horizon_capacity / total_days) * week_days, 2);
	}

	set_calendar_view_mode(viewMode) {
		const nextMode = viewMode === "site" ? "site" : "production";
		if (this.calendar_view_mode === nextMode) {
			return;
		}

		this.calendar_view_mode = nextMode;
		this.sync_calendar_view_mode_buttons();
		this.render_horizon();
	}

	sync_calendar_view_mode_buttons() {
		this.$layout.find(".aster-studio-view-mode").each((_, button) => {
			const $button = $(button);
			$button.toggleClass("is-active", $button.data("viewMode") === this.calendar_view_mode);
		});
	}

	get_calendar_group_key(card) {
		if (this.calendar_view_mode === "site") {
			return (card?.project_display || card?.project || __("Ohne Baustelle")).trim();
		}

		return (card?.operation || card?.task_type || card?.elementgruppe || __("Ohne Arbeitsgang")).trim();
	}

	get_calendar_group_label(card) {
		return this.get_calendar_group_key(card);
	}

	sort_cards_for_calendar_view(cards = []) {
		return [...cards].sort((left, right) => {
			const leftGroup = this.get_calendar_group_label(left);
			const rightGroup = this.get_calendar_group_label(right);
			const groupCompare = leftGroup.localeCompare(rightGroup, undefined, { sensitivity: "base", numeric: true });
			if (groupCompare !== 0) {
				return groupCompare;
			}

			const leftStart = this.to_user_moment(left.start_date).valueOf();
			const rightStart = this.to_user_moment(right.start_date).valueOf();
			if (leftStart !== rightStart) {
				return leftStart - rightStart;
			}

			const leftDuration = this.to_user_moment(left.end_date).diff(this.to_user_moment(left.start_date), "days", true);
			const rightDuration = this.to_user_moment(right.end_date).diff(this.to_user_moment(right.start_date), "days", true);
			if (leftDuration !== rightDuration) {
				return rightDuration - leftDuration;
			}

			return this.get_card_title(left).localeCompare(this.get_card_title(right), undefined, {
				sensitivity: "base",
				numeric: true,
			});
		});
	}

	build_horizon_card_segments(horizon_window = this.get_horizon_window()) {
		const visibleCards = [...(this.state.planning_cards || [])]
			.filter((card) => {
				const start = this.to_user_moment(card.start_date);
				const end = this.to_user_moment(card.end_date);
				return start.isBefore(horizon_window.end) && end.isAfter(horizon_window.start);
			});
		const sortedCards = this.sort_cards_for_calendar_view(visibleCards);
		const groups = [];
		const groupsByKey = new Map();
		sortedCards.forEach((card) => {
			const groupKey = this.get_calendar_group_key(card);
			if (!groupsByKey.has(groupKey)) {
				groupsByKey.set(groupKey, {
					key: groupKey,
					label: this.get_calendar_group_label(card),
					cards: [],
				});
				groups.push(groupsByKey.get(groupKey));
			}
			groupsByKey.get(groupKey).cards.push(card);
		});

		let laneOffset = 0;
		let maxAssignmentRows = 1;
		const items = [];

		groups.forEach((group) => {
			const laneEnds = [];
			group.cards.forEach((card) => {
				const cardStart = this.to_user_moment(card.start_date);
				const cardEnd = this.to_user_moment(card.end_date);
				const segmentStart = moment.max(cardStart.clone().startOf("day"), horizon_window.start.clone());
				const segmentEnd = moment.min(cardEnd.clone().endOf("day"), horizon_window.end.clone().subtract(1, "second"));
				const startColumn = Math.max(segmentStart.diff(horizon_window.start, "days"), 0) + 1;
				const endColumn = Math.max(segmentEnd.diff(horizon_window.start, "days"), 0) + 1;

				let groupLaneIndex = 0;
				while (laneEnds[groupLaneIndex] !== undefined && laneEnds[groupLaneIndex] >= startColumn) {
					groupLaneIndex += 1;
				}
				laneEnds[groupLaneIndex] = endColumn;
				maxAssignmentRows = Math.max(maxAssignmentRows, Math.max((card.assigned_employees || []).length, 1));

				items.push({
					card,
					start_column: startColumn,
					end_column: Math.max(endColumn, startColumn),
					lane_index: laneOffset + groupLaneIndex,
					visible_start: segmentStart.clone().startOf("day"),
					visible_end: segmentEnd.clone().startOf("day"),
					group_key: group.key,
					group_label: group.label,
				});
			});

			laneOffset += Math.max(laneEnds.length, 1);
		});

		return {
			items,
			lane_count: Math.max(laneOffset, 1),
			lane_height: 24 + Math.min(maxAssignmentRows, 4) * 18,
		};
	}

	get_day_header_markup(day) {
		const weekdayLabels = [__("Mo"), __("Di"), __("Mi"), __("Do"), __("Fr"), __("Sa"), __("So")];
		const weekdayLabel = weekdayLabels[Math.max(day.date.isoWeekday() - 1, 0)] || day.date.format("dd");
		return `
			<div class="aster-studio-horizon__day-header ${day.is_weekend ? "is-weekend" : ""} ${day.is_today ? "is-today" : ""} ${day.is_active_week ? "is-active-week" : ""} ${day.has_absence ? "has-absence" : ""}">
				<div class="aster-studio-horizon__day-name">${weekdayLabel}</div>
				<div class="aster-studio-horizon__day-number">${day.date.format(day.is_weekend ? "DD" : "DD.MM")}</div>
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
		const titleLabel = this.get_card_title(card);
		const subtitleLabel = this.get_card_subtitle(card);
		const iconMarkup = this.get_card_icon_markup(card);
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
			>
				<span class="aster-studio-card__resize-handle aster-studio-card__resize-handle--start" title="${__("Adjust duration")}" aria-hidden="true"></span>
				<span class="aster-studio-card__resize-handle aster-studio-card__resize-handle--end" title="${__("Adjust duration")}" aria-hidden="true"></span>
				${weekHighlightMarkup}
				<div class="aster-studio-card__header">
					<div class="aster-studio-card__title">${iconMarkup}${frappe.utils.escape_html(titleLabel)}</div>
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

	should_show_absences_in_planning_card_calendar() {
		return cint(this.state.planning_settings?.show_absences_in_planning_card_calendar ?? 1) === 1;
	}

	get_card_markup(card) {
		return `
			<div
				class="aster-studio-card"
				data-name="${frappe.utils.escape_html(card.name)}"
				draggable="true"
				style="--card-color:${card.color || "#2f6f61"}"
			>
				<div class="aster-studio-card__title">${this.get_card_icon_markup(card)}${frappe.utils.escape_html(this.get_card_title(card))}</div>
				<div class="aster-studio-card__subtitle">${frappe.utils.escape_html(this.get_card_subtitle(card))}</div>
			</div>
		`;
	}

	get_card_type(card) {
		return (card?.card_type || "Produktion").trim() || "Produktion";
	}

	is_event_card(card) {
		return this.get_card_type(card) === "Event";
	}

	show_task_type_icon_on_production_cards() {
		return cint(this.state.planning_settings?.show_task_type_icon_in_production_cards ?? 1) === 1;
	}

	should_render_task_type_icon(card) {
		return !this.is_event_card(card) && this.show_task_type_icon_on_production_cards() && Boolean(card?.icon);
	}

	get_card_title(card) {
		return card?.project_display || card?.project || card?.name || __("Planning Card");
	}

	get_card_subtitle(card) {
		if (this.is_event_card(card)) {
			return [card?.description, this.get_card_time_label(card)]
				.filter(Boolean)
				.join(" ");
		}

		const productionDetails = [
			card?.elementgruppe,
			this.should_render_task_type_icon(card) ? null : card?.task_type,
			card?.operation,
			this.get_card_time_label(card),
		];

		return productionDetails
			.filter(Boolean)
			.join(" · ");
	}

	get_card_time_label(card) {
		const startTime = (card?.start_time || "").trim();
		const endTime = (card?.end_time || "").trim();
		if (!startTime && !endTime) {
			return "";
		}

		if (startTime && endTime) {
			return `${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}`;
		}
		if (startTime) {
			return startTime.slice(0, 5);
		}
		return endTime.slice(0, 5);
	}

	get_card_icon_markup(card) {
		if (!card?.icon) {
			return "";
		}

		if (!this.is_event_card(card) && !this.should_render_task_type_icon(card)) {
			return "";
		}

		return `<span class="aster-studio-card__icon">${frappe.utils.icon(card.icon, "sm")}</span>`;
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
		const showLeaveType = cint(this.state.planning_settings?.show_leave_type_in_planning_studio ?? 1);
		if (!items.length) {
			this.$activity_list.html(`<div class="aster-studio__empty">${__("No submitted absences in this horizon.")}</div>`);
			return;
		}

		this.$activity_list.html(`
			<div class="aster-studio__absence-table-card ${showLeaveType ? "" : "is-hide-leave-type"}">
				<div class="aster-studio__absence-table">
					<div class="aster-studio__absence-table-row is-head">
						<div>${__("Employee")}</div>
						${showLeaveType ? `<div>${__("Leave")}</div>` : ""}
						<div>${__("Period")}</div>
						<div>${__("Duration")}</div>
					</div>
					${items
						.map(
							(item) => `
								<div class="aster-studio__absence-table-row">
									<div class="aster-studio__absence-table-name">${frappe.utils.escape_html(item.employee_name || "")}</div>
									${showLeaveType ? `<div>${frappe.utils.escape_html(item.leave_type || __("Leave"))}</div>` : ""}
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

		this.close_card_detail();
		this.open_edit_dialog(card);
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
		const detailLabel = this.get_card_subtitle(card);
		this.$drawer_content.html(`
			<div class="aster-studio-drawer__head">
				<div>
					<div class="aster-studio-drawer__eyebrow">${__("Planning Card")}</div>
					<h3>${frappe.utils.escape_html(projectLabel || "")}</h3>
					<p>${frappe.utils.escape_html(detailLabel)}</p>
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
		const timeLabel = this.get_card_time_label(card);
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
					<p>${frappe.utils.escape_html(this.get_card_subtitle(card) || timeLabel || "")}</p>
				</div>
				<button type="button" class="aster-studio-drawer__close" aria-label="${__("Close")}">×</button>
			</div>

			<div class="aster-studio-drawer__summary">
				<div class="aster-studio-drawer__stat">
					<div class="aster-studio-drawer__stat-label">${__("Period")}</div>
					<div class="aster-studio-drawer__stat-value">${this.format_date_range(start, end)}</div>
				</div>
				${
					timeLabel
						? `<div class="aster-studio-drawer__stat">
								<div class="aster-studio-drawer__stat-label">${__("Time")}</div>
								<div class="aster-studio-drawer__stat-value">${frappe.utils.escape_html(timeLabel)}</div>
							</div>`
						: ""
				}
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
					<div class="aster-studio-drawer__stat-value">${this.format_hours_with_unit(
						card.hours_per_employee_per_day || this.get_default_total_daily_hours(this.get_card_planned_employee_count(card))
					)}</div>
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

		this.toggle_card_assignment_for_detail(this.card_detail, employee, () => {
			this.refresh();
			this.load_card_detail(this.card_detail.card.name);
		});
	}

	toggle_card_assignment_for_detail(cardDetail, employee, onSuccess) {
		if (!cardDetail?.card) {
			return;
		}

		const card = cardDetail.card;
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
					if (onSuccess) {
						onSuccess();
					}
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

	load_card_detail_into_dialog(dialog, name) {
		const requestId = `${name}:${Date.now()}`;
		dialog.__card_detail_request_id = requestId;
		this.render_card_dialog_employee_panel_loading(dialog);

		frappe.call({
			method:
				"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.get_planning_card_detail",
				args: {
					name,
					range_start: this.get_active_detail_range().start,
					range_end: this.get_active_detail_range().end,
				},
			callback: (response) => {
				if (dialog.__card_detail_request_id !== requestId) {
					return;
				}

				dialog.__card_detail = response.message || null;
				this.render_card_dialog_employee_panel(dialog);
			},
		});
	}

	render_card_dialog_employee_panel_loading(dialog) {
		const field = dialog.get_field("employee_availability_html");
		if (!field?.$wrapper) {
			return;
		}

		field.$wrapper.html(`
			<div class="aster-studio-dialog-panel">
				<div class="aster-studio-dialog-panel__loading">${__("Loading employee availability...")}</div>
			</div>
		`);
	}

	render_card_dialog_employee_panel(dialog) {
		const field = dialog.get_field("employee_availability_html");
		const detail = dialog.__card_detail;
		if (!field?.$wrapper || !detail?.card) {
			return;
		}

		const card = detail.card;
		const employees = detail.employees || [];
		const hasActiveWeek = Boolean(this.active_week?.start && this.active_week?.end);
		const assignmentHint = hasActiveWeek
			? __("Assignments from this popup are stored with this week as their From/To period.")
			: __("No week is active. Assignments will cover the full Planning Card period.");

		field.$wrapper.html(`
			<div class="aster-studio-dialog-panel">
				<div class="aster-studio-dialog-panel__head">
					<h4>${__("Available Employees")}</h4>
					<p>${assignmentHint}</p>
					<p>${__("Assignment buttons save immediately and refresh the planning card.")}</p>
				</div>
				<div class="aster-studio-dialog-panel__list">
					${
						employees.length
							? `
								<div class="aster-studio__dialog-capacity-table">
									<div class="aster-studio__dialog-capacity-row is-head">
										<div>${__("Employee")}</div>
										<div>${__("Adjusted Capacity")}</div>
										<div>${__("Planned Hours")}</div>
										<div>${__("Open Capacity")}</div>
										<div>${__("Action")}</div>
									</div>
									${employees.map((employee) => this.get_dialog_employee_markup(employee)).join("")}
								</div>
							`
							: `<div class="aster-studio__empty">${__("No employee capacity found for this period.")}</div>`
					}
				</div>
			</div>
		`);

		field.$wrapper
			.off("click.asterDialogAssign")
			.on("click.asterDialogAssign", ".aster-studio-employee__assign", (event) => {
				const employee = $(event.currentTarget).data("employee");
				if (!employee) {
					return;
				}

				this.toggle_card_assignment_for_detail(detail, employee, () => {
					this.refresh();
					this.load_card_detail_into_dialog(dialog, card.name);
				});
			});
	}

	get_dialog_employee_markup(employee) {
		const assignmentWindows = employee.card_assignment_windows || [];
		const plannedHours = flt(employee.assigned_hours || 0);
		const openCapacity = flt(employee.capacity_hours || 0) - plannedHours;
		const openCapacityClass = openCapacity < 0 ? "is-negative" : "";
		const assignStateClass = employee.is_assigned_to_card ? "is-remove" : "is-assign";
		const assignmentMarkup = assignmentWindows.length
			? assignmentWindows
					.map((row) => {
						const fromDate = row.from_date ? moment(row.from_date, "YYYY-MM-DD").format("DD.MM") : "–";
						const toDate = row.to_date ? moment(row.to_date, "YYYY-MM-DD").format("DD.MM") : "–";
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
			<div class="aster-studio__dialog-capacity-row ${employee.is_assigned_to_card ? "is-assigned" : ""}">
				<div class="aster-studio__dialog-capacity-name">
					<div class="aster-studio__capacity-table-name">${frappe.utils.escape_html(employee.employee_name || "")}</div>
					<div class="aster-studio__dialog-capacity-meta">
						<span>${employee.is_assigned_to_card ? __("Assigned in the current window") : __("Not assigned in the current window")}</span>
						<span>${__("{0} other planning cards", [cint(employee.assigned_project_count)])}</span>
					</div>
					<div class="aster-studio__dialog-capacity-badges">${assignmentMarkup}</div>
				</div>
				<div class="aster-studio__capacity-table-value">${this.format_hours_with_unit(employee.capacity_hours)}</div>
				<div class="aster-studio__capacity-table-value">${this.format_hours_with_unit(plannedHours)}</div>
				<div class="aster-studio__capacity-table-value ${openCapacityClass}">${this.format_hours_with_unit(openCapacity)}</div>
				<div class="aster-studio__dialog-capacity-action">
					<button
						type="button"
						class="btn btn-xs aster-studio-employee__assign ${assignStateClass}"
						data-employee="${frappe.utils.escape_html(employee.employee || "")}"
					>
						${assignLabel}
					</button>
				</div>
			</div>
		`;
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

	open_create_dialog(default_start, default_end = null) {
		this.open_card_dialog({ default_start, default_end });
	}

	open_edit_dialog(card) {
		this.open_card_dialog({ card });
	}

	get_default_employee_hours_per_day() {
		return flt(this.state.planning_settings?.default_hours_per_employee_per_day || 8, 2) || 8;
	}

	get_default_unassigned_hours_per_day() {
		return flt(this.state.planning_settings?.default_hours_per_day_without_employees || 8, 2) || 8;
	}

	get_default_total_daily_hours(plannedEmployeeCount) {
		const plannedCount = Math.max(cint(plannedEmployeeCount || 0), 0);
		if (plannedCount > 0) {
			return flt(plannedCount * this.get_default_employee_hours_per_day(), 2);
		}

		return flt(this.get_default_unassigned_hours_per_day(), 2);
	}

	parse_user_date(value) {
		if (!value) {
			return null;
		}

		if (moment.isMoment(value)) {
			return value.clone();
		}

		const parsed = moment(
			String(value).trim(),
			["DD.MM.YYYY", "D.M.YYYY", frappe.defaultDateFormat, "YYYY-MM-DD", frappe.defaultDatetimeFormat],
			true
		);
		if (parsed.isValid()) {
			return parsed;
		}

		const fallback = moment(value);
		return fallback.isValid() ? fallback : null;
	}

	format_horizon_date(value) {
		const parsed = this.parse_user_date(value);
		return parsed ? parsed.format("DD.MM.YYYY") : "";
	}

	normalize_time_value(value) {
		if (!value) {
			return null;
		}

		const normalized = String(value).trim();
		const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
		if (!match) {
			return normalized;
		}

		const hours = String(Math.max(cint(match[1]), 0)).padStart(2, "0");
		const minutes = match[2];
		const seconds = match[3] || "00";
		return `${hours}:${minutes}:${seconds}`;
	}

	normalize_link_field_value(value) {
		const normalized = (value || "").toString().trim();
		return normalized || "";
	}

	count_planning_days(startMoment, endMoment) {
		if (!startMoment || !endMoment) {
			return 0;
		}

		const cursor = startMoment.clone().startOf("day");
		const lastDay = endMoment.clone().startOf("day");
		if (cursor.isAfter(lastDay, "day")) {
			return 0;
		}

		const excludeWeekends = this.should_exclude_planning_weekends();
		let plannedDays = 0;
		while (!cursor.isAfter(lastDay, "day")) {
			if (!excludeWeekends || cursor.isoWeekday() < 6) {
				plannedDays += 1;
			}
			cursor.add(1, "day");
		}

		return plannedDays;
	}

	interpolate_hex_color(startHex, endHex, ratio) {
		const normalizedRatio = Math.max(Math.min(flt(ratio || 0), 1), 0);
		const parseHex = (hex) => {
			const normalized = String(hex || "").replace("#", "");
			return {
				r: parseInt(normalized.slice(0, 2), 16),
				g: parseInt(normalized.slice(2, 4), 16),
				b: parseInt(normalized.slice(4, 6), 16),
			};
		};
		const toHex = (value) => Math.round(value).toString(16).padStart(2, "0");
		const start = parseHex(startHex);
		const end = parseHex(endHex);

		return `#${toHex(start.r + (end.r - start.r) * normalizedRatio)}${toHex(start.g + (end.g - start.g) * normalizedRatio)}${toHex(start.b + (end.b - start.b) * normalizedRatio)}`;
	}

	get_overview_fill_color(plannedHours, capacityHours) {
		const planned = flt(plannedHours || 0);
		const capacity = flt(capacityHours || 0);
		if (planned <= 0) {
			return null;
		}

		if (capacity <= 0) {
			return "#d64b4b";
		}

		const utilizationRatio = planned / capacity;
		if (utilizationRatio > 1.1) {
			return "#d64b4b";
		}

		if (utilizationRatio > 1) {
			return "#f59e0b";
		}

		return this.interpolate_hex_color("#b9e7b7", "#1f8f3a", utilizationRatio);
	}

	get_last_planned_day_moment(startMoment, plannedDays) {
		const cursor = startMoment.clone().startOf("day");
		const excludeWeekends = this.should_exclude_planning_weekends();
		let remainingDays = Math.max(cint(plannedDays || 0), 1);

		while (true) {
			if (!excludeWeekends || cursor.isoWeekday() < 6) {
				remainingDays -= 1;
				if (remainingDays <= 0) {
					return cursor.clone();
				}
			}

			cursor.add(1, "day");
		}
	}

	get_card_planned_employee_count(card, assignedEmployees = []) {
		const assignedCount = cint(card?.assigned_employee_count || assignedEmployees.length || 0);
		const hasStoredCount = card?.planned_employee_count !== undefined && card?.planned_employee_count !== null && card?.planned_employee_count !== "";
		if (hasStoredCount) {
			const storedCount = Math.max(cint(card?.planned_employee_count || 0), 0);
			if (storedCount > 0 || assignedCount <= 0) {
				return storedCount;
			}
		}

		if (assignedCount > 0) {
			return assignedCount;
		}

		const defaultEmployeeHours = this.get_default_employee_hours_per_day();
		if (defaultEmployeeHours <= 0) {
			return 0;
		}

		const inferredCount = Math.round(flt(card?.hours_per_employee_per_day || 0) / defaultEmployeeHours) || 0;
		return Math.max(inferredCount, 0);
	}

	get_card_daily_team_hours(card, plannedEmployeeCount) {
		if (this.is_event_card(card)) {
			return 0;
		}

		if (!card) {
			return this.get_default_total_daily_hours(plannedEmployeeCount);
		}

		return flt(card.hours_per_employee_per_day || 0, 2) || this.get_default_total_daily_hours(plannedEmployeeCount);
	}

	sync_card_dialog_daily_hours(dialog) {
		if (this.is_event_card({ card_type: dialog.get_value("card_type") })) {
			return Promise.resolve();
		}

		if (dialog.__syncing_planned_employee_hours) {
			return Promise.resolve();
		}

		const plannedEmployeeCount = Math.max(cint(dialog.get_value("planned_employee_count") || 0), 0);
		const totalDailyHours = this.get_default_total_daily_hours(plannedEmployeeCount);
		const currentEmployeeCount = cint(dialog.get_value("planned_employee_count") || 0);
		const currentDailyHours = flt(dialog.get_value("hours_per_employee_per_day") || 0);
		const shouldUpdateEmployeeCount = currentEmployeeCount !== plannedEmployeeCount;
		const shouldUpdateDailyHours = currentDailyHours !== totalDailyHours;
		if (!shouldUpdateEmployeeCount && !shouldUpdateDailyHours) {
			return Promise.resolve();
		}

		dialog.__syncing_planned_employee_hours = true;
		if (shouldUpdateEmployeeCount) {
			dialog.set_value("planned_employee_count", plannedEmployeeCount);
		}

		if (shouldUpdateDailyHours) {
			dialog.set_value("hours_per_employee_per_day", totalDailyHours);
		}

		return new Promise((resolve) => {
			setTimeout(resolve, 0);
		}).finally(() => {
			dialog.__syncing_planned_employee_hours = false;
		});
	}

	set_dialog_value_silently(dialog, fieldname, value, flagName) {
		dialog[flagName] = true;
		dialog.set_value(fieldname, value);
		setTimeout(() => {
			dialog[flagName] = false;
		}, 0);
	}

	sync_card_dialog_schedule(dialog, source = "required_hours") {
		if (dialog.__syncing_card_schedule) {
			return;
		}

		const startDate = this.parse_user_date(dialog.get_value("start_date"));
		if (!startDate) {
			return;
		}

		if (this.is_event_card({ card_type: dialog.get_value("card_type") })) {
			let endDate = this.parse_user_date(dialog.get_value("end_date")) || startDate.clone();
			if (endDate.isBefore(startDate, "day")) {
				endDate = startDate.clone();
				this.set_dialog_value_silently(
					dialog,
					"end_date",
					endDate.format(frappe.defaultDateFormat),
					"__suppress_end_date_onchange"
				);
			}
			return;
		}

		const totalDailyHours = flt(dialog.get_value("hours_per_employee_per_day") || 0, 2);
		if (totalDailyHours <= 0) {
			return;
		}

		dialog.__syncing_card_schedule = true;
		try {
			if (source === "end_date") {
				let endDate = this.parse_user_date(dialog.get_value("end_date")) || startDate.clone();
				if (endDate.isBefore(startDate, "day")) {
					endDate = startDate.clone();
					this.set_dialog_value_silently(
						dialog,
						"end_date",
						endDate.format(frappe.defaultDateFormat),
						"__suppress_end_date_onchange"
					);
				}

				const plannedDays = Math.max(this.count_planning_days(startDate, endDate), 1);
				const requiredHours = flt(plannedDays * totalDailyHours, 2);
				if (flt(dialog.get_value("required_hours") || 0, 2) !== requiredHours) {
					this.set_dialog_value_silently(
						dialog,
						"required_hours",
						requiredHours,
						"__suppress_required_hours_onchange"
					);
				}
				return;
			}

			const requiredHours = flt(dialog.get_value("required_hours") || 0, 2);
			if (requiredHours <= 0) {
				return;
			}

			const plannedDays = Math.max(Math.ceil(requiredHours / totalDailyHours), 1);
			const endDate = this.get_last_planned_day_moment(startDate, plannedDays);
			const endDateText = endDate.format(frappe.defaultDateFormat);
			if (dialog.get_value("end_date") !== endDateText) {
				this.set_dialog_value_silently(
					dialog,
					"end_date",
					endDateText,
					"__suppress_end_date_onchange"
				);
			}
		} finally {
			dialog.__syncing_card_schedule = false;
		}
	}

	apply_card_type_dialog_state(dialog) {
		const eventCard = this.is_event_card({ card_type: dialog.get_value("card_type") });
		const productionFields = [
			"elementgruppe",
			"task_type",
			"operation",
			"required_hours",
			"planned_employee_count",
			"hours_per_employee_per_day",
			"assigned_employees",
			"note",
			"employee_availability_html",
		];
		const eventFields = ["event_type", "start_time", "end_time", "description"];

		productionFields.forEach((fieldname) => dialog.get_field(fieldname)?.$wrapper?.toggle(!eventCard));
		eventFields.forEach((fieldname) => dialog.get_field(fieldname)?.$wrapper?.toggle(eventCard));

		if (eventCard) {
			dialog.__schedule_mode = "end_date";
			dialog.get_field("employee_availability_html")?.$wrapper?.empty();
			if (!dialog.get_value("end_date") && dialog.get_value("start_date")) {
				dialog.set_value("end_date", dialog.get_value("start_date"));
			}
		} else if (!dialog.__schedule_mode) {
			dialog.__schedule_mode = "required_hours";
		}

		if (!eventCard) {
			this.sync_card_dialog_daily_hours(dialog);
		}
		dialog.set_df_property("event_type", "reqd", eventCard ? 1 : 0);
	}

	open_card_dialog({ card = null, default_start = null, default_end = null } = {}) {
		const is_edit = Boolean(card);
		const cardType = this.get_card_type(card);
		const start = (
			card
				? this.to_user_moment(card.start_date)
				: default_start || this.get_horizon_window().start.clone().startOf("day")
		).clone();
		const end = card
			? this.to_user_moment(card.end_date).clone()
			: (default_end || default_start || this.get_horizon_window().start.clone().startOf("day")).clone();
		const assignedEmployees = (card?.assigned_employees || []).map((row) => row.employee).filter(Boolean);
		const plannedEmployeeCount = this.get_card_planned_employee_count(card, assignedEmployees);
		const dailyTeamHours = this.get_card_daily_team_hours(card, plannedEmployeeCount);
		const dialog = new frappe.ui.Dialog({
			title: is_edit ? __("Update Planning Card") : __("New Planning Card"),
			fields: [
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "card_type",
					fieldtype: "Select",
					label: __("Card Type"),
					options: "Produktion\nEvent",
					default: cardType,
					reqd: 1,
					onchange: () => {
						this.apply_card_type_dialog_state(dialog);
						this.sync_card_dialog_schedule(dialog, dialog.__schedule_mode || "required_hours");
					},
				},
				{
					fieldname: "project",
					fieldtype: "Link",
					label: __("Project"),
					options: "Project",
					default: card?.project,
					get_query: () => this.get_open_project_query(),
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldname: "event_type",
					fieldtype: "Link",
					label: __("Event Type"),
					options: "Event Type",
					default: card?.event_type,
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "elementgruppe",
					fieldtype: "Data",
					label: __("Elementgruppe"),
					default: card?.elementgruppe,
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
					fieldtype: "Column Break",
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
					fieldtype: "Section Break",
				},
				{
					fieldname: "start_date",
					fieldtype: "Date",
					label: __("Start Date"),
					reqd: 1,
					default: start.format(frappe.defaultDateFormat),
					onchange: () => {
						this.sync_card_dialog_schedule(dialog, dialog.__schedule_mode || "required_hours");
					},
				},
				{
					fieldname: "start_time",
					fieldtype: "Time",
					label: __("Start Time"),
					default: this.normalize_time_value(card?.start_time),
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldname: "end_date",
					fieldtype: "Date",
					label: __("End Date"),
					reqd: 1,
					default: end.format(frappe.defaultDateFormat),
					onchange: () => {
						if (dialog.__suppress_end_date_onchange) {
							return;
						}
						if (dialog.__syncing_card_schedule) {
							return;
						}
						dialog.__schedule_mode = "end_date";
						this.sync_card_dialog_schedule(dialog, "end_date");
					},
				},
				{
					fieldname: "end_time",
					fieldtype: "Time",
					label: __("End Time"),
					default: this.normalize_time_value(card?.end_time),
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "required_hours",
					fieldtype: "Float",
					label: __("Required Hours"),
					default: flt(card?.required_hours || card?.duration_in_hours || 0),
					onchange: () => {
						if (dialog.__suppress_required_hours_onchange) {
							return;
						}
						if (dialog.__syncing_card_schedule) {
							return;
						}
						dialog.__required_hours_touched = true;
						dialog.__schedule_mode = "required_hours";
						this.sync_card_dialog_schedule(dialog, "required_hours");
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldname: "planned_employee_count",
					fieldtype: "Int",
					label: __("Employees on Card"),
					default: plannedEmployeeCount,
					onchange: () => {
						if (dialog.__syncing_planned_employee_hours) {
							return;
						}
						dialog.__employee_count_touched = true;
						const fixedRequiredHours = flt(dialog.get_value("required_hours") || 0, 2);
						dialog.__schedule_mode = "required_hours";
						this.sync_card_dialog_daily_hours(dialog).then(() => {
							if (flt(dialog.get_value("required_hours") || 0, 2) !== fixedRequiredHours) {
								dialog.set_value("required_hours", fixedRequiredHours);
							}
							this.sync_card_dialog_schedule(dialog, "required_hours");
						});
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldname: "hours_per_employee_per_day",
					fieldtype: "Float",
					label: __("Calculated Hours per Day"),
					reqd: 1,
					read_only: 1,
					default: dailyTeamHours,
				},
				{
					fieldtype: "Section Break",
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
					fieldname: "description",
					fieldtype: "Small Text",
					label: __("Description"),
					default: card?.description,
				},
				{
					fieldname: "note",
					fieldtype: "Small Text",
					label: __("Note"),
					default: card?.note,
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "employee_availability_html",
					fieldtype: "HTML",
				},
			],
			primary_action_label: is_edit ? __("Save") : __("Create"),
			primary_action: () => {
				const values = dialog.get_values();
				if (!values) {
					return;
				}

				const normalizedEmployees = this.normalize_employee_values(values.assigned_employees);
				const startDate = this.parse_user_date(values.start_date);
				if (!startDate) {
					frappe.msgprint(__("Start Date is required."));
					return;
				}

				let endDate = this.parse_user_date(values.end_date) || startDate.clone();
				if (endDate.isBefore(startDate, "day")) {
					endDate = startDate.clone();
				}

				const args = {
					name: card?.name,
					card_type: values.card_type || "Produktion",
					project: this.normalize_link_field_value(values.project),
					event_type: this.normalize_link_field_value(values.event_type),
					start_date: this.to_system_day_start(startDate),
					start_time: this.normalize_time_value(values.start_time),
					end_time: this.normalize_time_value(values.end_time),
					description: values.description,
				};
				if ((values.card_type || "Produktion") === "Event") {
					args.end_date = this.to_system_day_end(endDate);
				} else {
					const plannedEmployees = Math.max(cint(values.planned_employee_count || 0), 0);
					const dailyHours =
						flt(values.hours_per_employee_per_day || 0, 2) || this.get_default_total_daily_hours(plannedEmployees);
					let requiredHours = flt(values.required_hours || 0, 2);
					if (dialog.__schedule_mode === "end_date") {
						const plannedDays = Math.max(this.count_planning_days(startDate, endDate), 1);
						requiredHours = flt(plannedDays * dailyHours, 2);
					} else {
						const plannedDays = Math.max(Math.ceil(requiredHours / dailyHours), 1);
						endDate = this.get_last_planned_day_moment(startDate, plannedDays);
					}
					if (requiredHours <= 0) {
						frappe.msgprint(__("Required Hours must be greater than zero."));
						return;
					}

					if (dailyHours <= 0) {
						frappe.msgprint(__("Calculated Hours per Day must be greater than zero."));
						return;
					}

					Object.assign(args, {
						elementgruppe: this.normalize_link_field_value(values.elementgruppe),
						operation: this.normalize_link_field_value(values.operation),
						task_type: this.normalize_link_field_value(values.task_type),
						required_hours: requiredHours,
						planned_employee_count: plannedEmployees,
						hours_per_employee_per_day: dailyHours,
						assigned_employees: normalizedEmployees,
						adjust_end_date_for_parallel_work: 0,
						note: values.note,
					});
					if (dialog.__schedule_mode === "end_date") {
						args.end_date = this.to_system_day_end(endDate);
					}
				}

				frappe.call({
					method: is_edit
						? "aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.update_planning_card"
						: "aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.create_planning_card",
					args,
					callback: () => {
						dialog.hide();
						frappe.show_alert({
							message: is_edit ? __("Planning Card updated") : __("Planning Card created"),
							indicator: "green",
						});
						this.refresh();
					},
				});
			},
		});

		dialog.__required_hours_touched = is_edit;
		dialog.__task_type_touched = is_edit;
		dialog.__employee_count_touched = is_edit;
		dialog.__schedule_mode = cardType === "Event" || (!is_edit && default_end) ? "end_date" : "required_hours";
		dialog.show();
		dialog.$wrapper.addClass("aster-planning-card-dialog");
		dialog.get_field("required_hours")?.$wrapper?.addClass("aster-planning-card-dialog__required-hours");
		this.apply_card_type_dialog_state(dialog);

		if (is_edit && card?.name) {
			dialog.set_secondary_action_label(__("Delete"));
			dialog.set_secondary_action(() => {
				frappe.confirm(
					__("Delete Planning Card {0}? All employee assignments on this card will be removed as well.", [card.name]),
					() => {
						frappe.call({
							method:
								"aster_production_planning.aster_production_planning.page.planning_studio.planning_studio.delete_planning_card",
							args: {
								name: card.name,
							},
							callback: () => {
								dialog.hide();
								if (this.active_card_name === card.name) {
									this.close_card_detail();
								}
								frappe.show_alert({
									message: __("Planning Card deleted"),
									indicator: "green",
								});
								this.refresh();
							},
						});
					}
				);
			});
			dialog.get_secondary_btn().addClass("btn-danger").removeClass("btn-default");
		}

		if (!is_edit && !this.is_event_card({ card_type: dialog.get_value("card_type") }) && !flt(dialog.get_value("required_hours")) && dialog.get_value("operation")) {
			this.load_operation_defaults(dialog);
		}

		if (is_edit && card?.name && !this.is_event_card(card)) {
			setTimeout(() => {
				this.load_card_detail_into_dialog(dialog, card.name);
			}, 0);
		} else {
			this.sync_card_dialog_daily_hours(dialog).then(() => {
				this.sync_card_dialog_schedule(dialog, dialog.__schedule_mode);
			});
			dialog.get_field("employee_availability_html").$wrapper.empty();
		}
	}

	load_operation_defaults(dialog) {
		if (this.is_event_card({ card_type: dialog.get_value("card_type") })) {
			return;
		}

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

	get_open_project_query() {
		return {
			filters: {
				status: "Open",
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

	start_card_create_interaction(event) {
		if (event.which && event.which !== 1) {
			return;
		}
		if (this.card_resize_interaction || this.assignment_interaction) {
			return;
		}

		const $cell = $(event.currentTarget);
		const date = $cell.data("date");
		if (!date) {
			return;
		}

		const startDate = moment(date, "YYYY-MM-DD", true);
		if (!startDate.isValid()) {
			return;
		}

		event.preventDefault();
		this.card_create_interaction = {
			start_date: startDate.clone(),
			end_date: startDate.clone(),
			anchor_date: startDate.clone(),
			lane_index: this.get_horizon_lane_from_client_y(event.clientY),
			did_drag: false,
		};
		this.apply_card_create_preview(this.card_create_interaction);
	}

	get_horizon_date_from_client_x(clientX) {
		const cells = this.get_horizon_day_cells();
		if (!cells.length || !this.horizon_days.length) {
			return null;
		}

		let dayIndex = cells.findIndex((cell) => {
			const rect = cell.getBoundingClientRect();
			return clientX >= rect.left && clientX <= rect.right;
		});

		if (dayIndex < 0) {
			let shortestDistance = Number.POSITIVE_INFINITY;
			cells.forEach((cell, index) => {
				const rect = cell.getBoundingClientRect();
				const center = rect.left + rect.width / 2;
				const distance = Math.abs(clientX - center);
				if (distance < shortestDistance) {
					shortestDistance = distance;
					dayIndex = index;
				}
			});
		}

		dayIndex = Math.max(Math.min(dayIndex, this.horizon_days.length - 1), 0);
		const day = this.horizon_days[dayIndex];
		return day?.date ? day.date.clone() : null;
	}

	get_horizon_lane_from_client_y(clientY) {
		const body = this.$horizon.find(".aster-studio-horizon__body--continuous").get(0);
		const laneHeight = Math.max(cint(this.horizon_segments?.lane_height || 74), 1);
		const laneCount = Math.max(cint(this.horizon_segments?.lane_count || 1), 1);
		if (!body) {
			return 0;
		}

		const previewStartOffset = 36;
		const laneGap = 12;
		const rect = body.getBoundingClientRect();
		const relativeY = clientY - rect.top - previewStartOffset;
		const laneSpan = laneHeight + laneGap;
		const rawLane = Math.floor(relativeY / laneSpan);
		return Math.max(Math.min(rawLane, laneCount - 1), 0);
	}

	handle_card_create_interaction_move(event) {
		const interaction = this.card_create_interaction;
		if (!interaction) {
			return;
		}

		const hoveredDate = this.get_horizon_date_from_client_x(event.clientX);
		if (!hoveredDate) {
			return;
		}

		const nextStart = moment.min(interaction.anchor_date.clone(), hoveredDate.clone()).startOf("day");
		const nextEnd = moment.max(interaction.anchor_date.clone(), hoveredDate.clone()).startOf("day");
		const changed =
			!nextStart.isSame(interaction.start_date, "day") ||
			!nextEnd.isSame(interaction.end_date, "day");

		interaction.start_date = nextStart;
		interaction.end_date = nextEnd;
		interaction.did_drag = interaction.did_drag || changed;
		this.apply_card_create_preview(interaction);
	}

	apply_card_create_preview(interaction) {
		const $preview = this.$horizon.find(".aster-studio-horizon__create-preview");
		if (!$preview.length || !interaction?.start_date || !interaction?.end_date) {
			return;
		}

		const bounds = this.get_horizon_range_bounds(interaction.start_date, interaction.end_date);
		if (!bounds) {
			return;
		}

		const edgeInset = Math.max(
			Math.min(Math.round(Math.min(bounds.start_width, bounds.end_width) * 0.18), 8),
			2
		);
		const left = bounds.left + edgeInset;
		const width = Math.max(bounds.width - edgeInset * 2, 12);
		const laneIndex = Math.max(cint(interaction.lane_index || 0), 0);
		const laneHeight = Math.max(cint(this.horizon_segments?.lane_height || 74), 1);
		const laneGap = 12;
		const previewHeight = Math.min(Math.max(laneHeight - 14, 34), 46);
		const top = 36 + laneIndex * (laneHeight + laneGap) + Math.max((laneHeight - previewHeight) / 2, 0);
		const label = interaction.start_date.isSame(interaction.end_date, "day")
			? interaction.start_date.format("DD.MM.YYYY")
			: `${interaction.start_date.format("DD.MM.YYYY")} - ${interaction.end_date.format("DD.MM.YYYY")}`;

		$preview
			.addClass("is-active")
			.css({
				left: `${left}px`,
				top: `${top}px`,
				height: `${previewHeight}px`,
				width: `${width}px`,
			})
			.find(".aster-studio-horizon__create-preview-label")
			.remove();

		$preview.append(
			$(`<div class="aster-studio-horizon__create-preview-label">${frappe.utils.escape_html(label)}</div>`)
		);
	}

	finish_card_create_interaction() {
		const interaction = this.card_create_interaction;
		if (!interaction) {
			return;
		}

		this.$horizon.find(".aster-studio-horizon__create-preview").removeClass("is-active").empty().attr("style", "");
		this.card_create_interaction = null;

		if (!interaction.did_drag) {
			return;
		}

		this.open_create_dialog(interaction.start_date.clone(), interaction.end_date.clone());
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
			anchor_date:
				this.get_horizon_date_from_client_x(event.clientX) ||
				(mode === "resize-start" ? visibleStart.clone() : visibleEnd.clone()),
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

		const hoveredDate = this.get_horizon_date_from_client_x(event.clientX);
		if (!hoveredDate) {
			return;
		}

		const deltaDays = hoveredDate.diff(interaction.anchor_date, "days");
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

	get_selected_projects() {
		return [...this.get_filter_values("projects")];
	}

	get_selected_task_types() {
		return [...this.get_filter_values("task_types")];
	}

	get_selected_operations() {
		return [...this.get_filter_values("operations")];
	}

	get_focus_window() {
		if (this.horizon_start_date && this.horizon_end_date) {
			return {
				start: this.horizon_start_date.clone(),
				end: this.horizon_end_date.clone().add(1, "day"),
			};
		}

		return this.get_preset_window(this.horizon_mode, this.focus_date);
	}

	get_horizon_window() {
		const presetWindow = this.get_preset_window(this.horizon_mode, this.focus_date);
		const fallback_start = presetWindow.start.clone();
		const fallback_end = presetWindow.end.clone().subtract(1, "day").startOf("day");
		const start = (this.horizon_start_date || fallback_start).clone().startOf("day");
		const end = (this.horizon_end_date || fallback_end).clone().add(1, "day").startOf("day");
		return { start, end };
	}

	handle_horizon_control_change() {
		if (this.suppress_horizon_control_change) {
			return;
		}

		const start = this.parse_user_date(this.horizon_controls.from?.get_value());
		const end = this.parse_user_date(this.horizon_controls.to?.get_value());
		if (!start || !end) {
			return;
		}

		if (
			this.horizon_start_date?.isSame(start, "day") &&
			this.horizon_end_date?.isSame(end, "day")
		) {
			return;
		}

		this.set_horizon_selection(start, end);
	}

	set_horizon_selection(startDate, endDate, { refresh = true, sync_focus = true } = {}) {
		const start = this.parse_user_date(startDate)?.startOf("day");
		let end = this.parse_user_date(endDate)?.startOf("day");
		if (!start || !end) {
			return;
		}

		if (end.isBefore(start, "day")) {
			end = start.clone();
		}

		const range_changed =
			!this.horizon_start_date?.isSame(start, "day") ||
			!this.horizon_end_date?.isSame(end, "day");

		this.horizon_start_date = start.clone();
		this.horizon_end_date = end.clone();
		if (sync_focus) {
			this.focus_date = start.clone();
		}
		this.sync_horizon_controls();
		if (refresh && range_changed) {
			this.refresh();
		}
	}

	sync_horizon_controls() {
		if (!this.horizon_controls.from || !this.horizon_controls.to || !this.horizon_start_date || !this.horizon_end_date) {
			return;
		}

		const fromValue = this.horizon_start_date.format("YYYY-MM-DD");
		const toValue = this.horizon_end_date.format("YYYY-MM-DD");
		const fromDisplayValue = this.format_horizon_date(fromValue);
		const toDisplayValue = this.format_horizon_date(toValue);
		this.suppress_horizon_control_change = true;
		try {
			this.horizon_controls.from.value = fromValue;
			this.horizon_controls.to.value = toValue;
			this.horizon_controls.from.$input?.val(fromDisplayValue);
			this.horizon_controls.to.$input?.val(toDisplayValue);
		} finally {
			this.suppress_horizon_control_change = false;
		}
	}

	apply_horizon_preset(mode = this.horizon_mode, focusDate = this.focus_date, { refresh = true } = {}) {
		this.horizon_mode = mode || this.horizon_mode;
		this.focus_date = this.parse_user_date(focusDate) || moment();
		const presetWindow = this.get_preset_window(this.horizon_mode, this.focus_date);
		const preset_start = presetWindow.start.clone();
		const preset_end = presetWindow.end.clone().subtract(1, "day").startOf("day");
		this.set_horizon_selection(preset_start, preset_end, { refresh, sync_focus: false });
	}

	get_horizon_shift_config() {
		if (this.horizon_mode === "quarter") {
			return { amount: 1, unit: "quarter" };
		}
		if (this.horizon_mode === "two_weeks") {
			return { amount: 2, unit: "week" };
		}
		return { amount: 1, unit: "month" };
	}

	get_preset_window(mode = this.horizon_mode, focusDate = this.focus_date) {
		const focus = this.parse_user_date(focusDate) || moment();
		if (mode === "two_weeks") {
			const start = focus.clone().startOf("isoWeek").startOf("day");
			const end = start.clone().add(12, "days").add(1, "day");
			return { start, end };
		}

		const baseUnit = mode === "quarter" ? "quarter" : "month";
		const baseStart = focus.clone().startOf(baseUnit);
		const baseEnd = focus.clone().endOf(baseUnit);
		return {
			start: baseStart.clone().startOf("isoWeek").startOf("day"),
			end: baseEnd.clone().isoWeekday(5).add(1, "day").startOf("day"),
		};
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

	get_planned_hours_in_window(windowStart, windowEnd, card) {
		if (!windowStart || !windowEnd || !card || card.card_type === "Event") {
			return 0;
		}

		const startDate = this.to_user_moment(card.start_date);
		const endDate = this.to_user_moment(card.end_date);
		const requiredHours = flt(card.required_hours || card.duration_in_hours || 0, 2);
		if (!startDate || !endDate || !startDate.isValid() || !endDate.isValid() || requiredHours <= 0) {
			return 0;
		}

		const plannedDays = Math.max(this.count_planning_days(startDate, endDate), 0);
		if (!plannedDays) {
			return 0;
		}

		let totalDailyHours = flt(card.hours_per_employee_per_day || 0, 2);
		if (totalDailyHours <= 0) {
			totalDailyHours = flt(requiredHours / plannedDays, 2);
		}

		const rangeStart = windowStart.clone().startOf("day");
		const rangeEnd = windowEnd.clone().subtract(1, "second").startOf("day");
		if (rangeEnd.isBefore(rangeStart, "day")) {
			return 0;
		}

		const excludeWeekends = this.should_exclude_planning_weekends();
		const cursor = startDate.clone().startOf("day");
		const lastDay = endDate.clone().startOf("day");
		let remainingHours = requiredHours;
		let plannedHours = 0;
		let emittedDays = 0;

		while (!cursor.isAfter(lastDay, "day") && remainingHours > 0) {
			if (!excludeWeekends || cursor.isoWeekday() < 6) {
				const dayHours = flt(
					emittedDays >= plannedDays - 1 ? remainingHours : Math.min(totalDailyHours, remainingHours),
					2
				);
				if (cursor.isSameOrAfter(rangeStart, "day") && cursor.isSameOrBefore(rangeEnd, "day")) {
					plannedHours += dayHours;
				}
				remainingHours = flt(remainingHours - dayHours, 2);
				emittedDays += 1;
			}
			cursor.add(1, "day");
		}

		return flt(plannedHours, 2);
	}

	to_system_datetime(value) {
		return frappe.datetime.convert_to_system_tz(moment(value).format(frappe.defaultDatetimeFormat));
	}

	to_system_day_start(value) {
		const parsed = this.parse_user_date(value);
		return parsed
			? frappe.datetime.convert_to_system_tz(parsed.clone().startOf("day").format(frappe.defaultDatetimeFormat))
			: null;
	}

	to_system_day_end(value) {
		const parsed = this.parse_user_date(value);
		return parsed
			? frappe.datetime.convert_to_system_tz(parsed.clone().hour(23).minute(59).second(59).format(frappe.defaultDatetimeFormat))
			: null;
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

	is_hourly_absence(item) {
		return String(item?.allocation_type || item?.allocation_base || "").toLowerCase() === "hourly";
	}

	format_absence_datetime_parts(value, showTime = true) {
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

		return {
			day: parsed.format("DD.MM.YYYY"),
			time: showTime && rawValue.length > 10 ? parsed.format("HH:mm") : "",
		};
	}

	get_absence_schedule_markup(item) {
		const showTime = this.is_hourly_absence(item);
		const start = this.format_absence_datetime_parts(item.from_date, showTime);
		const end = this.format_absence_datetime_parts(item.to_date, showTime);
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
		if (this.is_hourly_absence(item)) {
			return this.format_hours_with_unit(item.leave_hours_without_pause || 0);
		}

		const days = flt(item.total_leave_days || item.overlap_days || 0);
		const formattedDays = Number.isInteger(days) ? String(days) : format_number(days, null, 1);
		return __("{0} days", [formattedDays]);
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

		const cardStartKey = cardStart.format("YYYY-MM-DD");
		const cardEndKey = cardEnd.format("YYYY-MM-DD");
		const span = this.get_horizon_relative_span(visibleStart, visibleEnd, overlapStart, overlapEnd);

		return {
			from_date: fromMoment.format("YYYY-MM-DD"),
			to_date: toMoment.format("YYYY-MM-DD"),
			left_percent: span.left_percent,
			width_percent: span.width_percent,
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

		const span = this.get_horizon_relative_span(visibleStart, visibleEnd, overlapStart, overlapEnd);
		return `<div class="aster-studio-card__week-highlight" style="--week-left:${span.left_percent}%; --week-width:${span.width_percent}%;"></div>`;
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
			anchor_date:
				this.get_horizon_date_from_client_x(event.clientX) ||
				(mode === "resize-end"
					? moment($segment.data("to"), "YYYY-MM-DD")
					: moment($segment.data("from"), "YYYY-MM-DD")),
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

		const hoveredDate = this.get_horizon_date_from_client_x(event.clientX);
		if (!hoveredDate) {
			return;
		}

		const deltaDays = hoveredDate.diff(interaction.anchor_date, "days");
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
		const span = this.get_horizon_relative_span(visibleStart, visibleEnd, overlapStart, overlapEnd);
		interaction.$segment.css("--assignment-preview-left", `${span.left_percent}%`);
		interaction.$segment.css("--assignment-preview-width", `${span.width_percent}%`);
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
				min-width: 0;
				width: 100%;
				padding: 10px clamp(16px, 3vw, 40px) 24px;
			}

			.aster-planning-studio-layout,
			.aster-planning-studio-section-wrapper,
			.aster-planning-studio-page {
				min-width: 0;
			}

			body.full-width .aster-planning-studio-layout {
				width: 100%;
				max-width: none;
			}

			body.full-width .aster-planning-studio-section-wrapper {
				flex: 1 0 100%;
				width: 100%;
				max-width: none;
			}

			body.full-width .aster-planning-studio-page {
				width: 100%;
				max-width: none;
			}

			body.full-width .aster-studio {
				max-width: none;
				padding-left: clamp(12px, 1.6vw, 24px);
				padding-right: clamp(12px, 1.6vw, 24px);
			}

			.aster-studio__hero,
			.aster-studio__metrics,
			.aster-studio__stack,
			.aster-studio-overview,
			.aster-studio__support {
				display: grid;
				gap: 16px;
				min-width: 0;
			}

			.aster-studio__sticky-head {
				background: var(--bg-color, #f7f8fa);
				display: grid;
				gap: 10px;
				margin-bottom: 10px;
				padding: 0 0 10px;
				position: sticky;
				top: 0;
				z-index: 30;
			}

			.aster-studio__hero {
				align-items: start;
				grid-template-columns: minmax(0, 1fr) auto;
				margin-bottom: 0;
			}

			.aster-studio__hero-copy {
				display: grid;
				gap: 10px;
			}

			.aster-studio__hero-toggle-wrap {
				display: flex;
				justify-content: flex-end;
				padding-top: 4px;
			}

			.aster-studio__sticky-toggle {
				align-items: center;
				background: rgba(255, 255, 255, 0.86);
				border: 1px solid rgba(36, 49, 60, 0.1);
				border-radius: 999px;
				box-shadow: 0 4px 12px rgba(33, 48, 61, 0.08);
				color: var(--studio-soft);
				display: inline-flex;
				height: 34px;
				justify-content: center;
				min-width: 34px;
				padding: 0;
			}

			.aster-studio__sticky-toggle:hover,
			.aster-studio__sticky-toggle:focus {
				background: #fff;
				color: var(--studio-ink);
			}

			.aster-studio__sticky-head.is-collapsed {
				gap: 0;
				padding-bottom: 6px;
			}

			.aster-studio__sticky-head.is-collapsed .aster-studio__hero-copy {
				gap: 0;
			}

			.aster-studio__sticky-head.is-collapsed .aster-studio__hero-copy h2 {
				font-size: clamp(22px, 2.2vw, 28px);
			}

			.aster-studio__sticky-head.is-collapsed .aster-studio__horizon-controls,
			.aster-studio__sticky-head.is-collapsed .aster-studio__metrics {
				display: none;
			}

			.aster-studio__hero-copy h2 {
				font-size: clamp(28px, 3vw, 42px);
				font-weight: 800;
				letter-spacing: -0.03em;
				line-height: 0.98;
				margin: 0;
				max-width: 880px;
			}

			.aster-studio__hero-actions,
			.aster-studio__horizon-actions,
			.aster-studio__mode-switch,
			.aster-studio__view-switch,
			.aster-studio__nav,
			.aster-studio__panel-actions,
			.aster-studio-card__actions,
			.aster-studio-week-pill__meta {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}

			.aster-studio__hero-actions {
				align-items: flex-end;
				justify-content: flex-end;
			}

			.aster-studio-period-nav--arrow {
				font-size: 15px;
				font-weight: 700;
				line-height: 1;
				min-width: 36px;
				padding-left: 10px;
				padding-right: 10px;
			}

			.aster-studio__horizon-controls {
				display: grid;
				gap: 8px;
				justify-items: start;
				margin-top: 0;
				width: min(100%, 640px);
			}

			.aster-studio__horizon-dates {
				display: grid;
				gap: 10px;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				width: 100%;
			}

			.aster-studio__horizon-field .form-group {
				margin-bottom: 0;
			}

			.aster-studio__horizon-field .control-label {
				color: var(--studio-soft);
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.03em;
				margin-bottom: 6px;
				text-transform: uppercase;
			}

			.aster-studio__horizon-actions {
				justify-content: flex-start;
				width: 100%;
			}

			.aster-studio__mode-switch .btn.is-active,
			.aster-studio__view-switch .btn.is-active {
				background: var(--studio-accent);
				border-color: var(--studio-accent);
				color: #fff;
			}

			.aster-studio__overview-range,
			.aster-studio__horizon-note {
				color: var(--studio-soft);
				font-size: 15px;
				font-weight: 600;
			}

			.aster-studio__metrics {
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 12px;
				margin-bottom: 0;
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
				min-width: 0;
			}

			.aster-studio__metric {
				cursor: help;
				min-height: 74px;
				overflow: visible;
				padding: 10px 16px;
				position: relative;
			}

			.aster-studio__metric::after {
				background: rgba(157, 18, 255, 0.06);
				border-radius: inherit;
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
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.06em;
				position: relative;
				text-transform: uppercase;
				z-index: 1;
			}

			.aster-studio__metric-value {
				font-size: 24px;
				font-weight: 700;
				line-height: 1.08;
				margin: 5px 0 0;
				position: relative;
				z-index: 1;
			}

			.aster-studio__metric.is-danger .aster-studio__metric-value {
				color: #b94b4b;
			}

			.aster-studio__metric-meta {
				background: rgba(255, 255, 255, 0.98);
				border: 1px solid rgba(36, 49, 60, 0.08);
				border-radius: 12px;
				box-shadow: 0 12px 28px rgba(33, 48, 61, 0.12);
				font-size: 12px;
				left: 12px;
				max-width: min(320px, calc(100vw - 40px));
				opacity: 0;
				padding: 8px 10px;
				pointer-events: none;
				position: absolute;
				right: 12px;
				top: calc(100% + 8px);
				transform: translateY(-4px);
				transition: opacity 0.16s ease, transform 0.16s ease;
				visibility: hidden;
				white-space: normal;
				z-index: 12;
			}

			.aster-studio__metric:hover .aster-studio__metric-meta,
			.aster-studio__metric:focus-within .aster-studio__metric-meta {
				opacity: 1;
				transform: translateY(0);
				visibility: visible;
			}

			.aster-studio__panel {
				padding: 18px;
			}

			.aster-studio__overview-panel {
				overflow: visible;
				position: relative;
			}

			.aster-planning-card-dialog .modal-dialog {
				max-width: min(980px, 88vw);
				width: min(980px, 88vw);
			}

			.aster-planning-card-dialog .modal-content {
				border-radius: 18px;
			}

			.aster-planning-card-dialog .modal-body {
				max-height: min(80vh, 880px);
				overflow-y: auto;
			}

			.aster-planning-card-dialog .form-layout,
			.aster-planning-card-dialog .form-page {
				margin: 0 auto;
				max-width: 860px;
			}

			.aster-planning-card-dialog .section-body {
				padding-inline: 8px;
			}

			.aster-planning-card-dialog .frappe-control {
				max-width: 100%;
			}

			.aster-planning-card-dialog__required-hours .control-label {
				color: #8b2d12;
				font-weight: 700;
			}

			.aster-planning-card-dialog__required-hours .control-input-wrapper input {
				background: #fff8f1;
				border-color: rgba(139, 45, 18, 0.24);
				box-shadow: inset 0 0 0 1px rgba(139, 45, 18, 0.06);
			}

			.aster-studio-dialog-panel {
				background: rgba(36, 49, 60, 0.03);
				border: 1px solid rgba(36, 49, 60, 0.08);
				border-radius: 18px;
				margin-top: 8px;
				padding: 16px;
			}

			.aster-studio-dialog-panel__head h4 {
				font-size: 15px;
				font-weight: 700;
				margin: 0;
			}

			.aster-studio-dialog-panel__head p {
				color: var(--studio-soft);
				font-size: 12px;
				margin: 4px 0 0;
			}

			.aster-studio-dialog-panel__list {
				display: grid;
				gap: 10px;
				margin-top: 14px;
			}

			.aster-studio__dialog-capacity-table {
				display: grid;
			}

			.aster-studio__dialog-capacity-row {
				align-items: start;
				border-top: 1px solid rgba(36, 49, 60, 0.08);
				display: grid;
				gap: 12px;
				grid-template-columns: minmax(0, 1.8fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) auto;
				padding: 12px 0;
			}

			.aster-studio__dialog-capacity-row.is-head {
				align-items: center;
				border-top: 0;
				color: var(--studio-soft);
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				padding-top: 0;
				text-transform: uppercase;
			}

			.aster-studio__dialog-capacity-row.is-assigned {
				background: rgba(157, 18, 255, 0.03);
			}

			.aster-studio__dialog-capacity-name {
				min-width: 0;
			}

			.aster-studio__dialog-capacity-meta {
				color: var(--studio-soft);
				display: flex;
				flex-wrap: wrap;
				font-size: 12px;
				gap: 10px;
				margin-top: 4px;
			}

			.aster-studio__dialog-capacity-badges {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
				margin-top: 8px;
			}

			.aster-studio__dialog-capacity-action {
				display: flex;
				justify-content: flex-end;
			}

			.aster-studio-employee__assign {
				border: 0;
				border-radius: 999px;
				box-shadow: 0 6px 16px rgba(28, 41, 49, 0.12);
				font-weight: 700;
				min-width: 118px;
				padding: 7px 12px;
				transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
			}

			.aster-studio-employee__assign:hover {
				transform: translateY(-1px);
				box-shadow: 0 10px 22px rgba(28, 41, 49, 0.16);
			}

			.aster-studio-employee__assign.is-assign {
				background: linear-gradient(135deg, rgba(157, 18, 255, 0.96) 0%, rgba(118, 46, 220, 0.96) 100%);
				color: #fff;
			}

			.aster-studio-employee__assign.is-assign:hover,
			.aster-studio-employee__assign.is-assign:focus {
				background: linear-gradient(135deg, rgba(146, 12, 238, 1) 0%, rgba(106, 38, 205, 1) 100%);
				color: #fff;
			}

			.aster-studio-employee__assign.is-remove {
				background: rgba(185, 75, 75, 0.12);
				color: #9f2f2f;
				box-shadow: inset 0 0 0 1px rgba(185, 75, 75, 0.18);
			}

			.aster-studio-employee__assign.is-remove:hover,
			.aster-studio-employee__assign.is-remove:focus {
				background: rgba(185, 75, 75, 0.18);
				color: #8d2323;
			}

			.aster-studio-dialog-panel__loading {
				color: var(--studio-soft);
				font-size: 13px;
			}

			.aster-studio__horizon-panel {
				max-width: 100%;
				padding-left: 0;
				padding-right: 0;
				overflow: visible;
				width: 100%;
			}

			.aster-studio__horizon-panel .aster-studio__panel-head {
				padding: 0 18px;
			}

			.aster-studio__horizon {
				max-width: 100%;
				min-width: 0;
				width: 100%;
			}

			.aster-studio__calendar-filters {
				align-items: start;
				border-top: 1px solid rgba(36, 49, 60, 0.06);
				display: flex;
				flex-wrap: wrap;
				gap: 14px;
				padding: 12px 18px 10px;
				position: relative;
				z-index: 50;
			}

			.aster-filter-picker {
				flex: 0 1 280px;
				min-width: 240px;
				position: relative;
			}

			.aster-filter-picker.is-open {
				z-index: 60;
			}

			.aster-filter-picker__label {
				color: var(--text-muted);
				font-size: 12px;
				font-weight: 600;
				margin-bottom: 6px;
			}

			.aster-filter-picker__trigger {
				align-items: center;
				background: #fff;
				border: 1px solid rgba(157, 18, 255, 0.28);
				border-radius: 16px;
				box-shadow: 0 6px 16px rgba(33, 48, 61, 0.08);
				display: flex;
				gap: 10px;
				justify-content: space-between;
				min-height: 44px;
				padding: 10px 14px;
				text-align: left;
				width: 100%;
			}

			.aster-filter-picker.is-open .aster-filter-picker__trigger {
				border-color: rgba(122, 0, 214, 0.45);
				box-shadow: 0 0 0 3px rgba(157, 18, 255, 0.08);
			}

			.aster-filter-picker__trigger-text {
				color: var(--studio-ink);
				flex: 1 1 auto;
				font-size: 14px;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.aster-filter-picker__trigger-meta {
				align-items: center;
				display: inline-flex;
				flex: 0 0 auto;
				gap: 8px;
			}

			.aster-filter-picker__count {
				align-items: center;
				background: rgba(157, 18, 255, 0.12);
				border-radius: 999px;
				color: var(--studio-accent-strong);
				display: inline-flex;
				font-size: 12px;
				font-weight: 700;
				height: 22px;
				justify-content: center;
				min-width: 22px;
				padding: 0 7px;
			}

			.aster-filter-picker__caret {
				color: var(--studio-soft);
				display: inline-flex;
			}

			.aster-filter-picker__menu {
				background: #fff;
				border: 1px solid rgba(195, 209, 221, 0.9);
				border-radius: 18px;
				box-shadow: 0 18px 34px rgba(33, 48, 61, 0.14);
				display: none;
				left: 0;
				margin-top: 8px;
				overflow: hidden;
				position: absolute;
				top: 100%;
				width: min(320px, 92vw);
				z-index: 20;
			}

			.aster-filter-picker.is-open .aster-filter-picker__menu {
				display: block;
			}

			.aster-filter-picker__search {
				padding: 10px 10px 0;
			}

			.aster-filter-picker__search-input {
				border-radius: 12px;
				min-height: 36px;
			}

			.aster-filter-picker__options {
				display: grid;
				gap: 2px;
				max-height: 260px;
				overflow: auto;
				padding: 8px 10px 10px;
			}

			.aster-filter-picker__option {
				align-items: center;
				border-radius: 12px;
				cursor: pointer;
				display: flex;
				font-size: 13px;
				font-weight: 600;
				gap: 10px;
				padding: 8px 10px;
			}

			.aster-filter-picker__option:hover {
				background: rgba(36, 49, 60, 0.04);
			}

			.aster-filter-picker__checkbox {
				flex: 0 0 auto;
				margin: 0;
			}

			.aster-filter-picker__empty {
				color: var(--studio-soft);
				font-size: 13px;
				padding: 10px;
			}

			.aster-filter-picker__actions {
				align-items: center;
				border-top: 1px solid rgba(36, 49, 60, 0.08);
				display: flex;
				justify-content: space-between;
				padding: 10px;
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
				display: grid;
			}

			.aster-studio-overview-wrap {
				overflow: visible;
				padding: 48px 0 10px;
				position: relative;
			}

			.aster-studio-overview-scroll {
				overflow-x: auto;
				overflow-y: visible;
			}

			.aster-studio-overview-track {
				display: grid;
				gap: 8px;
				width: max-content;
			}

			.aster-studio-overview--bars {
				align-items: end;
				gap: 8px;
				grid-template-columns: repeat(var(--week-count, 52), 14px);
			}

			.aster-studio-overview--months {
				align-items: start;
				gap: 8px;
				grid-template-columns: repeat(var(--week-count, 52), 14px);
			}

			.aster-studio-overview__month {
				color: var(--studio-soft);
				font-size: 10px;
				font-weight: 700;
				line-height: 1;
				text-align: center;
				text-transform: uppercase;
				white-space: nowrap;
			}

			.aster-studio-week-pill {
				align-items: center;
				background: transparent;
				border: none;
				border-radius: 0;
				box-shadow: none;
				cursor: pointer;
				display: flex;
				flex-direction: column;
				gap: 0;
				min-height: 0;
				padding: 0;
				position: relative;
				transition: transform 0.15s ease, opacity 0.15s ease;
			}

			.aster-studio-week-pill.is-selectable:hover {
				transform: translateY(-2px);
			}

			.aster-studio-week-pill.is-active {
				transform: translateY(-2px);
			}

			.aster-studio-week-pill.is-outside-horizon {
				cursor: default;
				opacity: 0.3;
			}

			.aster-studio-week-pill.is-empty-week {
				opacity: 0.7;
			}

			.aster-studio-week-pill__chart {
				align-items: flex-end;
				display: flex;
				height: 156px;
				justify-content: center;
				padding: 0;
				width: 100%;
			}

			.aster-studio-week-pill__week-label {
				color: var(--studio-soft);
				font-size: 8px;
				font-weight: 700;
				line-height: 1;
				margin-top: 4px;
				text-align: center;
				white-space: nowrap;
			}

			.aster-studio-week-pill__bar-stack {
				align-items: flex-end;
				display: flex;
				height: 100%;
				justify-content: center;
				position: relative;
				width: 100%;
			}

			.aster-studio-week-pill__bar-overflow {
				background: var(--planned-fill-color, #d64b4b);
				border: 1px solid var(--planned-fill-color, #d64b4b);
				border-bottom: none;
				border-radius: 10px 10px 0 0;
				bottom: var(--bar-shell-height, 0px);
				left: 50%;
				position: absolute;
				transform: translateX(-50%);
				width: 10px;
				z-index: 3;
			}

			.aster-studio-week-pill__bar-shell {
				align-items: flex-end;
				background: transparent;
				border: 1px solid rgba(36, 49, 60, 0.12);
				border-radius: 999px;
				box-shadow: none;
				display: flex;
				height: 100%;
				justify-content: center;
				overflow: hidden;
				position: relative;
				width: 10px;
			}

			.aster-studio-week-pill__bar-shell.is-overloaded {
				border-top-left-radius: 0;
				border-top-right-radius: 0;
			}

			.aster-studio-week-pill.is-active .aster-studio-week-pill__bar-shell {
				border-color: rgba(157, 18, 255, 0.72);
				box-shadow: 0 0 0 3px rgba(157, 18, 255, 0.14);
			}

			.aster-studio-week-pill.is-empty-week .aster-studio-week-pill__bar-shell {
				background: transparent;
				border-color: transparent;
				box-shadow: none;
				height: 14px !important;
				width: 10px;
			}

			.aster-studio-week-pill.is-empty-week .aster-studio-week-pill__bar-capacity,
			.aster-studio-week-pill.is-empty-week .aster-studio-week-pill__bar-planned,
			.aster-studio-week-pill.is-empty-week .aster-studio-week-pill__bar-overflow,
			.aster-studio-week-pill.is-empty-week .aster-studio-week-pill__bar-cap-marker {
				display: none;
			}

			.aster-studio-week-pill.is-empty-week .aster-studio-week-pill__week-label {
				opacity: 0.75;
			}

			.aster-studio-week-pill__bar-capacity,
			.aster-studio-week-pill__bar-planned {
				border-radius: 14px 14px 0 0;
				bottom: 0;
				left: 50%;
				position: absolute;
				transform: translateX(-50%);
			}

			.aster-studio-week-pill__bar-capacity {
				background: rgba(120, 130, 142, 0.28);
				width: 100%;
			}

			.aster-studio-week-pill__bar-cap-marker {
				background: rgba(77, 90, 104, 0.8);
				border-radius: 999px;
				box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8), 0 0 8px rgba(77, 90, 104, 0.18);
				height: 3px;
				left: 50%;
				position: absolute;
				top: -1px;
				transform: translateX(-50%);
				width: 18px;
				z-index: 2;
			}

			.aster-studio-week-pill__bar-shell.is-zero-capacity .aster-studio-week-pill__bar-cap-marker {
				bottom: -1px;
				top: auto;
			}

			.aster-studio-week-pill__bar-planned {
				background: var(--planned-fill-color, transparent);
				border-radius: 999px;
				width: 100%;
				z-index: 1;
			}

			.aster-studio-week-pill__bar-shell.is-overloaded .aster-studio-week-pill__bar-planned {
				border-radius: 999px 999px 0 0;
			}

			.aster-studio-week-pill__bar-shell.is-overloaded .aster-studio-week-pill__bar-cap-marker {
				background: rgba(255, 255, 255, 0.96);
				box-shadow: none;
			}

			.aster-studio-week-pill__tooltip-content {
				display: none;
			}

			.aster-studio-overview-hovercard,
			.aster-studio-card-hovercard {
				background: rgba(255, 255, 255, 0.98);
				border: 1px solid rgba(36, 49, 60, 0.08);
				border-radius: 12px;
				box-shadow: 0 14px 30px rgba(28, 41, 49, 0.16);
				max-width: 220px;
				min-width: 180px;
				opacity: 0;
				padding: 10px 12px;
				pointer-events: none;
				position: absolute;
				transform: translate(-50%, -100%);
				transition: opacity 0.14s ease, visibility 0.14s ease;
				visibility: hidden;
				z-index: 20;
			}

			.aster-studio-overview-hovercard.is-visible,
			.aster-studio-card-hovercard.is-visible {
				opacity: 1;
				visibility: visible;
			}

			.aster-studio-overview-hovercard::after,
			.aster-studio-card-hovercard::after {
				border-left: 6px solid transparent;
				border-right: 6px solid transparent;
				border-top: 7px solid rgba(255, 255, 255, 0.98);
				bottom: -7px;
				content: "";
				left: 50%;
				position: absolute;
				transform: translateX(-50%);
			}

			.aster-studio-week-pill__tooltip-title {
				color: #24313c;
				font-size: 12px;
				font-weight: 700;
				line-height: 1.2;
			}

			.aster-studio-week-pill__tooltip-range {
				color: var(--studio-soft);
				font-size: 10px;
				font-weight: 600;
				line-height: 1.2;
				margin-top: 2px;
			}

			.aster-studio-week-pill__tooltip-stats {
				color: #4f6070;
				font-size: 10px;
				line-height: 1.35;
				margin-top: 8px;
			}

			.aster-studio-week-pill__tooltip-stats .is-negative {
				color: #b94b4b;
				font-weight: 700;
			}

			.aster-studio-week-pill__tooltip-projects {
				border-top: 1px solid rgba(36, 49, 60, 0.08);
				margin-top: 8px;
				padding-top: 8px;
			}

			.aster-studio-week-pill__tooltip-project,
			.aster-studio-week-pill__tooltip-empty {
				color: #24313c;
				font-size: 10px;
				line-height: 1.35;
			}

			.aster-studio-week-pill__tooltip-project + .aster-studio-week-pill__tooltip-project {
				margin-top: 3px;
			}

			.aster-studio-week-pill__tooltip-empty {
				color: var(--studio-soft);
			}

			.aster-studio-card-hovercard {
				max-width: 320px;
				min-width: 240px;
				z-index: 8;
			}

			.aster-studio-card-hovercard__note-label {
				color: var(--studio-soft);
				font-size: 10px;
				font-weight: 700;
				letter-spacing: 0.02em;
				margin-bottom: 4px;
				text-transform: uppercase;
			}

			.aster-studio-card-hovercard__note-text {
				color: #24313c;
				font-size: 10px;
				line-height: 1.4;
				white-space: normal;
			}

			.aster-studio-horizon {
				box-sizing: border-box;
				max-width: 100%;
				min-width: 0;
				overflow-x: auto;
				padding: 0 18px 4px;
				width: 100%;
			}

			.aster-studio-horizon__timeline {
				min-width: max-content;
				position: relative;
				width: max-content;
			}

			.aster-studio-horizon.is-full-width .aster-studio-horizon__timeline {
				min-width: 100%;
				width: 100%;
			}

			.aster-studio-horizon__head--continuous,
			.aster-studio-horizon__body--continuous {
				display: grid;
				grid-template-columns: var(--day-columns, repeat(var(--day-count), minmax(var(--day-width, 64px), var(--day-width, 64px))));
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
				min-height: 74px;
				overflow: hidden;
				padding: 6px 5px 7px;
			}

			.aster-studio-horizon__day-header.is-weekend {
				background: rgba(248, 244, 238, 0.92);
				padding-left: 4px;
				padding-right: 4px;
				text-align: center;
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
				font-size: 10px;
				font-weight: 700;
				letter-spacing: 0.02em;
				text-transform: uppercase;
			}

			.aster-studio-horizon__day-number {
				color: var(--studio-soft);
				font-size: 12px;
				font-weight: 600;
				margin-top: 2px;
			}

			.aster-studio-horizon__day-header.is-weekend .aster-studio-horizon__day-capacity,
			.aster-studio-horizon__day-header.is-weekend .aster-studio-horizon__day-absence {
				display: none;
			}

			.aster-studio-horizon__day-capacity {
				color: #24313c;
				font-size: 11px;
				font-weight: 700;
				margin-top: 5px;
			}

			.aster-studio-horizon__day-absence {
				color: #c35f24;
				font-size: 10px;
				font-weight: 700;
				margin-top: 2px;
			}

			.aster-studio-horizon__body--continuous {
				min-height: calc(168px + var(--lane-count) * var(--lane-height, 74px));
				position: relative;
				z-index: 1;
			}

			.aster-studio-horizon-cell {
				background: rgba(255, 255, 255, 0.88);
				border-bottom: 1px solid rgba(36, 49, 60, 0.08);
				border-right: 1px solid rgba(36, 49, 60, 0.06);
				min-height: calc(168px + var(--lane-count) * var(--lane-height, 74px));
				overflow: hidden;
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
				align-items: center;
				justify-content: center;
				bottom: 54px;
				left: 50%;
				position: absolute;
				pointer-events: none;
				transform: translateX(-50%);
				z-index: 4;
			}

			.aster-studio-day__create {
				align-items: center;
				background: rgba(255, 255, 255, 0.92);
				border: 1px solid rgba(36, 49, 60, 0.12);
				border-radius: 999px;
				box-shadow: 0 4px 10px rgba(28, 41, 49, 0.08);
				color: rgba(36, 49, 60, 0.55);
				cursor: pointer;
				display: inline-flex;
				font-size: 18px;
				font-weight: 500;
				height: 26px;
				justify-content: center;
				line-height: 1;
				opacity: 1;
				padding: 0;
				pointer-events: auto;
				transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
				width: 26px;
			}

			.aster-studio-day__create:hover {
				background: rgba(255, 255, 255, 1);
				color: rgba(157, 18, 255, 0.88);
				opacity: 1;
			}

			.aster-studio-horizon__bars {
				display: grid;
				gap: 6px 0;
				grid-template-columns: var(--day-columns, repeat(var(--day-count), minmax(var(--day-width, 64px), var(--day-width, 64px))));
				grid-template-rows: repeat(var(--lane-count), var(--lane-height, 74px));
				left: 0;
				padding: 36px 0 16px;
				pointer-events: none;
				position: absolute;
				right: 0;
				top: 0;
				z-index: 2;
			}

			.aster-studio-horizon__create-preview {
				align-items: center;
				background: linear-gradient(135deg, rgba(157, 18, 255, 0.16), rgba(157, 18, 255, 0.24));
				border: 1px dashed rgba(157, 18, 255, 0.58);
				border-radius: 14px;
				box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.26), 0 8px 20px rgba(157, 18, 255, 0.12);
				color: rgba(82, 12, 130, 0.96);
				display: none;
				justify-content: center;
				padding: 0 12px;
				pointer-events: none;
				position: absolute;
				z-index: 3;
			}

			.aster-studio-horizon__create-preview.is-active {
				display: flex;
			}

			.aster-studio-horizon__create-preview-label {
				font-size: 12px;
				font-weight: 700;
				line-height: 1;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
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
				align-self: start;
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
				min-height: 0;
				overflow: hidden;
				padding: 5px 8px 6px;
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
				align-items: flex-start;
				display: flex;
				flex-direction: column;
				gap: 1px;
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
				font-size: 10px;
				line-height: 1.1;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				position: relative;
			}

			.aster-studio-card__title {
				flex: 0 0 auto;
				font-size: 10px;
				font-weight: 700;
				min-width: 0;
				max-width: none;
				width: 100%;
			}

			.aster-studio-card__icon {
				display: inline-flex;
				margin-right: 6px;
				vertical-align: middle;
			}

			.aster-studio-card__subtitle {
				flex: 0 0 auto;
				min-width: 0;
				opacity: 0.95;
				text-align: left;
				width: 100%;
			}

			.aster-studio-card__segments {
				height: calc(var(--assignment-rows, 1) * 18px);
				margin-top: 1px;
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
				font-size: 8px;
				font-weight: 700;
				gap: 4px;
				height: 15px;
				left: var(--assignment-preview-left, var(--assignment-left));
				line-height: 1;
				min-width: 10px;
				padding: 0 4px;
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

			.aster-studio__absence-table-card.is-hide-leave-type .aster-studio__absence-table-row {
				grid-template-columns: minmax(0, 1.2fr) minmax(0, 2.1fr) minmax(90px, 0.7fr);
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

				.aster-studio__absence-table-card.is-hide-leave-type .aster-studio__absence-table-row {
					grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) minmax(90px, 0.7fr);
				}

				.aster-studio__hero {
					grid-template-columns: minmax(0, 1fr) auto;
				}

				.aster-studio__hero-actions {
					justify-content: flex-start;
				}

				.aster-studio__horizon-controls,
				.aster-studio__horizon-actions {
					justify-items: stretch;
					width: 100%;
				}

				.aster-studio__horizon-dates {
					grid-template-columns: 1fr;
				}
			}

			@media (max-width: 680px) {
				.aster-studio__metrics {
					grid-template-columns: 1fr;
				}

				.aster-studio__hero {
					grid-template-columns: 1fr;
				}

				.aster-studio__hero-toggle-wrap {
					justify-content: flex-start;
					padding-top: 0;
				}

				.aster-studio__task-type-row,
				.aster-studio__task-type-row.is-head {
					grid-template-columns: 1fr;
				}

				.aster-studio__dialog-capacity-row,
				.aster-studio__dialog-capacity-row.is-head,
				.aster-studio__capacity-table-row,
				.aster-studio__capacity-table-row.is-head,
				.aster-studio__absence-table-row,
				.aster-studio__absence-table-row.is-head {
					grid-template-columns: 1fr;
				}

				.aster-studio__dialog-capacity-action {
					justify-content: flex-start;
				}
			}
		</style>`).appendTo(document.head);
	}
};
