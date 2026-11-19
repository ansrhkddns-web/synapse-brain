"""바깥 일 신호 남기기 (파이썬) — 두뇌 화면에 단계·진행률을 띄운다. lib/external.mjs 규약, scripts/beat.mjs와 같다.

    import sys; sys.path.insert(0, r"<설치 폴더>\\app\\scripts")
    from brainbeat import beat, stop_requested
    for i, line in enumerate(lines):
        if stop_requested("W-261101-005"): break          # 화면의 중지 버튼
        ...
        beat("W-261101-005", step="번역", done=i + 1, total=len(lines), unit="줄", line=line[:80])
    beat("W-261101-005", finished=True)

신호는 자주 불러도 되지만 2초에 한 번만 실제로 쓴다(마지막 줄·finished는 바로).
"""
import json
import os
import time
from datetime import datetime, timezone

EXTERNAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "external")
_last = {}


def _now():
    return datetime.now(timezone.utc).isoformat()


def beat(task_id, every=2.0, **fields):
    t = time.monotonic()
    done, total = fields.get("done"), fields.get("total")
    last_one = done is not None and total is not None and done >= total
    if not fields.get("finished") and not last_one and t - _last.get(task_id, 0) < every:
        return
    _last[task_id] = t
    os.makedirs(EXTERNAL, exist_ok=True)
    path = os.path.join(EXTERNAL, f"{task_id}.json")
    try:
        with open(path, encoding="utf-8-sig") as f:
            cur = json.load(f)
    except (OSError, ValueError):
        cur = {}
    if cur.get("finished") and not fields.get("finished"):
        cur = {}
    cur.update({k: v for k, v in fields.items() if v is not None})
    cur["beat"] = _now()
    cur.setdefault("startedAt", cur["beat"])
    cur.setdefault("pid", os.getpid())
    cur.setdefault("stop", os.path.join(EXTERNAL, f"{task_id}.stop"))
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False)
    os.replace(tmp, path)


def stop_requested(task_id):
    """화면에서 중지를 눌렀으면 True (멈춤 파일을 지우고 돌려준다)."""
    p = os.path.join(EXTERNAL, f"{task_id}.stop")
    if os.path.exists(p):
        try:
            os.remove(p)
        except OSError:
            pass
        return True
    return False
