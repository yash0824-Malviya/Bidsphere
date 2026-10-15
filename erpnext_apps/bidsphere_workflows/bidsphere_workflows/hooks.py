app_name = "bidsphere_workflows"
app_title = "BidSphere Workflows"
app_publisher = "BidSphere"
app_description = "Atomic RFQ contract decisions using existing CLM records"
app_email = ""
app_license = "MIT"
required_apps = ["erpnext"]

doc_events = {
    "Request for Quotation": {
        "validate": "bidsphere_workflows.rfq_clm.guard_rfq",
        "before_update_after_submit": "bidsphere_workflows.rfq_clm.guard_rfq",
    },
    "Purchase Order": {
        "validate": "bidsphere_workflows.rfq_clm.guard_purchase_order",
        "before_submit": "bidsphere_workflows.rfq_clm.guard_purchase_order",
        "before_update_after_submit": "bidsphere_workflows.rfq_clm.guard_purchase_order",
    },
    "Contract": {
        "validate": "bidsphere_workflows.rfq_clm.guard_contract",
        "before_update_after_submit": "bidsphere_workflows.rfq_clm.guard_contract",
        "on_update": "bidsphere_workflows.rfq_clm.sync_contract",
        "on_update_after_submit": "bidsphere_workflows.rfq_clm.sync_contract",
        "on_cancel": "bidsphere_workflows.rfq_clm.sync_contract",
    },
    "Contract Request": {
        "validate": "bidsphere_workflows.rfq_clm.guard_request",
    },
    "Legal Document Review": {
        "validate": "bidsphere_workflows.rfq_clm.guard_award_state",
        "before_update_after_submit": "bidsphere_workflows.rfq_clm.guard_award_state",
    },
}
