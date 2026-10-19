package protocol

import "encoding/json"

// Live queries (§20, agent 2.5.0): the cloud's screens ask the agent something and wait for the
// answer, with nothing journaled on either side. A query that gets no answer is simply asked
// again by the person who pressed the button.
const (
	TypeAgentQuery       = "agent.query"
	TypeAgentQueryResult = "agent.query.result"

	// CapabilityQuery is advertised in hello by an agent that answers agent.query.
	CapabilityQuery = "agent.query"
)

// The queries an agent answers (§20.2).
const (
	// QueryScan finds hosts on the branch network that accept a connection on a port.
	QueryScan = "scan"
	// QueryLogs returns the agent's last log lines.
	QueryLogs = "logs"
	// QuerySettings reads this PC's settings and, with arguments, changes them.
	QuerySettings = "settings"
	// QueryAppRefresh checks the cloud for a newer app build now.
	QueryAppRefresh = "app.refresh"
)

// AgentQuery is the payload of agent.query.
type AgentQuery struct {
	CommandBase
	Query string          `json:"query"`
	Args  json.RawMessage `json:"args,omitempty"`
}

// AgentQueryResult is the payload of agent.query.result; its envelope's ref is the query's id.
type AgentQueryResult struct {
	OK    bool   `json:"ok"`
	Data  any    `json:"data,omitempty"`
	Error *Error `json:"error,omitempty"`
}
