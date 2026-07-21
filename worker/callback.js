// Job status reporting -> Optomole API Gateway.
//
// Contract is defined by the gateway's WorkersController:
//   POST {callbackUrl}                         (callbackUrl is carried on each job)
//   headers: Authorization: Bearer <token>
//   body:    { jobId, status: 'succeeded' | 'failed',
//              workerId?, artifactUrl?, launchUrl?, storageKey?, error?, metadata? }
//
// The endpoint only accepts terminal states (succeeded/failed), so that is all
// the worker reports. The gateway already marks the job 'queued'/'running' when
// it dispatches. Uses Node 18+ global fetch (no dependency).

export async function reportStatus(callbackUrl, token, payload) {
  if (!callbackUrl) {
    console.warn(`[callback] no callbackUrl for job ${payload.jobId} — status not reported`);
    return { ok: false, skipped: true };
  }

  const res = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`callback ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return { ok: true };
}

export function reportSucceeded(callbackUrl, token, fields) {
  return reportStatus(callbackUrl, token, { status: "succeeded", ...fields });
}

export function reportFailed(callbackUrl, token, { jobId, workerId, error }) {
  return reportStatus(callbackUrl, token, {
    jobId,
    workerId,
    status: "failed",
    error: String(error).slice(0, 1000),
  });
}
