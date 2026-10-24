import os
from contextlib import asynccontextmanager
from decimal import Decimal, ROUND_HALF_UP
from typing import List

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DB_DIR = "/tmp" if os.environ.get("VERCEL") else "."
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(DB_DIR, 'expenses.db')}")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    members: Mapped[List["Member"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )
    expenses: Mapped[List["Expense"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class Member(Base):
    __tablename__ = "members"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), nullable=False)
    group: Mapped[Group] = relationship(back_populates="members")


class Expense(Base):
    __tablename__ = "expenses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    description: Mapped[str] = mapped_column(String(160), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), nullable=False)
    payer_id: Mapped[int] = mapped_column(ForeignKey("members.id"), nullable=False)
    group: Mapped[Group] = relationship(back_populates="expenses")
    shares: Mapped[List["ExpenseShare"]] = relationship(
        back_populates="expense", cascade="all, delete-orphan"
    )
    payer: Mapped[Member] = relationship(foreign_keys=[payer_id])


class ExpenseShare(Base):
    __tablename__ = "expense_shares"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id"), nullable=False)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    expense: Mapped[Expense] = relationship(back_populates="shares")
    member: Mapped[Member] = relationship()


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    members: List[str] = Field(min_length=2, max_length=30)

    @field_validator("name")
    @classmethod
    def clean_group_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Group name cannot be blank")
        return value

    @field_validator("members")
    @classmethod
    def clean_members(cls, values):
        cleaned = [v.strip() for v in values if v.strip()]
        if len(cleaned) < 2:
            raise ValueError("Add at least two member names")
        if len(cleaned) > 30:
            raise ValueError("A group can have at most 30 members")
        return cleaned


