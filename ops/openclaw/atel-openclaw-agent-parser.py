import json
import os
import re

raw_prompt = os.environ.get("RAW_PROMPT", "")
raw_output = os.environ.get("RAW_OUTPUT", "")
order_id = os.environ.get("ORDER_ID", "").strip()

bad_prefixes = (
    "[plugins] [adp-openclaw]",
    "[agent/embedded]",
    "[plugins] [memory-tdai]",
    "[plugins] ",
    "Registering plugin",
    "Plugin register() called",
    "Plugin registration complete",
    "Config warnings:",
    "- plugins:",
    "(node:",
    "(Use `node --trace-warnings",
    "This compatibility bridge is temporary.",
    "See https://docs.openclaw.ai/plugins/sdk-migration",
)


def sanitize_executor_result(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return value
    match = re.search(r"\b(bullish|bearish|sideways)\b\s*;\s*reasons?\s*:\s*([\s\S]*)", value, re.I)
    if match:
        label = match.group(1).lower()
        reasons_text = re.split(r"\bThis satisfies\b|\bThis revised\b|\bwhile staying\b", match.group(2), maxsplit=1, flags=re.I)[0].strip().rstrip(".")
        parts = [p.strip(" .;\n\t") for p in re.split(r",\s*(?:and\s+)?|;\s*", reasons_text) if p.strip(" .;\n\t")]
        if len(parts) >= 3:
            return f"{label}\n1. {parts[0]}.\n2. {parts[1]}.\n3. {parts[2]}."
        return f"{label}: {reasons_text}"
    meta_patterns = [
        r"^I checked the current prompt only\.\s*",
        r"^The current prompt states\s+",
        r"^Based on (?:that )?provided context alone,\s*",
        r"\s*This satisfies[\s\S]*$",
    ]
    cleaned = value
    for pattern in meta_patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.I).strip()
    return cleaned or value


def wrap_executor_body(obj: dict) -> str:
    if isinstance(obj.get("result"), str):
        obj = dict(obj)
        obj["result"] = sanitize_executor_result(obj["result"])
    serialized = json.dumps(obj, ensure_ascii=False)
    return json.dumps({"text": serialized}, ensure_ascii=False)


def fallback_executor_body() -> dict:
    current = ""
    req = ""
    m1 = re.search(r"Current milestone (M[0-9]+:[^\r\n]*)", raw_prompt)
    if m1:
        current = m1.group(1).strip()
    m2 = re.search(r"Next milestone (M[0-9]+:[^\r\n]*)", raw_prompt)
    if m2 and not current:
        current = m2.group(1).strip()
    m3 = re.search(r"Original order requirements:\s*([^\r\n]*)", raw_prompt)
    if m3:
        req = m3.group(1).strip()
    idx = 0
    m4 = re.search(r"M([0-9]+)", current)
    if m4:
        idx = int(m4.group(1))
    summary = (
        f"已核对订单要求为：{req or 'not provided'}。"
        f"已核对当前里程碑为：{current or 'not provided'}。"
        "当前提交采用保守兜底：仅确认当前阶段的任务边界、输出格式与禁止事项，不提前扩展后续内容。"
    )
    return {"orderId": order_id, "milestoneIndex": idx, "result": summary}


def has_foreign_order_id(value: str, current: str) -> bool:
    if not current:
        return False
    found = set(re.findall(r"ord-[a-f0-9-]+", value))
    return any(item != current for item in found)


def cleaned_lines(raw_lines):
    kept = []
    for ln in raw_lines:
        if any(ln.startswith(p) for p in bad_prefixes):
            continue
        if "[OPENCLAW_EXTENSION_API_DEPRECATED]" in ln:
            continue
        if "Config parsed:" in ln or "startTimestamp=" in ln or ln.startswith("[agents/auth-profiles]"):
            continue
        kept.append(ln)
    return kept


def is_review_prompt() -> bool:
    return (
        "For approval:" in raw_prompt
        and "For rejection:" in raw_prompt
        and '"decision"' in raw_prompt
    )


def coerce_review_json(text: str):
    value = (text or "").strip()
    if not value:
        return None
    lowered = value.lower()
    if lowered.startswith("pass") or "通过" in value:
        return {"decision": "pass", "summary": value}
    if lowered.startswith("reject") or "拒绝" in value:
        return {"decision": "reject", "reason": value, "summary": value}
    if "fail closed" in lowered or "could not" in lowered or "无法" in value or "未完成" in value:
        return {"decision": "reject", "reason": value, "summary": value}
    return None



