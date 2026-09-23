// Package protocol holds the wire types of the branch agent protocol v1
// (docs/agent-gateway/agent-protocol.md).
package protocol

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Version is the only protocol version this agent speaks.
const Version = 1

// TimeFormat is RFC 3339 in UTC with milliseconds (§2.1).
const TimeFormat = "2006-01-02T15:04:05.000Z"

// Message types (§5.1).
const (
	TypeHello         = "hello"
	TypeWelcome       = "welcome"
	TypeHeartbeat     = "heartbeat"
	TypeHeartbeatAck  = "heartbeat.ack"
	TypeAck           = "ack"
	TypeError         = "error"
	TypeConfigUpdated = "config.updated"
	TypePrintJob      = "print.job"
	TypePrintResult   = "print.result"
	TypePaymentCharge = "payment.charge"
	TypePaymentQuery  = "payment.query"
	TypePaymentResult = "payment.result"
	TypeDeviceStatus  = "device.status"
	TypeCheckUpdate   = "agent.check_update"
	TypeDataChanged   = "data.changed"
)

// Capabilities this build advertises in hello.
var Capabilities = []string{"print.html", "payment.charge", "payment.query", "data.pull"}

// Ack and envelope error codes (§8.1).
const (
	ErrBadMessage          = "BAD_MESSAGE"
	ErrNotReady            = "NOT_READY"
	ErrUnknownType         = "UNKNOWN_TYPE"
	ErrInvalidPayload      = "INVALID_PAYLOAD"
	ErrUnsupported         = "UNSUPPORTED"
	ErrDeviceNotConfigured = "DEVICE_NOT_CONFIGURED"
	ErrExpired             = "EXPIRED"
	ErrInternal            = "INTERNAL"
)

// Device error codes (§8.3).
const (
	ErrPrinterUnreachable  = "PRINTER_UNREACHABLE"
	ErrPrinterOffline      = "PRINTER_OFFLINE"
	ErrPaperOut            = "PAPER_OUT"
	ErrCoverOpen           = "COVER_OPEN"
	ErrPrinterError        = "PRINTER_ERROR"
	ErrRenderFailed        = "RENDER_FAILED"
	ErrTimeout             = "TIMEOUT"
	ErrAgentRestarted      = "AGENT_RESTARTED"
	ErrTerminalUnreachable = "TERMINAL_UNREACHABLE"
	ErrTerminalBusy        = "TERMINAL_BUSY"
	ErrDeclined            = "DECLINED"
	ErrCancelledByUser     = "CANCELLED_BY_USER"
	ErrConnectionLost      = "CONNECTION_LOST"
	ErrBadResponse         = "BAD_RESPONSE"
	ErrQueryUnsupported    = "QUERY_UNSUPPORTED"
)

// Close codes (§4.9).
const (
	CloseHandshakeTimeout    = 4000
	CloseAgentKeyInvalid     = 4001
	CloseAgentRevoked        = 4003
	CloseReplaced            = 4008
	CloseProtocolUnsupported = 4010
	CloseUpgradeRequired     = 4011
	CloseRateLimited         = 4029
)

// Envelope wraps every WebSocket frame (§4.1).
type Envelope struct {
	V       int             `json:"v"`
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	TS      string          `json:"ts"`
	Ref     string          `json:"ref,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

// Now formats t as a protocol timestamp.
func Now(t time.Time) string { return t.UTC().Format(TimeFormat) }

// New builds an envelope with a fresh v4 id.
func New(typ, ref string, payload any) (Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{V: Version, ID: uuid.NewString(), Type: typ, TS: Now(time.Now()), Ref: ref, Payload: raw}, nil
}

// IsCommand reports whether a cloud → agent type asks for work.
func IsCommand(typ string) bool {
	switch typ {
	case TypeConfigUpdated, TypePrintJob, TypePaymentCharge, TypePaymentQuery, TypeCheckUpdate, TypeDataChanged:
		return true
	}
	return false
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message,omitempty"`
	Detail  any    `json:"detail,omitempty"`
}

type Ack struct {
	OK    bool   `json:"ok"`
	Error *Error `json:"error,omitempty"`
}

type Hello struct {
	AgentVersion     string         `json:"agent_version"`
	ProtocolVersions []int          `json:"protocol_versions"`
	Capabilities     []string       `json:"capabilities"`
	StartedAt        string         `json:"started_at"`
	Devices          []DeviceStatus `json:"devices"`
	UnackedResults   int            `json:"unacked_results"`
}

