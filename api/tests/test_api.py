"""FastAPI 裁决：正常联调、422/INVALID_INPUT、422/DIFF_LIMIT、重放自检。"""

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_DISTANCE, app

client = TestClient(app)


def code_of(resp):
    return resp.json()["detail"]["code"]


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_basic_diff_payload():
    resp = client.post("/diff", json={"source": [1, 2, 3], "target": [1, 4, 3]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["distance"] == 2
    assert data["length_source"] == 3 and data["length_target"] == 3
    ops = [(r["type"], r["source"], r["target"], r["value"]) for r in data["alignment"]]
    assert ops == [
        ("keep", 0, 0, 1),
        ("insert", None, 1, 4),
        ("delete", 1, None, 2),
        ("keep", 2, 2, 3),
    ]


def test_empty_arrays():
    resp = client.post("/diff", json={"source": [], "target": []})
    assert resp.status_code == 200
    assert resp.json()["distance"] == 0


def test_zero_based_indices_present():
    resp = client.post("/diff", json={"source": [7], "target": [8]})
    data = resp.json()
    # 平局裁决选删除前驱：insert 在前、delete 在后，下标均从零开始。
    assert [r["source"] for r in data["alignment"]] == [None, 0]
    assert [r["target"] for r in data["alignment"]] == [0, None]


@pytest.mark.parametrize(
    "payload",
    [
        {"source": [1, 2.5], "target": []},          # 非整数（浮点）
        {"source": [1, "2"], "target": []},           # 字符串
        {"source": [True], "target": []},             # 布尔不能当整数
        {"source": [None], "target": []},             # null
        {"source": [2_147_483_648], "target": []},    # 越上界
        {"source": [-1], "target": []},               # 越下界
        {"source": "123", "target": []},              # 不是数组
        {"source": {}, "target": []},
        {"target": []},                                # 缺 source
        {"source": [1, None], "target": [{}]},
    ],
)
def test_invalid_input_422(payload):
    resp = client.post("/diff", json=payload)
    assert resp.status_code == 422
    assert code_of(resp) == "INVALID_INPUT"


def test_too_many_items_422():
    resp = client.post("/diff", json={"source": [0] * 20_001, "target": []})
    assert resp.status_code == 422
    assert code_of(resp) == "INVALID_INPUT"


def test_malformed_json_422():
    resp = client.post(
        "/diff", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422
    assert code_of(resp) == "INVALID_INPUT"


def test_boundary_values_accepted():
    resp = client.post(
        "/diff",
        json={"source": [0, 2_147_483_647], "target": [0, 2_147_483_647]},
    )
    assert resp.status_code == 200
    assert resp.json()["distance"] == 0


def test_diff_limit_422():
    resp = client.post(
        "/diff", json={"source": [1] * 401, "target": [2] * 401}
    )
    assert resp.status_code == 422
    assert code_of(resp) == "DIFF_LIMIT"
    assert str(MAX_DISTANCE) in resp.json()["detail"]["message"]


def test_distance_exactly_at_limit_ok():
    resp = client.post("/diff", json={"source": [1] * 400, "target": [2] * 400})
    assert resp.status_code == 200
    assert resp.json()["distance"] == 800


def test_20000_items_small_diff_runs_without_matrix_blowup():
    a = list(range(20_000))
    b = list(a)
    b[1000] = 2_000_000_001
    resp = client.post("/diff", json={"source": a, "target": b})
    assert resp.status_code == 200
    data = resp.json()
    assert data["distance"] == 2
