"""FastAPI 入口：只接收普通 JSON 整数数组，无数据库。"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .blocks import mixed_replay, split_blocks
from .myers import CONSTRAINED_MAX_ITEMS, bounded_myers, constrained_shortest, replay

MAX_ITEMS = 20_000
MAX_VALUE = 2_147_483_647
MAX_DISTANCE = 800

ShotId = Annotated[int, Field(strict=True, ge=0, le=MAX_VALUE)]


class DiffRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")

    source: list[ShotId] = Field(max_length=MAX_ITEMS)
    target: list[ShotId] = Field(max_length=MAX_ITEMS)
    # 缺省即旧接口；启用后只允许 1–3，并使用该模式独立的规模边界。
    max_consecutive_deletes: int | None = None

    @model_validator(mode="after")
    def constrained_size_limit(self):
        limit = self.max_consecutive_deletes
        if limit is not None:
            # strict 模型不会把布尔收窄为 int；显式拦截可确保 1–3 的语义。
            if not isinstance(limit, int) or not 1 <= limit <= 3:
                raise ValueError("max_consecutive_deletes 必须为 1、2 或 3")
            if len(self.source) > CONSTRAINED_MAX_ITEMS or len(
                self.target
            ) > CONSTRAINED_MAX_ITEMS:
                raise ValueError(
                    f"连续删除限制模式下 source/target 每组至多 {CONSTRAINED_MAX_ITEMS} 项"
                )
        return self


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
    # 旧模式不输出该字段；约束模式回传本次脚本版本所用的限制。
    max_consecutive_deletes: int | None = None


app = FastAPI(title="shot-diff", version="1.1.0")

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
                    f"每组至多 {MAX_ITEMS} 项；启用连续删除限制时每组至多 "
                    f"{CONSTRAINED_MAX_ITEMS} 项，限制值必须为 1、2 或 3"
                ),
                "issues": issues,
            }
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/diff")
def diff(body: DiffRequest):
    if body.max_consecutive_deletes is None:
        result = bounded_myers(body.source, body.target, max_d=MAX_DISTANCE)
        limit_reached = result is None
    else:
        # 约束已包含在状态 (x,y,当前连续删除长度) 中：直接求受约束最短脚本，
        # 不是先生成无约束最短脚本再检查或返工。
        result = constrained_shortest(
            body.source, body.target, body.max_consecutive_deletes
        )
        limit_reached = False

    if limit_reached:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "DIFF_LIMIT",
                "message": f"编辑距离超过 {MAX_DISTANCE} 的搜索上限",
            },
        )
    if result is None:
        # 没有任何满足连续删除上限的最终脚本；不返回可审批差异块。
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CONSTRAINED_DIFF_INFEASIBLE",
                "message": (
                    f"不存在连续删除不超过 {body.max_consecutive_deletes} 个镜头的"
                    "插入/删除脚本"
                ),
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

    response = DiffResponse(
        distance=distance,
        length_source=len(body.source),
        length_target=len(body.target),
        alignment=alignment,
    )
    if body.max_consecutive_deletes is not None:
        response.max_consecutive_deletes = body.max_consecutive_deletes
    payload = response.model_dump()
    if body.max_consecutive_deletes is None:
        # 只移除顶层版本字段；alignment 行内的 source/target null 是旧接口的一部分。
        payload.pop("max_consecutive_deletes", None)
    return JSONResponse(content=payload)
