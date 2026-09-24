package localui

import (
	"net/http"

	"gnext/agent/internal/till"
)

// asCashier runs an order request for the signed-in cashier and answers with what it returns.
func (s *Server) asCashier(w http.ResponseWriter, r *http.Request, body any, do func(t *till.Till, u till.User) (any, error)) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	u, ok := s.tillUser(w, r, t)
	if !ok {
		return
	}
	if body != nil && !readJSON(w, r, body) {
		return
	}
	out, err := do(t, u)
	if err != nil {
		tillError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type orderInfo struct {
	OrderType  string `json:"order_type"`
	TableID    string `json:"table_id"`
	GuestCount int    `json:"guest_count"`
}

type approval struct {
	ApproverID string `json:"approver_id"`
	PIN        string `json:"pin"`
	Note       string `json:"note"`
}

func order(o *till.Order, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return map[string]any{"order": o}, nil
}

func (s *Server) tillOrders(w http.ResponseWriter, r *http.Request) {
	s.asCashier(w, r, nil, func(t *till.Till, _ till.User) (any, error) {
		list, err := t.Orders()
		return map[string]any{"orders": list}, err
	})
}

func (s *Server) tillNewOrder(w http.ResponseWriter, r *http.Request) {
	var in orderInfo
	s.asCashier(w, r, &in, func(t *till.Till, u till.User) (any, error) {
		return order(t.NewOrder(u, in.OrderType, in.TableID, in.GuestCount))
	})
}

// tillPlace starts an order with its lines and sends it to the kitchen, all of it or nothing.
func (s *Server) tillPlace(w http.ResponseWriter, r *http.Request) {
	var in till.PlaceInput
	s.asCashier(w, r, &in, func(t *till.Till, u till.User) (any, error) {
		return order(t.Place(u, in))
	})
}

func (s *Server) tillOrder(w http.ResponseWriter, r *http.Request) {
	s.asCashier(w, r, nil, func(t *till.Till, _ till.User) (any, error) {
		return order(t.Order(r.PathValue("id")))
	})
}

func (s *Server) tillOrderInfo(w http.ResponseWriter, r *http.Request) {
	var in orderInfo
	s.asCashier(w, r, &in, func(t *till.Till, _ till.User) (any, error) {
		return order(t.SetInfo(r.PathValue("id"), in.OrderType, in.TableID, in.GuestCount))
	})
}

func (s *Server) tillAddLine(w http.ResponseWriter, r *http.Request) {
	var in till.LineInput
	s.asCashier(w, r, &in, func(t *till.Till, u till.User) (any, error) {
		return order(t.AddLine(r.PathValue("id"), u, in))
	})
}

func (s *Server) tillLineQuantity(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Quantity int `json:"quantity"`
	}
	s.asCashier(w, r, &in, func(t *till.Till, _ till.User) (any, error) {
		return order(t.SetQuantity(r.PathValue("id"), r.PathValue("line"), in.Quantity))
	})
}

func (s *Server) tillVoidLine(w http.ResponseWriter, r *http.Request) {
	var in approval
	s.asCashier(w, r, &in, func(t *till.Till, u till.User) (any, error) {
		return order(t.VoidLine(r.PathValue("id"), r.PathValue("line"), u, in.ApproverID, in.PIN))
	})
}

func (s *Server) tillSend(w http.ResponseWriter, r *http.Request) {
	s.asCashier(w, r, nil, func(t *till.Till, u till.User) (any, error) {
		return order(t.Send(r.PathValue("id"), u))
	})
}

// tillPay takes cash, answering with the change, or starts a card charge, answering 202 at once;
// the page then follows the order until the charge ends (§13.7).
func (s *Server) tillPay(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind     string `json:"kind"`
		Tendered string `json:"tendered"`
		Amount   string `json:"amount"`
	}
	t := s.theTill(w)
	if t == nil {
		return
	}
	u, ok := s.tillUser(w, r, t)
	if !ok || !readJSON(w, r, &in) {
		return
	}
	id := r.PathValue("id")
	switch in.Kind {
	case "CASH":
		o, change, err := t.PayCash(id, u, in.Tendered)
		if err != nil {
			tillError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"order": o, "change": change})
	case "CARD":
		o, paymentID, err := t.PayCard(id, u, in.Amount)
		if err != nil {
			tillError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"order": o, "payment_id": paymentID})
	default:
		fail(w, http.StatusBadRequest, till.CodeInvalid, "نوع پرداخت باید نقد یا کارت باشد.")
	}
}

// tillPrint prints a document on request, or reprints one ticket (§13.8); it answers with the
// tickets queued, which the order then shows printed or failed.
func (s *Server) tillPrint(w http.ResponseWriter, r *http.Request) {
	var in till.PrintInput
	s.asCashier(w, r, &in, func(t *till.Till, _ till.User) (any, error) {
		prints, err := t.PrintDocument(r.PathValue("id"), in)
		return map[string]any{"prints": prints}, err
	})
}

// tillPrinters are the printers a ticket can be sent to by hand.
func (s *Server) tillPrinters(w http.ResponseWriter, r *http.Request) {
	s.asCashier(w, r, nil, func(t *till.Till, _ till.User) (any, error) {
		return map[string]any{"printers": t.PrintersFor()}, nil
	})
}

func (s *Server) tillFinish(w http.ResponseWriter, r *http.Request) {
	s.asCashier(w, r, nil, func(t *till.Till, u till.User) (any, error) {
		return order(t.Finish(r.PathValue("id"), u))
	})
}

// tillCancel answers `order: null, dropped: true` for a cart the kitchen never had.
func (s *Server) tillCancel(w http.ResponseWriter, r *http.Request) {
	var in approval
	s.asCashier(w, r, &in, func(t *till.Till, u till.User) (any, error) {
		o, err := t.Cancel(r.PathValue("id"), u, in.Note, in.ApproverID, in.PIN)
		if err != nil {
			return nil, err
		}
		return map[string]any{"order": o, "dropped": o == nil}, nil
	})
}

// tillHandover ends HANDOVER now (§13.5).
func (s *Server) tillHandover(w http.ResponseWriter, r *http.Request) {
	s.asCashier(w, r, nil, func(t *till.Till, _ till.User) (any, error) {
		dropped, handed, err := t.Handover()
		return map[string]any{"dropped": dropped, "handed": handed}, err
	})
}
