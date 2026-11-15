#!/usr/bin/env python3
"""Dump mitmproxy flow dump -> JSONL summary (method/url/headers/body).

Usage:
  dump_flows.py <flows.mitm> [--full] [--out out.jsonl] [--filter substring]

Notes:
  * header values / paths may be bytes; coerced to text.
  * --full keeps complete request/response bodies (SSE streams included).
"""
import json
import sys
from mitmproxy import io as mio


def clean(s):
    if not isinstance(s, str):
        return s
    return s.encode("utf-8", "replace").decode("utf-8")


def totext(v):
    if isinstance(v, (bytes, bytearray)):
        return bytes(v).decode("utf-8", "replace")
    return v


def hdr_list(hs):
    out = []
    for k, v in hs.fields:
        out.append([totext(k), totext(v)])
    return out


def main():
    args = sys.argv[1:]
    path = args[0]
    full = "--full" in args
    out_path = None
    if "--out" in args:
        out_path = args[args.index("--out") + 1]
    flt = None
    if "--filter" in args:
        flt = args[args.index("--filter") + 1]

    recs = []
    with open(path, "rb") as f:
        for flow in mio.FlowReader(f).stream():
            if not hasattr(flow, "request"):
                continue
            req = flow.request
            body = req.get_text(strict=False) or ""
            url = totext(req.pretty_url)
            if flt and flt not in url:
                continue
            resp = flow.response
            rec = {
                "id": flow.id,
                "t": flow.request.timestamp_start,
                "scheme": totext(req.scheme),
                "host": totext(req.pretty_host),
                "method": totext(req.method),
                "path": totext(req.path),
                "url": url,
                "http_version": totext(req.http_version),
                "headers": hdr_list(req.headers),
                "body_len": len(req.raw_content or b""),
                "body": clean(body if full else body[:600]),
                "response": {
                    "status": resp.status_code if resp else None,
                    "headers": hdr_list(resp.headers) if resp else [],
                    "body_len": len(resp.raw_content or b"") if resp else 0,
                    "body": clean((resp.get_text(strict=False) or ""))
                    if (resp and full)
                    else (clean((resp.get_text(strict=False) or "")[:1000]) if resp else ""),
                },
            }
            recs.append(rec)

    if out_path:
        with open(out_path, "w") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {len(recs)} flows -> {out_path}")
    else:
        for r in recs:
            print(
                f"{r['method']:5s} {r['host']}{r['path'][:80]:70s} "
                f"req={r['body_len']:8d} res={r['response']['status']} reslen={r['response']['body_len']}"
            )


if __name__ == "__main__":
    main()