class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=160)
    amount: Decimal = Field(gt=0, le=Decimal("10000000"))
    payer_id: int

    @field_validator("description")
    @classmethod
    def clean_description(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Description cannot be blank")
        return value


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield



app = FastAPI(title="SplitWise Lite API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def money_from_paise(paise: int) -> float:
    return round(paise / 100, 2)


def group_or_404(db: Session, group_id: int) -> Group:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def group_payload(group: Group):
    return {
        "id": group.id,
        "name": group.name,
        "members": [{"id": m.id, "name": m.name} for m in group.members],
        "expense_count": len(group.expenses),
    }


@app.get("/")
def root():
    return {"message": "SplitWise Lite API is running", "docs": "/docs"}


@app.get("/api/groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.scalars(select(Group).order_by(Group.id.desc())).all()
    return [group_payload(g) for g in groups]


@app.post("/api/groups", status_code=201)
def create_group(payload: GroupCreate, db: Session = Depends(get_db)):
    group = Group(name=payload.name)
    group.members = [Member(name=name) for name in payload.members]
    db.add(group)
    db.commit()
    db.refresh(group)
    return group_payload(group)


def expense_payload(e: Expense):
    return {
        "id": e.id,
        "description": e.description,
        "amount": money_from_paise(e.amount_paise),
        "payer_id": e.payer_id,
        "payer_name": e.payer.name,
        "shares": [
            {
                "member_id": share.member_id,
                "member_name": share.member.name,
                "amount": money_from_paise(share.amount_paise),
            }
            for share in e.shares
        ],
    }


def compute_group_balances(group: Group, expenses: List[Expense]):
    totals = {m.id: {"paid": 0, "owed": 0, "name": m.name} for m in group.members}

    for expense in expenses:
        totals[expense.payer_id]["paid"] += expense.amount_paise
        for share in expense.shares:
            totals[share.member_id]["owed"] += share.amount_paise

    balances = []
    for member in group.members:
        row = totals[member.id]
        net = row["paid"] - row["owed"]
        balances.append({
            "member_id": member.id,
            "name": member.name,
            "paid": money_from_paise(row["paid"]),
            "share": money_from_paise(row["owed"]),
            "net": money_from_paise(net),
            "net_paise": net,
        })

    # Greedy debt simplification: pair the largest debtor with the largest creditor.
    creditors = [
        {"member_id": b["member_id"], "name": b["name"], "amount": b["net_paise"]}
        for b in balances if b["net_paise"] > 0
    ]
    debtors = [
        {"member_id": b["member_id"], "name": b["name"], "amount": -b["net_paise"]}
        for b in balances if b["net_paise"] < 0
    ]
    creditors.sort(key=lambda x: x["amount"], reverse=True)
    debtors.sort(key=lambda x: x["amount"], reverse=True)
    settlements = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        transfer = min(debtors[i]["amount"], creditors[j]["amount"])
        if transfer > 0:
            settlements.append({
                "from_member_id": debtors[i]["member_id"],
                "from_name": debtors[i]["name"],
                "to_member_id": creditors[j]["member_id"],
                "to_name": creditors[j]["name"],
                "amount": money_from_paise(transfer),
            })
        debtors[i]["amount"] -= transfer
        creditors[j]["amount"] -= transfer
        if debtors[i]["amount"] == 0:
            i += 1
        if creditors[j]["amount"] == 0:
            j += 1

    return {
        "group_id": group.id,
        "group_name": group.name,
        "balances": balances,
        "settlements": settlements,
        "total_expenses": money_from_paise(sum(e.amount_paise for e in expenses)),
    }


@app.get("/api/groups/{group_id}")
def get_group(group_id: int, db: Session = Depends(get_db)):
    group = group_or_404(db, group_id)
    expenses = db.scalars(
        select(Expense).where(Expense.group_id == group_id).order_by(Expense.id.desc())
    ).all()
    payload = group_payload(group)
    payload["expenses"] = [expense_payload(e) for e in expenses]
    payload["summary"] = compute_group_balances(group, expenses)
    return payload


@app.post("/api/groups/{group_id}/expenses", status_code=201)
def create_expense(group_id: int, payload: ExpenseCreate, db: Session = Depends(get_db)):
    group = group_or_404(db, group_id)
    member_ids = {m.id for m in group.members}
    if payload.payer_id not in member_ids:
        raise HTTPException(status_code=400, detail="Payer must be a member of this group")
    if not group.members:
        raise HTTPException(status_code=400, detail="Add group members first")

    amount_paise = int(
        (payload.amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    if amount_paise < 1:
        raise HTTPException(status_code=400, detail="Amount must be at least ₹0.01")

    expense = Expense(
        description=payload.description,
        amount_paise=amount_paise,
        group_id=group.id,
        payer_id=payload.payer_id,
    )

    # Split paise evenly; any remainder paise are assigned one at a time
    # to the first members, ensuring shares add up exactly to the expense.
    members = sorted(group.members, key=lambda m: m.id)
    base_share, remainder = divmod(amount_paise, len(members))
    expense.shares = [
        ExpenseShare(
            member_id=member.id,
            amount_paise=base_share + (1 if index < remainder else 0),
        )
        for index, member in enumerate(members)
    ]
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return {
        "id": expense.id,
        "description": expense.description,
        "amount": money_from_paise(expense.amount_paise),
        "payer_id": expense.payer_id,
        "payer_name": expense.payer.name,
        "created": True,
    }


@app.get("/api/groups/{group_id}/expenses")
def list_expenses(group_id: int, db: Session = Depends(get_db)):
    group_or_404(db, group_id)
    expenses = db.scalars(
        select(Expense).where(Expense.group_id == group_id).order_by(Expense.id.desc())
    ).all()
    return [expense_payload(e) for e in expenses]


@app.get("/api/groups/{group_id}/balances")
def group_balances(group_id: int, db: Session = Depends(get_db)):
    group = group_or_404(db, group_id)
    expenses = db.scalars(select(Expense).where(Expense.group_id == group_id)).all()
    return compute_group_balances(group, expenses)
