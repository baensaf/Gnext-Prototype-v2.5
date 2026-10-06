/**
 * Whether this copy of the app is served by a branch agent (agent-protocol.md §19.7, §19.9).
 *
 * The agent injects, right after `<head>` of index.html:
 *   <meta name="gnext-agent" content='{"version":"2.1.0","cloud_url":"https://gnext.top","lan":false}'>
 * The cloud's own copy has no such tag, so `agentMode` is null there and nothing in agent mode
 * runs. Content that is missing or cannot be read counts as "not an agent", never as an error.
 */

export interface AgentMode {
  /** The agent's version. */
  version: string;
  /** The cloud frontend's origin, where the pages the agent does not serve open. */
  cloud_url: string;
  /** True on the agent's LAN listener: a register that is not the branch PC itself. */
  lan: boolean;
}

/** The meta tag's `content`, read as an AgentMode. Null for anything that is not one. */
export function parseAgentMeta(content: string | null | undefined): AgentMode | null {
  if (!content) return null;
  try {
    const data: unknown = JSON.parse(content);
    if (typeof data !== 'object' || data === null) return null;
    const { version, cloud_url: cloudUrl, lan } = data as Record<string, unknown>;
    if (typeof cloudUrl !== 'string') return null;
    // The link out needs a place to go. Only http(s), and only the origin: the path comes from
    // the page being left.
    const url = new URL(cloudUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {
      version: typeof version === 'string' ? version : '',
      cloud_url: url.origin,
      lan: lan === true,
    };
  } catch {
    return null;
  }
}

function readAgentMode(): AgentMode | null {
  try {
    const meta = document.querySelector('meta[name="gnext-agent"]');
    return parseAgentMeta(meta?.getAttribute('content'));
  } catch {
    return null;
  }
}

/** Null outside the agent, else what the agent said about itself. Read once, at load. */
export const agentMode: AgentMode | null = readAgentMode();
