import type { ConfiguratorSiteToolsStatus } from "../webmcp/configurator-tools";

function statusLabel(status: ConfiguratorSiteToolsStatus) {
  if (status.state === "ready") return `${status.toolNames.length} agent tools`;
  if (status.state === "unsupported") return "Manual mode";
  if (status.state === "degraded") return "Agent unavailable";
  return "Connecting agent";
}

/**
 * Whether this page's WebMCP tools reached an agent.
 *
 * The page no longer draws a status chip for this (it sat in the removed top
 * bar). It is a polite live region instead, so assistive technology still
 * hears "Manual mode" become "17 agent tools" when a host injects the API.
 */
export function ToolStatus({ status }: { status: ConfiguratorSiteToolsStatus }) {
  return (
    <p className="visually-hidden" role="status" aria-live="polite" data-tool-state={status.state}>
      {statusLabel(status)}
    </p>
  );
}