type Welcome struct {
	ProtocolVersion    int    `json:"protocol_version"`
	SessionID          string `json:"session_id"`
	ServerTime         string `json:"server_time"`
	HeartbeatIntervalS int    `json:"heartbeat_interval_s"`
	Branch             struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"branch"`
	Config *Config `json:"config"`
	Update *struct {
		Available bool   `json:"available"`
		Version   string `json:"version"`
	} `json:"update"`
}

type Heartbeat struct {
	InFlight       int `json:"in_flight"`
	UnackedResults int `json:"unacked_results"`
}

type HeartbeatAck struct {
	ServerTime string `json:"server_time"`
}

// Config is the branch hardware list (§6.1).
type Config struct {
	ConfigVersion int        `json:"config_version"`
	Printers      []Printer  `json:"printers"`
	Terminals     []Terminal `json:"terminals"`
}

// Connection says how the agent reaches a device. `port` is a number for tcp and a string
// ("COM3") for serial, so it stays raw.
type Connection struct {
	Kind        string          `json:"kind"`
	PrinterName string          `json:"printer_name,omitempty"`
	Host        string          `json:"host,omitempty"`
	Port        json.RawMessage `json:"port,omitempty"`
	Baud        int             `json:"baud,omitempty"`
}

// TCPPort returns the numeric port of a tcp connection, or 0.
func (c *Connection) TCPPort() int {
	var n int
	if c == nil || json.Unmarshal(c.Port, &n) != nil {
		return 0
	}
	return n
}

type Printer struct {
	ID           string      `json:"id"`
	Code         string      `json:"code"`
	Name         string      `json:"name"`
	Type         string      `json:"type"`
	PaperWidthMM int         `json:"paper_width_mm"`
	Active       bool        `json:"active"`
	Connection   *Connection `json:"connection"`
}

type Terminal struct {
	ID             string      `json:"id"`
	Code           string      `json:"code"`
	Name           string      `json:"name"`
	Active         bool        `json:"active"`
	Driver         *string     `json:"driver"`
	Connection     *Connection `json:"connection"`
	ChargeTimeoutS int         `json:"charge_timeout_s"`
}

// CommandBase holds the fields every command payload carries (§5.2).
type CommandBase struct {
	ExpiresAt string `json:"expires_at"`
}

type PrintJob struct {
	CommandBase
	JobID        string `json:"job_id"`
	AttemptNo    int    `json:"attempt_no"`
	PrinterID    string `json:"printer_id"`
	DocumentType string `json:"document_type"`
	Label        string `json:"label"`
	Copies       int    `json:"copies"`
	Content      struct {
		Format string `json:"format"`
		HTML   string `json:"html"`
	} `json:"content"`
}

type PrintResult struct {
	JobID         string `json:"job_id"`
	AttemptNo     int    `json:"attempt_no"`
	PrinterID     string `json:"printer_id"`
	Status        string `json:"status"`
	CopiesPrinted int    `json:"copies_printed"`
	StartedAt     string `json:"started_at"`
	FinishedAt    string `json:"finished_at"`
	Error         *Error `json:"error"`
}

type PaymentCharge struct {
	CommandBase
	PaymentID     string `json:"payment_id"`
	AttemptID     string `json:"attempt_id"`
	AttemptNo     int    `json:"attempt_no"`
	TerminalID    string `json:"terminal_id"`
	Amount        string `json:"amount"`
	Currency      string `json:"currency"`
	OrderNumber   string `json:"order_number"`
	PaymentNumber string `json:"payment_number"`
	TimeoutS      int    `json:"timeout_s"`
}

type PaymentQuery struct {
	CommandBase
	PaymentID  string `json:"payment_id"`
	AttemptID  string `json:"attempt_id"`
	TerminalID string `json:"terminal_id"`
	Amount     string `json:"amount"`
	SentAt     string `json:"sent_at"`
}

// Payment result statuses (§7.4).
const (
	PayApproved  = "APPROVED"
	PayDeclined  = "DECLINED"
	PayCancelled = "CANCELLED"
	PayFailed    = "FAILED"
	PayUnknown   = "UNKNOWN"
)

type PaymentResult struct {
	PaymentID        string `json:"payment_id"`
	AttemptID        string `json:"attempt_id"`
	TerminalID       string `json:"terminal_id"`
	Status           string `json:"status"`
	Amount           string `json:"amount,omitempty"`
	RRN              string `json:"rrn,omitempty"`
	STAN             string `json:"stan,omitempty"`
	AuthCode         string `json:"auth_code,omitempty"`
	TerminalSerial   string `json:"terminal_serial,omitempty"`
	CardPANMasked    string `json:"card_pan_masked,omitempty"`
	BankResponseCode string `json:"bank_response_code,omitempty"`
	StartedAt        string `json:"started_at"`
	FinishedAt       string `json:"finished_at"`
	Error            *Error `json:"error"`
}

// Device statuses (§6.3).
const (
	DeviceOnline      = "ONLINE"
	DeviceOffline     = "OFFLINE"
	DeviceError       = "ERROR"
	DeviceUnsupported = "UNSUPPORTED"
	DeviceUnknown     = "UNKNOWN"
)

type DeviceStatus struct {
	Kind      string  `json:"kind"`
	ID        string  `json:"id"`
	Status    string  `json:"status"`
	Detail    *string `json:"detail"`
	CheckedAt string  `json:"checked_at,omitempty"`
}

type DeviceStatusEvent struct {
	Devices []DeviceStatus `json:"devices"`
}
