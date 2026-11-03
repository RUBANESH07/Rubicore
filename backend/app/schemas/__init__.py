from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer, field_validator, model_validator

Money = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2),
                          PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------
class PinIn(BaseModel):
    pin: str = Field(min_length=1, max_length=12)


class UserOut(ORM):
    id: int
    email: str
    username: str | None = None
    name: str
    currency: str


# ---------- accounts ----------
AccountType = Literal["cash", "bank", "wallet"]


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: AccountType
    opening_balance: Money = Decimal("0")
    opening_date: date | None = None


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    opening_balance: Money | None = None
    opening_date: date | None = None
    is_active: bool | None = None


class AccountOut(ORM):
    id: int
    name: str
    type: str
    opening_balance: Money
    opening_date: date
    is_active: bool


# ---------- categories ----------
class SubcategoryOut(ORM):
    id: int
    name: str


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: Literal["income", "expense"]
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class CategoryOut(ORM):
    id: int
    name: str
    type: str
    color: str
    is_default: bool
    subcategories: list[SubcategoryOut] = []


class SubcategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


# ---------- transactions ----------
PaymentMethod = Literal["cash", "upi", "card", "netbanking", "wallet", "other"]


class TransactionIn(BaseModel):
    type: Literal["income", "expense", "transfer"]
    amount: PositiveMoney
    date: date
    account_id: int
    transfer_account_id: int | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    payment_method: PaymentMethod = "cash"
    description: str = Field(default="", max_length=255)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _check(self):
        if self.type == "transfer":
            if not self.transfer_account_id or self.transfer_account_id == self.account_id:
                raise ValueError("Transfers need a different destination account")
            self.category_id = self.subcategory_id = None
        else:
            self.transfer_account_id = None
        return self


class TransactionOut(ORM):
    id: int
    type: str
    amount: Money
    date: date
    occurred_at: datetime
    account_id: int
    transfer_account_id: int | None
    category_id: int | None
    subcategory_id: int | None
    category_name: str | None = None
    subcategory_name: str | None = None
    payment_method: str
    description: str
    notes: str | None


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int


# ---------- budgets / goals ----------
class BudgetIn(BaseModel):
    category_id: int | None = None
    amount: PositiveMoney


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_amount: PositiveMoney
    saved_amount: Money = Decimal("0")
    target_date: date | None = None


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_amount: PositiveMoney | None = None
    saved_amount: Money | None = None
    target_date: date | None = None


class GoalOut(ORM):
    id: int
    name: str
    target_amount: Money
    saved_amount: Money
    target_date: date | None


# ---------- misc ----------
class WatchlistIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    name: str = ""
    exchange: Literal["NSE", "BSE"] = "NSE"


class ArticleIn(BaseModel):
    title: str = Field(max_length=500)
    url: str = Field(max_length=1000)
    source: str = ""
    category: str = ""
    summary: str = ""
    published_at: str = ""


class NotificationOut(ORM):
    id: int
    kind: str
    title: str
    body: str
    is_read: bool
    created_at: datetime


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: int | None = None


class ModuleToggle(BaseModel):
    enabled: bool
    config: dict | None = None