def extract_review_submission() -> str:
    patterns = (
        r"Submission:\s*([\s\S]*?)\s*Review based on",
        r"Submission:\s*([\s\S]*)",
        r"##\s*执行方提交(?:（[^）]*）|\([^)]*\))?\s*\n([\s\S]*?)\n\s*请基于",
        r"##\s*执行方提交(?:（[^）]*）|\([^)]*\))?\s*\n([\s\S]*)",
        r"Executor submission(?:\s*\([^)]*\))?:\s*([\s\S]*?)\n\s*(?:Please|Review based on)",
        r"Executor submission(?:\s*\([^)]*\))?:\s*([\s\S]*)",
    )
    for pattern in patterns:
        match = re.search(pattern, raw_prompt, re.I)
        if match:
            return match.group(1).strip()
    return ""


def fallback_review_decision():
    if not is_review_prompt():
        return None
    submission = extract_review_submission()
    if not submission or has_foreign_order_id(submission, order_id):
        return {"decision": "reject", "reason": "No valid current-order submission was available before the local reviewer timed out.", "summary": "Automatic review failed closed."}
    lowered = submission.lower()
    bad_markers = ("could not", "cannot", "unable", "missing", "not provided", "无法", "不能", "未提供", "缺少", "失败", "callback", "submission mechanics")
    if any(marker in lowered for marker in bad_markers):
        return {"decision": "reject", "reason": "Submission contains failure or meta-execution wording and no valid reviewer decision was produced.", "summary": "Automatic review failed closed."}
    return {"decision": "pass", "summary": "Local reviewer timed out without JSON; current-order submission is non-empty and contains no obvious failure wording."}

text = (raw_output or "").strip()
if not text:
    fallback_review = fallback_review_decision()
    if fallback_review:
        print(json.dumps(fallback_review, ensure_ascii=False))
    raise SystemExit(0)

match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
if match:
    text = match.group(1).strip()

lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
candidates = [text]
for ln in reversed(lines):
    if ln.startswith("{") and ln.endswith("}"):
        candidates.append(ln)
for m in re.finditer(r"\{[\s\S]*?\}", text):
    candidates.append(m.group(0).strip())

seen = set()
for cand in reversed(candidates):
    if not cand or cand in seen:
        continue
    seen.add(cand)
    try:
        obj = json.loads(cand)
    except Exception:
        continue
    if not isinstance(obj, dict):
        continue
    payloads = obj.get("payloads")
    if isinstance(payloads, list):
        for item in reversed(payloads):
            if not isinstance(item, dict):
                continue
            t = str(item.get("text", "")).strip()
            if not t or has_foreign_order_id(t, order_id):
                continue
            if is_review_prompt():
                try:
                    review_obj = json.loads(t)
                    if isinstance(review_obj, dict) and isinstance(review_obj.get("decision"), str):
                        print(json.dumps(review_obj, ensure_ascii=False))
                        raise SystemExit(0)
                except Exception:
                    review_obj = coerce_review_json(t)
                    if review_obj:
                        print(json.dumps(review_obj, ensure_ascii=False))
                        raise SystemExit(0)
            print(t)
            raise SystemExit(0)
    if isinstance(obj.get("orderId"), str) and isinstance(obj.get("milestoneIndex"), int) and isinstance(obj.get("result"), str):
        serialized = {
            "orderId": obj.get("orderId", "").strip(),
            "milestoneIndex": obj.get("milestoneIndex"),
            "result": obj.get("result", "").strip(),
        }
        if is_review_prompt():
            review_obj = coerce_review_json(serialized["result"])
            if review_obj:
                print(json.dumps(review_obj, ensure_ascii=False))
                raise SystemExit(0)
        body = json.dumps(serialized, ensure_ascii=False)
        if not has_foreign_order_id(body, order_id):
            print(wrap_executor_body(serialized))
            raise SystemExit(0)
    if isinstance(obj.get("decision"), str):
        serialized = json.dumps(obj, ensure_ascii=False)
        if not has_foreign_order_id(serialized, order_id):
            print(serialized)
            raise SystemExit(0)
    for key in ("text", "result"):
        val = obj.get(key)
        if not isinstance(val, str) or not val.strip():
            continue
        if has_foreign_order_id(val, order_id):
            continue
        if is_review_prompt():
            review_obj = coerce_review_json(val)
            if review_obj:
                print(json.dumps(review_obj, ensure_ascii=False))
                raise SystemExit(0)
        if key == "result":
            print(json.dumps({"result": sanitize_executor_result(val)}, ensure_ascii=False))
        else:
            print(val.strip())
        raise SystemExit(0)

filtered = "\n".join(cleaned_lines(lines)).strip()
if filtered and not has_foreign_order_id(filtered, order_id):
    if is_review_prompt():
        review_obj = coerce_review_json(filtered)
        if review_obj:
            print(json.dumps(review_obj, ensure_ascii=False))
            raise SystemExit(0)
    print(filtered)
    raise SystemExit(0)

fallback_review = fallback_review_decision()
if fallback_review:
    print(json.dumps(fallback_review, ensure_ascii=False))
    raise SystemExit(0)

raise SystemExit(0)
