app_name = "aster_production_planning"
app_title = "Aster Production Planning"
app_publisher = "Limendo"
app_description = "Plan High Level Production of Operations and Projects"
app_email = "rossano.longo@limendo.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "aster_production_planning",
# 		"logo": "/assets/aster_production_planning/logo.png",
# 		"title": "Aster Production Planning",
# 		"route": "/aster_production_planning",
# 		"has_permission": "aster_production_planning.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/aster_production_planning/css/aster_production_planning.css"
# app_include_js = "/assets/aster_production_planning/js/aster_production_planning.js"

# include js, css files in header of web template
# web_include_css = "/assets/aster_production_planning/css/aster_production_planning.css"
# web_include_js = "/assets/aster_production_planning/js/aster_production_planning.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "aster_production_planning/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "aster_production_planning/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "aster_production_planning.utils.jinja_methods",
# 	"filters": "aster_production_planning.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "aster_production_planning.install.before_install"
# after_install = "aster_production_planning.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "aster_production_planning.uninstall.before_uninstall"
# after_uninstall = "aster_production_planning.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "aster_production_planning.utils.before_app_install"
# after_app_install = "aster_production_planning.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "aster_production_planning.utils.before_app_uninstall"
# after_app_uninstall = "aster_production_planning.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "aster_production_planning.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"aster_production_planning.tasks.all"
# 	],
# 	"daily": [
# 		"aster_production_planning.tasks.daily"
# 	],
# 	"hourly": [
# 		"aster_production_planning.tasks.hourly"
# 	],
# 	"weekly": [
# 		"aster_production_planning.tasks.weekly"
# 	],
# 	"monthly": [
# 		"aster_production_planning.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "aster_production_planning.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "aster_production_planning.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "aster_production_planning.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "aster_production_planning.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["aster_production_planning.utils.before_request"]
# after_request = ["aster_production_planning.utils.after_request"]

# Job Events
# ----------
# before_job = ["aster_production_planning.utils.before_job"]
# after_job = ["aster_production_planning.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"aster_production_planning.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

