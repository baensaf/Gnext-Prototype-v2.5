package protocol

// Kitchen routing on the agent (§21, agent 2.5.0): the cloud sends an order once, and the agent
// decides which kitchen printers get which lines, lays out each chit and prints it.
const (
	TypeOrderPrint       = "order.print"
	TypeOrderPrintResult = "order.print.result"

	// CapabilityRoute is advertised in hello by an agent that routes kitchen chits itself.
	CapabilityRoute = "print.route"
)

// Routing is the branch's kitchen routing, sent in config.updated beside the printers (§21.2).
type Routing struct {
	Routes []Route `json:"routes"`
	// KitchenDefaultPrinterID takes a line no route covers; "" when the branch chose none.
	KitchenDefaultPrinterID string `json:"kitchen_default_printer_id,omitempty"`
	// WholeOrderPrinterIDs print every order whole, for the pass (printers in service only).
	WholeOrderPrinterIDs []string `json:"whole_order_printer_ids"`
}

// Route sends a category's or a product's lines to a printer. A nil printer is the branch's
// "not printed" list: no kitchen chit at all.
type Route struct {
	PrinterID  *string `json:"printer_id"`
	CategoryID string  `json:"category_id,omitempty"`
	ProductID  string  `json:"product_id,omitempty"`
}

// OrderPrint is the payload of order.print: one order's kitchen lines, or a change to them.
type OrderPrint struct {
	CommandBase
	// JobID is the cloud's print job that stands for the whole order until the agent answers.
	JobID   string      `json:"job_id"`
	OrderID string      `json:"order_id"`
	Heading ChitHeading `json:"heading"`
	Lines   []ChitLine  `json:"lines"`
	// KitchenChange is AMENDED or CANCELLED on a change to an order the kitchen already holds.
	KitchenChange string `json:"kitchen_change,omitempty"`
	ChangeReason  string `json:"change_reason,omitempty"`
}

// ChitHeading is what heads every chit of the order, already worded by the cloud.
type ChitHeading struct {
	// DisplayNumber is the number that prints large: the call number, else the order number's tail.
	DisplayNumber string `json:"display_number"`
	OrderNumber   string `json:"order_number"`
	// TypeLine is how the order leaves (salon, takeaway, Snappfood), in Persian.
	TypeLine string `json:"type_line"`
	// DateTime and Time are when it was placed (or changed), in the chain's calendar.
	DateTime   string `json:"date_time"`
	Time       string `json:"time"`
	OrderNotes string `json:"order_notes,omitempty"`
	// Template is COMPACT (the default) or DETAILED.
	Template string `json:"template,omitempty"`
}

// ChitLine is one line of the order as the kitchen reads it.
type ChitLine struct {
	LineID     string `json:"line_id"`
	ProductID  string `json:"product_id"`
	CategoryID string `json:"category_id,omitempty"`
	Name       string `json:"name"`
	Quantity   string `json:"quantity"`
	Options    string `json:"options,omitempty"`
	Note       string `json:"note,omitempty"`
	// Change is VOID or ADD on a change chit.
	Change string `json:"change,omitempty"`
	// SentTo is where a VOID line first printed: it goes there again whatever the routing says
	// now. Null routes it afresh; an empty list means it never printed, so it is left out.
	SentTo *[]string `json:"sent_to"`
}

// OrderPrintResult is the payload of order.print.result: one entry per chit.
type OrderPrintResult struct {
	JobID      string       `json:"job_id"`
	OrderID    string       `json:"order_id"`
	Chits      []ChitResult `json:"chits"`
	StartedAt  string       `json:"started_at"`
	FinishedAt string       `json:"finished_at"`
	// Error is set when the order was not routed at all, e.g. AGENT_RESTARTED; Chits is then empty.
	Error *Error `json:"error"`
}

// ChitResult is one chit: where it went, what it carried, and what the printer said.
type ChitResult struct {
	// PrinterID is "" for lines that had nowhere to print.
	PrinterID  string   `json:"printer_id"`
	Label      string   `json:"label"`
	WholeOrder bool     `json:"whole_order"`
	LineIDs    []string `json:"line_ids"`
	HTML       string   `json:"html"`
	// Status is SUCCESS or FAILED.
	Status string `json:"status"`
	Error  *Error `json:"error"`
}

// Codes for a chit the agent did not print (§21.4).
const (
	ErrUnrouted            = "UNROUTED"
	ErrPrinterOutOfService = "PRINTER_OUT_OF_SERVICE"
)
