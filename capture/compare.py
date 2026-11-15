#!/usr/bin/env python3
"""Side-by-side diff of the two captured Cloud Code sessions.

Inputs (all produced by dump_flows.py):
  cli-flows.jsonl        - `agy -p ...` (antigravity CLI 1.5.9)
  plugin-flows.jsonl     - dsh-antigravity plugin, content request only
  plugin-aux-flows.jsonl - dsh-antigravity plugin, refreshQuotaAndModelsForAccount()

Output: markdown to stdout (see REPORT.md for the analysis).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def flows(name):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def hdict(flow):
    return {k.lower(): v for k, v in flow["headers"]}


def body_of(flow):
    raw = flow.get("body") or ""
    try:
        return json.loads(raw)
    except Exception:
        return None


def content_flow(rows):
    for r in rows:
        if "streamGenerateContent" in r["url"]:
            return r
    return None


def redact(value):
    return value if not value.lower().startswith("bearer ") else f"Bearer <{len(value)} chars>"


def header_matrix(cli, plg):
    a, b = hdict(cli), hdict(plg)
    keys = sorted(set(a) | set(b))
    rows = []
    for k in keys:
        va, vb = a.get(k), b.get(k)
        rows.append((k, redact(va) if va is not None else "—", redact(vb) if vb is not None else "—"))
    return rows


def tools_summary(body):
    tools = body["request"].get("tools") or []
    decls = [d for t in tools for d in t.get("functionDeclarations", [])]
    return {
        "groups": len(tools),
        "decls": len(decls),
        "names": [d.get("name") for d in decls][:6],
        "schema_type_case": (decls[0]["parameters"]["type"] if decls and decls[0].get("parameters") else None),
    }


def summarize(flow):
    body = body_of(flow)
    req = body["request"]
    hdr = hdict(flow)
    return {
        "http_version": flow["http_version"],
        "url": flow["url"],
        "ua": hdr.get("user-agent", ""),
        "transfer_encoding": hdr.get("transfer-encoding"),
        "content_length": hdr.get("content-length"),
        "extra_headers": sorted(
            set(hdr) - {"host", "user-agent", "authorization", "content-type", "accept-encoding",
                        "content-length", "transfer-encoding", "connection"}
        ),
        "envelope_keys": list(body),
        "envelope_extra": {k: v for k, v in body.items() if k != "request"},
        "request_keys": list(req),
        "labels": req.get("labels"),
        "generation_config": req.get("generationConfig"),
        "system_instruction_chars": len(json.dumps(req.get("systemInstruction") or {}, ensure_ascii=False)),
        "contents_chars": len(json.dumps(req.get("contents") or [], ensure_ascii=False)),
        "contents_roles": [c.get("role") for c in req.get("contents") or []],
        "tools": tools_summary(body),
        "session_id": req.get("sessionId"),
        "response_status": flow["response"]["status"],
        "response_model_version": (json.loads(flow["response"]["body"].split("data: ", 1)[1].split("\n", 1)[0])["response"].get("modelVersion")
                                    if "data: " in flow["response"]["body"] else None),
        "prompt_tokens": (json.loads(flow["response"]["body"].split("data: ", 1)[1].split("\n", 1)[0])["response"]["usageMetadata"].get("promptTokenCount")
                          if "data: " in flow["response"]["body"] else None),
    }


IGNORED_HOSTS = {"github.com", "lh3.googleusercontent.com"}


def endpoint_stats(rows):
    stats = {}
    for r in rows:
        if r["host"] in IGNORED_HOSTS:
            stats.setdefault("(ignored: assets/avatar/github)", {"n": 0, "sizes": set()})["n"] += 1
            continue
        key = f'{r["method"]} {r["host"]}{r["path"].split("?")[0]}'
        e = stats.setdefault(key, {"n": 0, "sizes": set()})
        e["n"] += 1
        e["sizes"].add(r["body_len"])
    return stats


def main():
    cli_rows, plg_rows = flows("cli-flows.jsonl"), flows("plugin-flows.jsonl")
    aux_rows = flows("plugin-aux-flows.jsonl")
    cli, plg = content_flow(cli_rows), content_flow(plg_rows)
    a, b = summarize(cli), summarize(plg)

    out = []
    w = out.append
    w("# 抓包差异（机器生成）\n")
    w("## 1. 内容请求 summarise\n")
    for key in ("http_version", "url", "ua", "transfer_encoding", "content_length",
                "extra_headers", "envelope_keys", "request_keys", "contents_roles",
                "session_id", "response_status", "response_model_version", "prompt_tokens"):
        w(f"- **{key}**: CLI=`{json.dumps(a[key], ensure_ascii=False)}` | plugin=`{json.dumps(b[key], ensure_ascii=False)}`")

    w("\n## 2. 请求头矩阵\n")
    w("| header | CLI | plugin |")
    w("|---|---|---|")
    for k, va, vb in header_matrix(cli, plg):
        w(f"| `{k}` | {va} | {vb} |")

    w("\n## 3. envelope / labels / generationConfig\n")
    w("```json")
    w("// CLI envelope (request 之外的键)")
    w(json.dumps(a["envelope_extra"], indent=2, ensure_ascii=False))
    w("// plugin envelope")
    w(json.dumps(b["envelope_extra"], indent=2, ensure_ascii=False))
    w("// CLI labels")
    w(json.dumps(a["labels"], indent=2, ensure_ascii=False))
    w("// plugin labels")
    w(json.dumps(b["labels"], indent=2, ensure_ascii=False))
    w("// CLI generationConfig")
    w(json.dumps(a["generation_config"], indent=2, ensure_ascii=False))
    w("// plugin generationConfig")
    w(json.dumps(b["generation_config"], indent=2, ensure_ascii=False))
    w("```")

    w("\n## 4. tools\n")
    w(f"- CLI: groups={a['tools']['groups']} decls={a['tools']['decls']} first6={a['tools']['names']} type_case={a['tools']['schema_type_case']}")
    w(f"- plugin: groups={b['tools']['groups']} decls={b['tools']['decls']} first6={b['tools']['names']} type_case={b['tools']['schema_type_case']}")

    w("\n## 5. 端点矩阵（请求条数 / 请求体字节数）\n")
    cs, ps = endpoint_stats(cli_rows), endpoint_stats(plg_rows + aux_rows)
    w("| endpoint | CLI | plugin |")
    w("|---|---|---|")
    for key in sorted(set(cs) | set(ps)):
        def cell(e):
            if not e:
                return "—"
            sizes = sorted(e["sizes"])
            return f'{e["n"]}x / {sizes}'
        w(f"| `{key}` | {cell(cs.get(key))} | {cell(ps.get(key))} |")

    w("\n## 6. 同名端点的请求体对照\n")
    def bodies(rows):
        out = {}
        for r in rows:
            if r["host"] in IGNORED_HOSTS:
                continue
            path = r["path"].split("?")[0]
            body = (r.get("body") or "").strip()
            if r["method"] == "POST":
                out.setdefault(path, set()).add(body)
        return out
    cb, pb = bodies(cli_rows), bodies(plg_rows + aux_rows)
    w("（内容请求字段级差异见 REPORT.md §5；此处只列辅助端点）\n")
    for path in sorted((set(cb) & set(pb)) - {"/v1internal:streamGenerateContent"}):
        w(f"\n### `{path}`\n")
        w(f"- CLI: {sorted(cb[path])}")
        w(f"- plugin: {sorted(pb[path])}")

    print("\n".join(out))


if __name__ == "__main__":
    main()
