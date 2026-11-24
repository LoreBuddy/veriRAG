from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="veriRAG")
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_methods=["*"],
	allow_headers=["*"],
)

DOCS = [
    {"id": "doc-1", "title": "Refund policy","text": "Refunds are available within 30 days of purchase with a receipt."},
    {"id": "doc-2", "title": "Shipping",    "text": "Orders ship within 2 business days. Free shipping over $50."},
    {"id": "doc-3", "title": "Warranty",    "text": "All products include a 1-year warranty covering manufacturing defects."},
]

class AskRequest(BaseModel): question:str
class AskResponse(BaseModel):
    answer: str
    verified: bool
    sources: list[dict]

def retrieve(question:str)->list[dict]:
    