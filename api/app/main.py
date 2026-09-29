"""FastAPI 入口：只接收普通 JSON 整数数组，无数据库。"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .blocks import mixed_replay, split_blocks
from .myers import bounded_myers, replay

MAX_ITEMS = 20_000
MAX_VALUE = 2_147_483_647
MAX_DISTANCE = 800

ShotId = Annotated[int, Field(strict=True, ge=0, le=MAX_VALUE)]


class DiffRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")

    source: list[ShotId] = Field(max_length=MAX_ITEMS)
    target: list[ShotId] = Field(max_length=MAX_ITEMS)


class AlignmentRowOut(BaseModel):
    type: Literal["keep", "delete", "insert"]
    source: int | None
    target: int | None
    value: int


class DiffResponse(BaseModel):
    distance: int
    length_source: int
    length_target: int
    alignment: list[AlignmentRowOut]


app = FastAPI(title="shot-diff", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def handle_invalid_input(_request, exc: RequestValidationError):
    # 越界、非整数、超长、结构错误一律归一为 422 INVALID_INPUT。
    issues = [
        {"loc": list(err["loc"]), "type": err["type"]}
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "INVALID_INPUT",
                "message": (
                    "source/target 必须是 0 至 2147483647 的整数数组，"
                    "每组至多 20000 项"
                ),
                "issues": issues,
            }
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/diff", response_model=DiffResponse)
def diff(body: DiffRequest):
    result = bounded_myers(body.source, body.target, max_d=MAX_DISTANCE)
    if result is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "DIFF_LIMIT",
                "message": f"编辑距离超过 {MAX_DISTANCE} 的搜索上限",
            },
        )

    distance, rows = result
    alignment: list[AlignmentRowOut] = []
    for op, s, t in rows:
        if op == "keep":
            assert s is not None and t is not None
            alignment.append(
                AlignmentRowOut(type="keep", source=s, target=t, value=body.source[s])
            )
        elif op == "delete":
            assert s is not None
            alignment.append(
                AlignmentRowOut(
                    type="delete", source=s, target=None, value=body.source[s]
                )
            )
        else:
            assert t is not None
            alignment.append(
                AlignmentRowOut(
                    type="insert", source=None, target=t, value=body.target[t]
                )
            )

    # 服务端自检：轨迹重放必须精确得到目标序列。
    if replay(body.source, body.target, rows) != body.target:
        raise HTTPException(status_code=500, detail="ALIGNMENT_REPLAY_FAILED")

    # 分块重放自检：一块不选必须精确等于 source，全部选中必须精确等于 target；
    # 块编号与源/目标跨度由对齐稳定确定（见 app/blocks.py）。
    blocks = split_blocks(rows, len(body.source), len(body.target))
    if mixed_replay(body.source, body.target, rows, frozenset(), blocks) != body.source:
        raise HTTPException(status_code=500, detail="MIXED_REPLAY_SOURCE_FAILED")
    all_ids = frozenset(blk.id for blk in blocks)
    if mixed_replay(body.source, body.target, rows, all_ids, blocks) != body.target:
        raise HTTPException(status_code=500, detail="MIXED_REPLAY_TARGET_FAILED")

    return DiffResponse(
        distance=distance,
        length_source=len(body.source),
        length_target=len(body.target),
        alignment=alignment,
    )
